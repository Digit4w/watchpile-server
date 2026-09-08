import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import { DEFAULT_TIMEOUT_MS, providers } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { searchProvider } from './providers.client.js'
import { envVarFor, resolveCredential } from './providers.credentials.js'
import type { ProviderPublic } from './providers.public.js'
import type { ProviderRow, TypeBinding } from './providers.query.js'
import { bindingFor } from './providers.query.js'
import { PROVIDER_SEEDS } from './providers.seed.js'
import { resetTokens } from './providers.token.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUpAdmin(): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  })
  return cookieFrom(res)
}

/**
 * Rebaixa o usuário da sessão em vez de forjar um cookie — o cookie é assinado,
 * e `getSessionUser` relê `is_admin` a cada requisição.
 */
function demote(): void {
  db.update(users).set({ isAdmin: false }).run()
}

async function list(cookie: string): Promise<ProviderPublic[]> {
  const res = await app.request('/api/providers', {
    headers: { Cookie: cookie },
  })
  return (await res.json()) as ProviderPublic[]
}

async function patch(cookie: string, slug: string, body: unknown) {
  return app.request(`/api/providers/${slug}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** O TMDB semeado, restaurado ao estado de migration entre os testes. */
function resetTmdb(): void {
  db.update(providers)
    .set({ credentialValues: {}, optionValues: {} })
    .where(eq(providers.slug, 'tmdb'))
    .run()
}

beforeEach(() => {
  db.delete(externalIds).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
  resetTmdb()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/providers', () => {
  it('devolve o TMDB semeado como DEFINIÇÃO, não como caso especial', async () => {
    const cookie = await signUpAdmin()
    const [tmdb] = await list(cookie)

    expect(tmdb?.slug).toBe('tmdb')
    expect(tmdb?.baseUrl).toBe('https://api.themoviedb.org/3')
    expect(tmdb?.authStyle).toBe('query-key')
    // A associação é muitos-para-muitos e opcional; o TMDB serve os dois.
    expect(tmdb?.mediaTypes.sort()).toEqual(['movie', 'tv'])
  })

  it('traz a atribuição, que é condição de uso e não cortesia', async () => {
    const cookie = await signUpAdmin()
    const [tmdb] = await list(cookie)
    expect(tmdb?.attribution).toContain('TMDB')
  })

  it('NUNCA devolve o segredo, só se está configurado e os últimos caracteres', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', {
      credentials: { api_key: 'segredo-abcd1234' },
    })

    const res = await app.request('/api/providers', {
      headers: { Cookie: cookie },
    })
    const raw = await res.text()

    // A prova mais forte é textual: a chave não aparece em lugar nenhum da
    // resposta, nem dentro de um campo que ninguém esperava.
    expect(raw).not.toContain('segredo-abcd1234')

    const [tmdb] = JSON.parse(raw) as ProviderPublic[]
    expect(tmdb?.credentials[0]?.configured).toBe(true)
    expect(tmdb?.credentials[0]?.hint).toBe('…1234')
  })

  it('a leitura é de TODO MUNDO, porque a atribuição precisa renderizar', async () => {
    const cookie = await signUpAdmin()
    demote()

    const res = await app.request('/api/providers', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
  })

  it('devolve o valor efetivo da opção — o salvo, ou o default da declaração', async () => {
    const cookie = await signUpAdmin()

    const [antes] = await list(cookie)
    expect(antes?.optionValues).toEqual({ nsfw: false, language: 'en-US' })

    await patch(cookie, 'tmdb', { options: { nsfw: true } })

    const [after] = await list(cookie)
    // A opção não mexida continua no default; a tela nunca precisa saber qual
    // dos dois é.
    expect(after?.optionValues).toEqual({ nsfw: true, language: 'en-US' })
  })

  it('diz que não está pronto enquanto falta credencial declarada', async () => {
    const cookie = await signUpAdmin()

    const [semChave] = await list(cookie)
    expect(semChave?.ready).toBe(false)
    expect(semChave?.credentials[0]?.source).toBe('none')

    await patch(cookie, 'tmdb', { credentials: { api_key: 'k'.repeat(20) } })

    const [comChave] = await list(cookie)
    expect(comChave?.ready).toBe(true)
  })
})

describe('a precedência da credencial', () => {
  it('env vence o que está no banco, e o campo se anuncia travado', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'do-banco-9999' } })

    vi.stubEnv(envVarFor('tmdb', 'api_key'), 'do-env-1111')

    const [tmdb] = await list(cookie)
    expect(tmdb?.credentials[0]?.source).toBe('env')
    // É `overridden` que faz a tela desabilitar o campo. Sem ele a pessoa
    // edita, salva e nada acontece — config em duas fontes sem indicação.
    expect(tmdb?.credentials[0]?.overridden).toBe(true)
    expect(tmdb?.credentials[0]?.hint).toBe('…1111')
  })

  it('a chave guardada vence a embutida, e a embutida não trava o campo', () => {
    // `embedded` é o estado que a tela mostra na linha recomendando trocar —
    // travar o campo impediria exatamente o que ela recomenda.
    const stored = resolveCredential('tmdb', 'api_key', { api_key: 'minha' })
    expect(stored).toEqual({ value: 'minha', source: 'stored' })
  })

  it('literal embutido vazio degrada para "configure a sua"', () => {
    // Nenhuma chave foi emitida ainda, e o brief aceita esse modo de falha: é o
    // mesmo estado que existiria se a chave embarcada fosse suspensa.
    const withNothing = resolveCredential('tmdb', 'api_key', {})
    expect(withNothing).toEqual({ value: '', source: 'none' })
  })

  it('string só com espaço conta como ausente em todo degrau', async () => {
    const cookie = await signUpAdmin()
    vi.stubEnv(envVarFor('tmdb', 'api_key'), '   ')

    const [tmdb] = await list(cookie)
    expect(tmdb?.credentials[0]?.source).toBe('none')
  })

  it('deriva o nome da env var do par (slug, chave)', () => {
    // Derivado, e não lista: provedor que o usuário cadastrar ganha env var
    // pelo mesmo caminho, sem passar por `env.ts`.
    expect(envVarFor('tmdb', 'api_key')).toBe('WATCHPILE_PROVIDER_TMDB_API_KEY')
    expect(envVarFor('my-provider', 'client_secret')).toBe(
      'WATCHPILE_PROVIDER_MY_PROVIDER_CLIENT_SECRET',
    )
  })
})

describe('PATCH /api/providers/{slug}', () => {
  it('MESCLA as credenciais, porque a tela não tem os segredos pra reenviar', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'primeira-1111' } })
    // Um PATCH que só mexe numa opção não pode apagar a chave.
    await patch(cookie, 'tmdb', { options: { nsfw: true } })

    const [tmdb] = await list(cookie)
    expect(tmdb?.credentials[0]?.configured).toBe(true)
    expect(tmdb?.credentials[0]?.hint).toBe('…1111')
  })

  it('string vazia APAGA a credencial', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'alguma-coisa' } })
    await patch(cookie, 'tmdb', { credentials: { api_key: '' } })

    const [tmdb] = await list(cookie)
    expect(tmdb?.credentials[0]?.configured).toBe(false)
  })

  it('recusa credencial que a definição não declara', async () => {
    const cookie = await signUpAdmin()
    const res = await patch(cookie, 'tmdb', {
      credentials: { api_ky: 'erro de digitação' },
    })

    // Sem isto, o erro de digitação vira campo gravado que ninguém lê, e o
    // admin fica achando que configurou.
    expect(res.status).toBe(400)
  })

  it('recusa opção com o tipo errado', async () => {
    const cookie = await signUpAdmin()
    const res = await patch(cookie, 'tmdb', { options: { nsfw: 'sim' } })
    expect(res.status).toBe(400)
  })

  it('recusa quem não é admin', async () => {
    const cookie = await signUpAdmin()
    demote()

    const res = await patch(cookie, 'tmdb', { options: { nsfw: true } })
    expect(res.status).toBe(403)
  })

  it('404 num provedor que não existe', async () => {
    const cookie = await signUpAdmin()
    const res = await patch(cookie, 'nada', { options: {} })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/providers/{slug}/test', () => {
  async function test(
    cookie: string,
    slug = 'tmdb',
    body?: { credentials?: Record<string, string> },
  ) {
    const res = await app.request(`/api/providers/${slug}/test`, {
      method: 'POST',
      headers: body
        ? { Cookie: cookie, 'Content-Type': 'application/json' }
        : { Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    })
    return {
      status: res.status,
      body: (await res.json()) as {
        ok: boolean
        status: number | null
        message: string
      },
    }
  }

  it('aplica a credencial no lugar que o estilo de auth manda', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'chave-de-teste' } })

    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const { body } = await test(cookie)

    expect(body.ok).toBe(true)
    const url = new URL(String(search.mock.calls[0]?.[0]))
    // `query-key` põe a chave na query, e o endpoint é o mais barato do
    // provedor — validar no salvamento, não na primeira busca.
    expect(url.pathname).toBe('/3/configuration')
    expect(url.searchParams.get('api_key')).toBe('chave-de-teste')
  })

  it('responde 200 com ok:false quando o provedor RECUSA a chave', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'errada' } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 401 }),
    )

    const { status, body } = await test(cookie)

    // 200 de propósito: a requisição NOSSA deu certo. 4xx faria o cliente
    // mostrar "não foi possível alcançar o servidor", que é a frase errada.
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.status).toBe(401)
  })

  it('distingue o provedor RECUSAR do provedor QUEBRAR', async () => {
    // 4xx e 5xx são fatos diferentes: um tem o que arrumar e o outro tem o que
    // esperar. Descoberto na tela rodando em 02/09/2026 — o Jikan devolve 504
    // com "failed to connect to MyAnimeList" quando o MAL recusa o scraper
    // dele, e a frase dizia "refused the request", mandando o admin procurar
    // defeito numa configuração que estava certa.
    const cookie = await signUpAdmin()
    await patch(cookie, 'openlibrary', {})

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 504 }),
    )
    const broken = await test(cookie, 'openlibrary')
    expect(broken.body.ok).toBe(false)
    expect(broken.body.status).toBe(504)
    expect(broken.body.message).toContain('on its own side')
    expect(broken.body.message).not.toContain('refused')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 422 }),
    )
    const refused = await test(cookie, 'openlibrary')
    expect(refused.body.message).toContain('refused')
  })

  it('provedor sem credencial nenhuma é TESTÁVEL, e o teste vai à rede', async () => {
    // `style: 'none'` não pode cair no degrau de "falta a chave": não há chave
    // a faltar, e a cadeia de precedência nem chega a rodar.
    const cookie = await signUpAdmin()
    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const { body } = await test(cookie, 'openlibrary')

    expect(body.ok).toBe(true)
    expect(search).toHaveBeenCalled()
    const url = new URL(String(search.mock.calls[0]?.[0]))
    expect(url.pathname).toBe('/search.json')
    // `q=test` e não `q=a`: o Open Library recusa termo com menos de três
    // caracteres com 422.
    expect(url.searchParams.get('q')).toBe('test')
  })

  it('não tenta nada quando falta a credencial, e diz o que falta', async () => {
    const cookie = await signUpAdmin()
    const search = vi.spyOn(globalThis, 'fetch')

    const { body } = await test(cookie)

    expect(body.ok).toBe(false)
    // O rótulo da declaração, não o nome de máquina — a frase vai pra tela.
    expect(body.message).toContain('API key')
    expect(search).not.toHaveBeenCalled()
  })

  it('testa a credencial DIGITADA, sem exigir salvar antes', async () => {
    const cookie = await signUpAdmin()
    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    // Nada salvo: sem o override isto responderia "falta a chave".
    const { body } = await test(cookie, 'tmdb', {
      credentials: { api_key: 'ainda-nao-salva' },
    })

    expect(body.ok).toBe(true)
    const url = new URL(String(search.mock.calls[0]?.[0]))
    expect(url.searchParams.get('api_key')).toBe('ainda-nao-salva')
  })

  it('a digitada VENCE a guardada, e a guardada não muda', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'a-antiga' } })
    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await test(cookie, 'tmdb', { credentials: { api_key: 'a-nova' } })

    const url = new URL(String(search.mock.calls[0]?.[0]))
    expect(url.searchParams.get('api_key')).toBe('a-nova')
    // O override vale pela duração da tentativa e não é gravado: testar não é
    // salvar, e o admin ainda não decidiu.
    const row = db
      .select()
      .from(providers)
      .where(eq(providers.slug, 'tmdb'))
      .get()
    expect(row?.credentialValues).toEqual({ api_key: 'a-antiga' })
  })

  it('vazio no override conta como AUSENTE, como no `PATCH`', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'a-antiga' } })
    const search = vi.spyOn(globalThis, 'fetch')

    // É o caso de testar uma credencial marcada pra apagar: cai no degrau
    // seguinte da cadeia, que é o que vai valer depois de salvar. Sem literal
    // embutido, isso é "falta a chave".
    const { body } = await test(cookie, 'tmdb', {
      credentials: { api_key: '' },
    })

    expect(body.ok).toBe(false)
    expect(body.message).toContain('API key')
    expect(search).not.toHaveBeenCalled()
  })

  it('sem corpo, continua testando a guardada', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', { credentials: { api_key: 'a-guardada' } })
    const search = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await test(cookie)

    const url = new URL(String(search.mock.calls[0]?.[0]))
    expect(url.searchParams.get('api_key')).toBe('a-guardada')
  })

  it('não deixa a URL montada vazar na mensagem de falha de rede', async () => {
    const cookie = await signUpAdmin()
    await patch(cookie, 'tmdb', {
      credentials: { api_key: 'segredo-na-query' },
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('getaddrinfo ENOTFOUND api.themoviedb.org'),
    )

    const { body } = await test(cookie)

    // A URL montada carrega a chave na query quando o estilo é `query-key` —
    // que é o do TMDB. Repetir a mensagem do erro seria o segredo vazando pela
    // porta dos fundos, num endpoint de diagnóstico.
    expect(body.ok).toBe(false)
    expect(body.message).not.toContain('segredo-na-query')
  })

  it('recusa quem não é admin, porque testar consome cota da instância', async () => {
    const cookie = await signUpAdmin()
    demote()

    const { status } = await test(cookie)
    expect(status).toBe(403)
  })
})

describe('o prazo de resposta', () => {
  /**
   * **O que se afirma aqui é a PROCEDÊNCIA do número, não o número.** Antes ele
   * era `AbortSignal.timeout(10_000)` escrito em cinco lugares, e um teste
   * contra 10s teria passado igual — o defeito não era o valor, era ele não
   * pertencer a ninguém. Por isso a definição declara 50ms: com o prazo vindo
   * da linha, a busca desiste em milissegundos; com a constante antiga, este
   * teste esperaria dez segundos por uma resposta que nunca chega.
   */
  const never: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        // O `AbortSignal.timeout` rejeita com `TimeoutError`; o `fetch` real
        // faz o mesmo, e é isso que o `catch` do cliente genérico vê.
        reject(new DOMException('The operation timed out.', 'TimeoutError'))
      })
    })

  const binding: TypeBinding = {
    searchPath: null,
    fieldMap: null,
    detailPath: null,
    detailFieldMap: null,
    unitsPath: null,
    unitMap: null,
  }

  function slowProvider(timeoutMs: number): ProviderRow {
    db.insert(providers)
      .values({
        slug: 'lento',
        name: 'Lento',
        baseUrl: 'https://lento.test',
        attribution: null,
        auth: { style: 'none' },
        timeoutMs,
        endpoints: {
          search: { path: '/search', queryParam: 'q' },
          detail: { path: '/item/{id}' },
          test: { path: '/search' },
        },
        fieldMap: { externalId: 'id', title: 'title' },
        credentials: [],
        options: [],
      })
      .run()

    const row = db
      .select()
      .from(providers)
      .where(eq(providers.slug, 'lento'))
      .get()
    if (!row) {
      throw new Error('o provedor de teste não foi inserido')
    }
    return row
  }

  afterEach(() => {
    db.delete(providers).where(eq(providers.slug, 'lento')).run()
  })

  it('desiste no prazo que a DEFINIÇÃO declara, não num número nosso', async () => {
    const provider = slowProvider(50)

    const start = Date.now()
    const result = await searchProvider({
      provider,
      binding: binding,
      term: 'qualquer',
      fetchImpl: never,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'unreachable',
      provider: 'lento',
    })
    // Folga generosa: o que se prova é que NÃO foram os 10s da constante
    // antiga, e não a precisão do temporizador.
    expect(Date.now() - start).toBeLessThan(2_000)
  })

  it('quem não declara prazo recebe o padrão na própria linha', () => {
    // **O padrão é da COLUNA, não do código que faz a requisição** — é o que
    // deixa o valor efetivo legível na definição no dia em que ela for
    // editável, em vez de acontecer num `?? 10_000` que ninguém lê.
    db.insert(providers)
      .values({
        slug: 'lento',
        name: 'Lento',
        baseUrl: 'https://lento.test',
        attribution: null,
        auth: { style: 'none' },
        endpoints: {
          search: { path: '/search', queryParam: 'q' },
          detail: { path: '/item/{id}' },
          test: { path: '/search' },
        },
        fieldMap: { externalId: 'id', title: 'title' },
        credentials: [],
        options: [],
      })
      .run()

    const row = db
      .select()
      .from(providers)
      .where(eq(providers.slug, 'lento'))
      .get()
    expect(row?.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('o Kitsu declara o dele, porque a busca dele leva 6 a 12s medidos', () => {
    const kitsu = db
      .select()
      .from(providers)
      .where(eq(providers.slug, 'kitsu'))
      .get()

    // Os 10s do padrão o transformavam em `unreachable` — a mesma resposta de
    // rede fora —, e provedor lento se lia como provedor quebrado.
    expect(kitsu?.timeoutMs).toBe(30_000)
  })

  it('o padrão de anime e mangá é o AniList, e a migration é quem move', () => {
    /**
     * **O efeito de DADO de uma migration também se afirma.** A `0021` gravou
     * `kitsu` e nenhum teste dizia isso; a `0025` moveu pra `anilist` e a `0036`
     * pra `mal` — as três teriam passado despercebidas, porque o `UPDATE` é a
     * única instrução dessas migrations que nenhum outro teste toca:
     * `providersFor` não olha pro padrão.
     *
     * **Este teste CAIU quando a `0036` entrou, e é para isso que ele existe.**
     * Mover o padrão é mudar de onde a busca de todo mundo responde, e não pode
     * acontecer sem alguém afirmar que quis.
     *
     * O que decidiu cada troca foi medido: `kitsu → anilist` por tempo de
     * resposta (0,25–0,7s contra 6–12s); `anilist → mal` porque o AniList
     * **desativou a própria API** em 07/09/2026 — 403 em toda consulta, com o
     * site no ar — e o Jikan responde 504 em tudo que não está em cache.
     *
     * **E `mal → anilist` de volta, no mesmo dia — decisão do dono** (`0039`).
     * Ela responde outra pergunta que as anteriores: qual é a MELHOR fonte, e
     * não qual funciona hoje. A indisponibilidade é temporária e do lado deles;
     * o padrão é do produto. O custo é imediato e está assumido na migration —
     * enquanto durar o 403, buscar anime e mangá recusa com `provider-down`, que
     * é neutro e diz "espere", e as duas saídas de um clique continuam na tela.
     */
    const defaults = db
      .select({ slug: mediaTypes.slug, source: mediaTypes.defaultProviderSlug })
      .from(mediaTypes)
      .where(inArray(mediaTypes.slug, ['anime', 'manga', 'game']))
      .orderBy(mediaTypes.slug)
      .all()

    expect(defaults.map((c) => c.source)).toEqual([
      'anilist',
      'igdb',
      'anilist',
    ])
  })
})

/**
 * **O `catch` do cliente genérico é da REDE, e só dela** — 02/09/2026.
 *
 * Ele embrulhava o `writeCache` junto do `fetch`, então falha NOSSA de banco
 * saía daqui como `unreachable`: o provedor tinha respondido, e a tela dizia
 * que ele não podia ser alcançado. Foi o que custou tempo no ciclo do Kitsu.
 */
/**
 * O provedor que fala por POST, exercitado de ponta a ponta.
 *
 * O que estas afirmações protegem não é "GraphQL funciona": é que o cliente
 * genérico deriva método, corpo e `Content-Type` da DEFINIÇÃO, e que a chave do
 * cache deixou de ser só a URL no dia em que a URL parou de identificar a
 * consulta.
 */
describe('o corpo do pedido', () => {
  const anilist = PROVIDER_SEEDS.find((p) => p.slug === 'anilist')
  if (!anilist) {
    throw new Error('a semente do anilist sumiu')
  }

  const provider: ProviderRow = {
    slug: anilist.slug,
    name: anilist.name,
    baseUrl: anilist.baseUrl,
    attribution: anilist.attribution,
    auth: anilist.auth,
    timeoutMs: anilist.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    /**
     * O teto REAL dele é 0,5/s com rajada de 5, e aqui ele é afrouxado de
     * propósito: este bloco faz cinco idas à rede, que é exatamente a rajada —
     * amarrar o número de casos ao tamanho do balde é como um teste bom vira
     * intermitente. O limitador tem bloco próprio, e o valor semeado é afirmado
     * pelo teste que congela a semente.
     */
    rateLimit: { perSecond: 100, burst: 100 },
    artTemplate: anilist.artTemplate ?? null,
    endpoints: anilist.endpoints,
    fieldMap: anilist.fieldMap,
    credentials: anilist.credentials,
    options: anilist.options,
    credentialValues: {},
    optionValues: {},
  }

  /**
   * A ligação semeada, e ela TEM que existir: uma migration que não semeou o par
   * faria os testes abaixo passarem contra o corpo do provedor em vez do corpo
   * do par, que é justamente a distinção que eles existem pra provar.
   */
  const bindingOf = (type: string): TypeBinding => {
    const found = bindingFor(type, 'anilist')
    if (!found) {
      throw new Error(`o par (${type}, anilist) não foi seeded`)
    }
    return found
  }

  const responseOf = (title: string) =>
    JSON.stringify({
      data: {
        Page: {
          media: [
            {
              id: 1,
              title: { romaji: title },
              startDate: { year: 2023 },
              coverImage: { large: 'https://cdn.test/a.jpg' },
              description: 'linha um<br>linha dois',
            },
          ],
        },
      },
    })

  /**
   * ── O 403 mal atribuído — 07/09/2026 ──────────────────────────────────────
   * O AniList desativou a própria API e passou a devolver **403** em toda
   * consulta. Pela regra de 02/09 — `4xx` é "há o que arrumar" — isso virava
   * `provider-refused`, e a tela oferecia `Open providers` a um admin que ia
   * conferir a configuração e não achar nada errado.
   *
   * É o MESMO defeito que o 504 do Jikan motivou, na porta que aquela correção
   * não fechou: o status era um proxy para "há o que arrumar", e o proxy falha
   * onde o provedor **não declara credencial nenhuma** — não há o que o admin
   * configure, seja qual for a causa real do 4xx.
   */
  it('o 4xx de um provedor SEM credencial não é "arrume a sua chave"', async () => {
    expect(provider.credentials).toHaveLength(0)

    const desativado: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [
            { message: 'The AniList API has been temporarily disabled' },
          ],
        }),
        { status: 403 },
      )

    expect(
      await searchProvider({
        provider,
        binding: bindingOf('anime'),
        term: 'frieren',
        fetchImpl: desativado,
      }),
    ).toEqual({
      ok: false,
      reason: 'provider-down',
      provider: 'anilist',
      status: 403,
    })
  })

  it('e o 5xx dele continua onde estava', async () => {
    // A metade que a regra de 02/09 já acertava não pode ter mudado de lado.
    const caiu: typeof fetch = async () => new Response('', { status: 503 })

    expect(
      await searchProvider({
        provider,
        binding: bindingOf('anime'),
        term: 'frieren',
        fetchImpl: caiu,
      }),
    ).toMatchObject({ reason: 'provider-down', status: 503 })
  })

  it('vira POST com o corpo do PAR e o Content-Type do dialeto', async () => {
    const seen: RequestInit[] = []
    const respond: typeof fetch = async (_url, init) => {
      seen.push(init ?? {})
      return new Response(responseOf('Sousou no Frieren'), { status: 200 })
    }

    const result = await searchProvider({
      provider: provider,
      binding: bindingOf('manga'),
      term: 'berserk',
      fetchImpl: respond,
    })

    const init = seen[0]
    expect(init?.method).toBe('POST')
    expect(
      (init?.headers as Record<string, string> | undefined)?.['Content-Type'],
    ).toBe('application/json')

    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { search: string; type: string }
    }
    // O termo vai no CORPO, e o `type` é o do par — é ele que faz o AniList
    // responder mangá em vez de anime, e pedir o id errado ali devolve 404.
    expect(body.variables).toEqual({ search: 'berserk', type: 'MANGA' })

    expect(result.ok).toBe(true)
  })

  it('o termo NÃO viaja também na query string', async () => {
    // `queryParam` é vazio na definição dele; acrescentá-lo assim mesmo poria
    // `?=berserk` na URL — ignorado pelo AniList, recusado por outros.
    const urls: string[] = []
    const respond: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response(responseOf('Berserk'), { status: 200 })
    }

    await searchProvider({
      provider: provider,
      binding: bindingOf('anime'),
      term: 'berserk',
      fetchImpl: respond,
    })

    expect(urls[0]).toBe('https://graphql.anilist.co/')
  })

  it('a sinopse chega sem as tags que ele escreve', async () => {
    const respond: typeof fetch = async () =>
      new Response(responseOf('Obra'), { status: 200 })

    const result = await searchProvider({
      provider: provider,
      binding: bindingOf('anime'),
      term: 'com-html',
      fetchImpl: respond,
    })

    expect(result.ok && result.results[0]?.synopsis).toBe(
      'linha um\nlinha dois',
    )
  })

  it('duas buscas diferentes NÃO compartilham a entrada de cache', async () => {
    /**
     * O defeito mais silencioso que este ciclo podia introduzir: com `POST` a
     * URL é constante, então uma chave só por URL faria a primeira busca
     * responder por todas as seguintes — resultados plausíveis para a palavra
     * errada, sem erro nenhum.
     */
    const respond =
      (title: string): typeof fetch =>
      async () =>
        new Response(responseOf(title), { status: 200 })

    const first = await searchProvider({
      provider: provider,
      binding: bindingOf('anime'),
      term: 'cache-um',
      fetchImpl: respond('Sousou no Frieren'),
    })
    const second = await searchProvider({
      provider: provider,
      binding: bindingOf('anime'),
      term: 'cache-dois',
      fetchImpl: respond('Kenpuu Denki Berserk'),
    })

    expect(first.ok && first.results[0]?.title).toBe('Sousou no Frieren')
    expect(second.ok && second.results[0]?.title).toBe('Kenpuu Denki Berserk')

    // E a MESMA busca continua sendo servida do cache, que é o ponto de ele
    // existir: o `fetch` que rejeita prova que a rede não foi tocada.
    const repeated = await searchProvider({
      provider: provider,
      binding: bindingOf('anime'),
      term: 'cache-um',
      fetchImpl: async () => {
        throw new Error('não deveria ir à rede')
      },
    })
    expect(repeated.ok && repeated.cached).toBe(true)
  })
})

/**
 * O estilo `oauth-client-credentials`, executado — 02/09/2026.
 *
 * Ele estava DECLARADO no contrato desde a `0007` e nunca tinha rodado. O que
 * estas afirmações protegem é o que o IGDB cobrou de diferente dos cinco
 * primeiros: duas credenciais em vez de uma, uma ida à rede ANTES da
 * requisição, e o client id viajando num header próprio ao lado do token.
 */
describe('a auth por client-credentials', () => {
  const igdb = PROVIDER_SEEDS.find((p) => p.slug === 'igdb')
  if (!igdb) {
    throw new Error('a semente do igdb sumiu')
  }

  const provider = (credenciais: Record<string, string>): ProviderRow => ({
    slug: igdb.slug,
    name: igdb.name,
    baseUrl: igdb.baseUrl,
    attribution: igdb.attribution,
    auth: igdb.auth,
    timeoutMs: igdb.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    rateLimit: { perSecond: 100, burst: 100 },
    artTemplate: igdb.artTemplate ?? null,
    endpoints: igdb.endpoints,
    fieldMap: igdb.fieldMap,
    credentials: igdb.credentials,
    options: igdb.options,
    credentialValues: credenciais,
    optionValues: {},
  })

  const COMPLETE = { client_id: 'um-id', client_secret: 'um-secret' }

  const gameBinding = (): TypeBinding => {
    const found = bindingFor('game', 'igdb')
    if (!found) {
      throw new Error('o par (game, igdb) não foi semeado')
    }
    return found
  }

  /** Responde o token na primeira chamada e a consulta nas seguintes. */
  function engine(result: unknown[] = []) {
    const requests: { url: string; init: RequestInit }[] = []
    const impl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      if (String(url).includes('id.twitch.tv')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-abc', expires_in: 5_327_537 }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(result), { status: 200 })
    }
    return { impl, requests }
  }

  beforeEach(() => {
    resetTokens()
  })

  it('manda o token E o client id, cada um no seu header', async () => {
    /**
     * **Verificado ao vivo, sem credencial nenhuma**: o 401 do IGDB responde
     * com uma lista de dicas cuja primeira é literal — "Ensure you are sending
     * Authorization and Client-ID as headers". Era a peça que faltava no estilo,
     * e um header só não descreveria este provedor.
     */
    const { impl, requests } = engine([{ id: 1, name: 'Celeste' }])

    const r = await searchProvider({
      provider: provider(COMPLETE),
      binding: gameBinding(),
      term: 'celeste',
      fetchImpl: impl,
    })

    expect(r.ok).toBe(true)
    // O primeiro pedido é a troca de token; o segundo é a consulta.
    expect(requests[0]?.url).toContain('id.twitch.tv')
    const headers = requests[1]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-abc')
    expect(headers['Client-ID']).toBe('um-id')
  })

  it('a busca vai em apicalypse, com o termo entre aspas', async () => {
    const { impl, requests } = engine()
    await searchProvider({
      provider: provider(COMPLETE),
      binding: gameBinding(),
      term: 'hollow knight',
      fetchImpl: impl,
    })

    const query = requests[1]
    expect(String(query?.init.body)).toContain('search "hollow knight";')
    expect(
      (query?.init.headers as Record<string, string> | undefined)?.[
        'Content-Type'
      ],
    ).toBe('text/plain')
  })

  it('a credencial que FALTA é a que a recusa nomeia', async () => {
    const withoutSecret = await searchProvider({
      provider: provider({ client_id: 'um-id' }),
      binding: gameBinding(),
      term: 'x',
      fetchImpl: engine().impl,
    })

    expect(withoutSecret).toEqual({
      ok: false,
      reason: 'not-configured',
      provider: 'igdb',
      credential: 'client_secret',
    })
  })

  it('recusa na troca de token NÃO é "falta configurar"', async () => {
    /**
     * A distinção que este ciclo acrescentou. As duas credenciais estão
     * preenchidas e quem recusou foi o provedor: mandar `not-configured` levaria
     * o admin a um formulário cheio, sem dizer o que está errado nele.
     */
    const impl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'invalid client' }), {
        status: 400,
      })

    expect(
      await searchProvider({
        provider: provider(COMPLETE),
        binding: gameBinding(),
        term: 'x',
        fetchImpl: impl,
      }),
    ).toEqual({
      ok: false,
      reason: 'provider-refused',
      provider: 'igdb',
      status: 400,
    })
  })

  it('o 4xx de um provedor COM credencial continua sendo do admin', async () => {
    /**
     * A metade que NÃO muda com o conserto de 07/09/2026: a credencial existe,
     * foi enviada e foi recusada — há o que arrumar, e a tela oferece Settings
     * com razão. Sem esta afirmação, mover o AniList de lado poderia levar o
     * IGDB junto sem nada denunciar.
     */
    const recusa: typeof fetch = async (url) =>
      String(url).includes('id.twitch.tv')
        ? new Response(
            JSON.stringify({ access_token: 'tok-abc', expires_in: 5_327_537 }),
            { status: 200 },
          )
        : new Response('', { status: 403 })

    expect(
      await searchProvider({
        provider: provider(COMPLETE),
        binding: gameBinding(),
        term: 'x',
        fetchImpl: recusa,
      }),
    ).toEqual({
      ok: false,
      reason: 'provider-refused',
      provider: 'igdb',
      status: 403,
    })
  })

  it('o 401 da CONSULTA joga o token fora, e o pedido seguinte troca', async () => {
    /**
     * Sem isso, um token revogado do lado deles ficaria válido aqui por dois
     * meses — toda busca voltaria 401, e nada no servidor tentaria outro.
     */
    const requests: string[] = []
    let refuse = true
    const impl: typeof fetch = async (url) => {
      requests.push(String(url))
      if (String(url).includes('id.twitch.tv')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 5_327_537 }),
          { status: 200 },
        )
      }
      if (refuse) {
        refuse = false
        return new Response('{}', { status: 401 })
      }
      return new Response(JSON.stringify([{ id: 1, name: 'Ok' }]), {
        status: 200,
      })
    }

    const p = provider(COMPLETE)
    const b = gameBinding()
    await searchProvider({
      provider: p,
      binding: b,
      term: 'token-um',
      fetchImpl: impl,
    })
    await searchProvider({
      provider: p,
      binding: b,
      term: 'token-dois',
      fetchImpl: impl,
    })

    // Duas trocas de token, e não uma: a segunda só acontece porque o 401
    // esqueceu a primeira.
    expect(requests.filter((u) => u.includes('id.twitch.tv'))).toHaveLength(2)
  })

  it('o ano sai do timestamp, e NÃO dos quatro primeiros dígitos', async () => {
    /**
     * `1431993600` é maio de 2015, quando The Witcher 3 saiu. Sem `yearFormat`
     * a leitura daria **1431** — plausível, na coluna certa, sem erro nenhum.
     */
    const { impl } = engine([
      { id: 1942, name: 'The Witcher 3', first_release_date: 1_431_993_600 },
    ])

    const r = await searchProvider({
      provider: provider(COMPLETE),
      binding: gameBinding(),
      term: 'ano-do-timestamp',
      fetchImpl: impl,
    })

    expect(r.ok && r.results[0]?.year).toBe(2015)
  })
})

describe('o alcance do catch de rede', () => {
  const binding: TypeBinding = {
    searchPath: null,
    fieldMap: null,
    detailPath: null,
    detailFieldMap: null,
    unitsPath: null,
    unitMap: null,
  }

  /**
   * Uma definição que NÃO está na tabela — que é a falha de verdade, não uma
   * simulada: `provider_cache.provider_slug` tem FK para `providers.slug`, e é
   * exatamente esta a gravação que estourou no ciclo do Kitsu.
   */
  const orphan: ProviderRow = {
    slug: 'nao-semeado',
    name: 'Não semeado',
    baseUrl: 'https://orfao.test',
    attribution: null,
    auth: { style: 'none' },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    rateLimit: null,
    artTemplate: null,
    endpoints: {
      search: { path: '/search', queryParam: 'q' },
      detail: { path: '/item/{id}' },
      test: { path: '/search' },
    },
    fieldMap: { externalId: 'id', title: 'title' },
    credentials: [],
    options: [],
    credentialValues: {},
    optionValues: {},
  }

  it('falha nossa de banco não se disfarça de provedor inalcançável', async () => {
    const respond: typeof fetch = async () =>
      new Response(JSON.stringify({ results: [{ id: '1', title: 'Obra' }] }), {
        status: 200,
      })

    /**
     * **O que se afirma é a PROCEDÊNCIA da resposta, não um código.** Com o
     * `catch` largo isto devolvia `{ ok: false, reason: 'unreachable' }` e
     * passava por comportamento correto — o teste que apontasse pro 503 teria
     * ficado verde nos dois mundos. A falha precisa SUBIR pra virar 500 com
     * stack no log, que é onde falha nossa pertence.
     */
    await expect(
      searchProvider({
        provider: orphan,
        binding: binding,
        term: 'qualquer',
        fetchImpl: respond,
      }),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })
})

describe('a semeadura', () => {
  it('descreve exatamente o que a migration semeou', async () => {
    // A guarda contra a divergência que `providers.seed.ts` assume: a migration
    // é o retrato congelado do módulo, e mudar a definição sem migration que a
    // acompanhe quebra aqui. Mesma forma do teste de templates de tipo.
    const cookie = await signUpAdmin()
    const installed = await list(cookie)

    for (const seed of PROVIDER_SEEDS) {
      const row = db
        .select()
        .from(providers)
        .where(eq(providers.slug, seed.slug))
        .get()

      expect(row, `o provider ${seed.slug} não foi seeded`).toBeDefined()
      expect(row?.name).toBe(seed.name)
      expect(row?.baseUrl).toBe(seed.baseUrl)
      expect(row?.attribution).toBe(seed.attribution)
      expect(row?.artTemplate).toBe(seed.artTemplate ?? null)
      expect(row?.auth).toEqual(seed.auth)
      expect(row?.rateLimit).toEqual(seed.rateLimit ?? null)
      expect(row?.timeoutMs).toBe(seed.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      expect(row?.endpoints).toEqual(seed.endpoints)
      expect(row?.fieldMap).toEqual(seed.fieldMap)
      expect(row?.credentials).toEqual(seed.credentials)
      expect(row?.options).toEqual(seed.options)

      const publicRow = installed.find((p) => p.slug === seed.slug)
      expect(publicRow?.mediaTypes.sort()).toEqual(
        seed.mediaTypes.map((t) => t.slug).sort(),
      )

      // O "como" do par também é semeado, e é o que a 0008 acrescentou: um
      // endpoint e um mapa de campos por (tipo, provedor).
      for (const type of seed.mediaTypes) {
        const binding = bindingFor(type.slug, seed.slug)
        /**
         * **Campo a campo, e todos.** A versão anterior comparava só
         * `searchPath` e `fieldMap`, e por isso não pegou `detail_path`
         * nascendo torto em 01/09/2026: a semente ganhou o campo, a migration
         * também, e o teste teria passado se um dos dois tivesse esquecido.
         * Retrato congelado que só confere metade do rosto não é retrato.
         */
        expect(binding?.searchPath).toBe(type.searchPath ?? null)
        expect(binding?.searchBody).toEqual(type.searchBody ?? null)
        expect(binding?.detailPath).toBe(type.detailPath ?? null)
        expect(binding?.detailBody).toEqual(type.detailBody ?? null)
        expect(binding?.providerTypeToken).toBe(type.providerTypeToken ?? null)
        expect(binding?.relationsPath).toBe(type.relationsPath ?? null)
        expect(binding?.unitsPath).toBe(type.unitsPath ?? null)
        expect(binding?.unitMap).toEqual(type.unitMap ?? null)
        expect(binding?.fieldMap).toEqual(type.fieldMap ?? null)
        expect(binding?.detailFieldMap).toEqual(type.detailFieldMap ?? null)
      }
    }
  })

  it('a junção só existe pros tipos que EXISTEM na instalação', () => {
    // O wizard vai semear tipos parcialmente (brief, 3.9), e provedor sem tipo
    // a que se ligar fica ocioso, não quebrado.
    const seeded = new Set(PROVIDER_SEEDS.map((p) => p.slug))
    const joins = db.select().from(mediaTypeProviders).all()
    expect(joins.every((j) => seeded.has(j.providerSlug))).toBe(true)
  })

  it('o Open Library é semeado SEM credencial nenhuma', async () => {
    // O primeiro provedor com `style: 'none'`. O que se afirma aqui não é a
    // lista vazia — é que a tela tem como saber que não há formulário a
    // desenhar, em vez de desenhar um campo que ninguém vai preencher.
    const cookie = await signUpAdmin()
    const installed = await list(cookie)
    const ol = installed.find((p) => p.slug === 'openlibrary')

    expect(ol?.credentials).toEqual([])
    expect(ol?.authStyle).toBe('none')
    // `ready` sem credencial declarada é VERDADE por vacuidade, e é o que
    // impede a tela de marcar como pendente um provedor que não pede nada — o
    // contador do selo conta condição não resolvida, e aqui não há nenhuma.
    expect(ol?.ready).toBe(true)
  })
})

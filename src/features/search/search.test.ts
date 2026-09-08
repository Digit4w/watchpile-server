import { eq, ne } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import { providerCache, providers } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { cacheKeyFor } from '../providers/providers.cache.js'
import {
  configureLimiter,
  resetLimiter,
} from '../providers/providers.limiter.js'

/** Duas páginas do TMDB, com os formatos que ele devolve de verdade. */
const MOVIE_RESPONSE = JSON.stringify({
  results: [
    {
      id: 550,
      title: 'Fight Club',
      release_date: '1999-10-15',
      poster_path: '/pB8B.jpg',
      overview: 'Um funcionário insone…',
    },
    // Sem título: o `/search/multi` do TMDB devolve pessoas, e elas não têm.
    { id: 999, profile_path: '/x.jpg' },
    // Sem data anunciada — o TMDB manda string vazia, não ausência.
    { id: 551, title: 'Sem data', release_date: '', poster_path: null },
  ],
})

const SERIES_RESPONSE = JSON.stringify({
  results: [
    {
      id: 1396,
      name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      poster_path: '/ggFH.jpg',
      overview: 'Um professor de química…',
    },
  ],
})

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

function giveKey(): void {
  db.update(providers)
    .set({ credentialValues: { api_key: 'chave-de-teste' } })
    .where(eq(providers.slug, 'tmdb'))
    .run()
}

async function search(cookie: string, query: string) {
  const res = await app.request(`/api/search?${query}`, {
    headers: { Cookie: cookie },
  })
  return { status: res.status, body: await res.json() }
}

function respond(body: string, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status }))
}

beforeEach(() => {
  db.delete(externalIds).run()
  db.delete(entries).run()
  db.delete(providerCache).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
  db.update(providers)
    .set({ credentialValues: {}, optionValues: {} })
    .where(eq(providers.slug, 'tmdb'))
    .run()
  /**
   * O provedor FABRICADO some, e a junção dele junto. Sem isto o segundo teste
   * que chama `segundoProvedor()` bate no único de `providers.slug` — e é a
   * mesma armadilha que já mordeu antes neste repo: teste que mexe em linha
   * semeada precisa desfazer, senão suja todos os seguintes.
   */
  db.update(mediaTypes).set({ defaultProviderSlug: null }).run()
  db.delete(mediaTypeProviders)
    .where(ne(mediaTypeProviders.providerSlug, 'tmdb'))
    .run()
  // O padrão some ANTES do provedor: `media_types.default_provider_slug`
  // aponta pra cá, e apagar a linha com a coluna preenchida bate na FK.
  db.delete(providers).where(ne(providers.slug, 'tmdb')).run()
  resetLimiter()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/search', () => {
  it('busca no endpoint do PAR, não no do provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(MOVIE_RESPONSE)

    await search(cookie, 'type=movie&q=fight')

    const url = new URL(String(call.mock.calls[0]?.[0]))
    // `/search/movie`, e não o `/search/multi` que é o fallback do provedor.
    expect(url.pathname).toBe('/3/search/movie')
    expect(url.searchParams.get('query')).toBe('fight')
  })

  it('usa o mapa de campos do PAR — série lê `name`, movie lê `title`', async () => {
    const cookie = await signUpAdmin()
    giveKey()

    respond(MOVIE_RESPONSE)
    const movie = await search(cookie, 'type=movie&q=fight')
    expect(
      (movie.body as { results: { title: string }[] }).results[0]?.title,
    ).toBe('Fight Club')

    vi.restoreAllMocks()
    respond(SERIES_RESPONSE)
    const series = await search(cookie, 'type=tv&q=breaking')
    const firstCall = (
      series.body as { results: { title: string; year: number }[] }
    ).results[0]
    // É esta linha que justifica o mapa ser do par: um mapa por provedor leria
    // `title` aqui e devolveria vazio.
    expect(firstCall?.title).toBe('Breaking Bad')
    expect(firstCall?.year).toBe(2008)
  })

  it('descarta item sem título, e sobrevive a data vazia', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')
    const results = (
      body as { results: { title: string; year: number | null }[] }
    ).results

    // Três itens na resposta, dois viram resultado: o do meio não tem título.
    expect(results).toHaveLength(2)
    // `new Date('')` seria `NaN`, que atravessaria o código como número
    // inválido antes de virar null no JSON.
    expect(results[1]?.year).toBeNull()
  })

  it('manda as opções pelo placeholder do endpoint', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    await app.request('/api/providers/tmdb', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { nsfw: true, language: 'pt-BR' } }),
    })
    const call = respond(MOVIE_RESPONSE)

    await search(cookie, 'type=movie&q=fight')

    const url = new URL(String(call.mock.calls[0]?.[0]))
    // O lugar de cada opção é propriedade do ENDPOINT, não do formulário.
    expect(url.searchParams.get('include_adult')).toBe('true')
    expect(url.searchParams.get('language')).toBe('pt-BR')
  })
})

describe('a busca não mente sobre por que não achou', () => {
  it('503 com motivo quando o tipo NÃO TEM provedor', async () => {
    const cookie = await signUpAdmin()
    // `book` existe como tipo e não tem provedor — é o estado de quatro dos
    // seis semeados.
    const { status, body } = await search(cookie, 'type=book&q=dune')

    // Lista vazia diria "procurei e não achei", e o usuário concluiria que a
    // obra não existe no catálogo — quando não houve catálogo nenhum.
    expect(status).toBe(503)
    expect((body as { reason: string }).reason).toBe('no-provider')
    // **E o SLUG não entra na frase** (01/09/2026, vendo a tela): ela dizia
    // `No provider is set up for "manga"`, com a chave onde ia o rótulo. Quem
    // nomeia o tipo é a tela, que sabe o idioma de quem lê.
    expect((body as { message: string }).message).not.toContain('book')
    expect((body as { message: string }).message).toContain('nowhere to search')
  })

  it('404 quando o tipo não existe, e é diferente de não ter provedor', async () => {
    const cookie = await signUpAdmin()
    const { status } = await search(cookie, 'type=nao-existe&q=x')

    // Sem a distinção, um slug com erro de digitação se leria como "falta
    // configurar um provedor", e o admin iria procurar o que configurar.
    expect(status).toBe(404)
  })

  it('503 com motivo quando o provedor existe mas não tem chave', async () => {
    const cookie = await signUpAdmin()
    const call = vi.spyOn(globalThis, 'fetch')

    const { status, body } = await search(cookie, 'type=movie&q=fight')

    expect(status).toBe(503)
    expect((body as { reason: string }).reason).toBe('not-configured')
    expect(call).not.toHaveBeenCalled()
  })

  it('503 com o status quando o provedor recusa', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond('{}', 401)

    const { status, body } = await search(cookie, 'type=movie&q=fight')

    expect(status).toBe(503)
    expect((body as { reason: string }).reason).toBe('provider-refused')
  })

  /**
   * **`4xx` e `5xx` não são o mesmo fato**, e o que se afirma aqui é que os
   * dois chegam à tela com nomes diferentes — não a frase de cada um.
   *
   * O par existe porque a tela tira três coisas do motivo: o título, o tom e o
   * botão de configuração. Mandar um 504 pra `provider-refused` oferecia
   * "arrume a configuração" pra uma configuração que está certa, que foi o que
   * o Jikan expôs ao começar a devolver 504 em tudo.
   */
  it('separa a recusa do provedor (4xx) da falha dele (5xx)', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond('{}', 504)

    const { status, body } = await search(cookie, 'type=movie&q=fight')

    expect(status).toBe(503)
    expect((body as { reason: string }).reason).toBe('provider-down')
    // A frase do 5xx NÃO manda configurar nada: não há o que arrumar.
    expect((body as { message: string }).message).not.toContain('refused')
  })

  it('não deixa a URL montada vazar quando a rede falha', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('connect ECONNREFUSED api.themoviedb.org'),
    )

    const { body } = await search(cookie, 'type=movie&q=fight')

    // A URL carrega a chave na query num provedor `query-key`, que é o TMDB.
    expect((body as { message: string }).message).not.toContain(
      'chave-de-teste',
    )
    expect((body as { reason: string }).reason).toBe('unreachable')
  })
})

describe('o cache de resposta', () => {
  it('a second busca igual não toca no provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(MOVIE_RESPONSE)

    const first = await search(cookie, 'type=movie&q=fight')
    const second = await search(cookie, 'type=movie&q=fight')

    expect(call).toHaveBeenCalledTimes(1)
    expect((first.body as { cached: boolean }).cached).toBe(false)
    expect((second.body as { cached: boolean }).cached).toBe(true)
    // E o resultado é o mesmo, não um vazio servido do cache.
    expect((second.body as { results: unknown[] }).results).toHaveLength(2)
  })

  it('a CREDENCIAL não entra na chave', () => {
    // Duas coisas ao mesmo tempo: rotacionar a chave não invalida respostas que
    // continuam válidas, e a chave não é copiada pra uma segunda tabela.
    const a = cacheKeyFor(
      'https://api.themoviedb.org/3/search/movie?query=fight&api_key=UM',
      'api_key',
    )
    const b = cacheKeyFor(
      'https://api.themoviedb.org/3/search/movie?query=fight&api_key=OUTRO',
      'api_key',
    )
    expect(a).toBe(b)
    expect(a).not.toContain('UM')
  })

  it('a mesma consulta em outra ordem é a MESMA entrada', () => {
    const a = cacheKeyFor('https://x.com/s?query=fight&language=en', null)
    const b = cacheKeyFor('https://x.com/s?language=en&query=fight', null)
    expect(a).toBe(b)
  })

  it('salvar a configuração ESQUECE o cache do provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(MOVIE_RESPONSE)
    await search(cookie, 'type=movie&q=fight')

    // `language` muda literalmente o idioma dos metadados. Servir a resposta
    // antiga faria o admin achar que salvar não teve efeito.
    await app.request('/api/providers/tmdb', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { language: 'pt-BR' } }),
    })

    await search(cookie, 'type=movie&q=fight')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('respeita o limitador, e o cache passa por cima dele', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    /**
     * Balde minúsculo, e o reenchimento praticamente parado.
     *
     * Sem isto o teste dependia de RELÓGIO DE PAREDE: gastar dez fichas a 20/s
     * só estoura se as dez requisições couberem em meio segundo, e elas passam
     * por SQLite de verdade. Passou por sorte até um teste novo entrar antes e
     * mudar o tempo. Teste que mede rajada não pode competir com o próprio
     * tempo de execução.
     */
    configureLimiter('tmdb', { perSecond: 0.001, burst: 2 })

    // Esgota a rajada com consultas diferentes, que não se cacheiam entre si.
    for (let i = 0; i < 2; i += 1) {
      await search(cookie, `type=movie&q=termo${i}`)
    }

    const exceeded = await search(cookie, 'type=movie&q=novo-termo')
    expect(exceeded.status).toBe(503)
    expect((exceeded.body as { reason: string }).reason).toBe('rate-limited')

    // Mas uma consulta JÁ CACHEADA continua respondendo: ela não consome cota
    // nenhuma, e recusá-la seria cobrar por trabalho que não vai acontecer.
    const cached = await search(cookie, 'type=movie&q=termo0')
    expect(cached.status).toBe(200)
    expect((cached.body as { cached: boolean }).cached).toBe(true)
  })
})

describe('quem pode search', () => {
  it('exige sessão', async () => {
    const res = await app.request('/api/search?type=movie&q=x')
    expect(res.status).toBe(401)
  })

  it('não é só do admin — configurar é do admin, usar é de quem tem conta', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)
    db.update(users).set({ isAdmin: false }).run()

    const { status } = await search(cookie, 'type=movie&q=fight')
    expect(status).toBe(200)
  })
})

describe('a junção semeada', () => {
  it('liga o TMDB aos dois tipos, cada um com o seu caminho', () => {
    const rows = db
      .select()
      .from(mediaTypeProviders)
      .where(eq(mediaTypeProviders.providerSlug, 'tmdb'))
      .all()

    const byType = Object.fromEntries(
      rows.map((l) => [l.mediaTypeSlug, l.searchPath]),
    )
    expect(byType).toEqual({
      movie: '/search/movie',
      tv: '/search/tv',
    })
  })
})

/**
 * A decisão de 01/09/2026 (brief, 3.10): a concatenação morreu e um provedor
 * responde. O segundo provedor destes testes é fabricado — nenhum tipo tem dois
 * na instalação de verdade, e é justamente o caso que não podia ficar sem
 * cobertura.
 */
function secondProvider(slug = 'mangadex', name = 'MangaDex'): void {
  db.insert(providers)
    .values({
      slug,
      name,
      baseUrl: 'https://example.test',
      /**
       * `query-key` e não "sem auth": **o contrato não tem estilo sem
       * credencial** (`AuthStyle`, em `db/schema/providers.ts`), mesmo o brief
       * 3.10 dizendo que AniList e Open Library não pedem nada. A fixture usa o
       * estilo que existe, com a credencial já preenchida, pra exercitar a
       * escolha de provedor e não a cadeia de credencial.
       */
      auth: { style: 'query-key', param: 'k', credential: 'api_key' },
      endpoints: { search: { path: '/search', queryParam: 'q' } },
      fieldMap: { externalId: 'id', title: 'title', art: 'art' },
      credentials: [{ key: 'api_key', label: 'Key' }],
      credentialValues: { api_key: 'chave-falsa' },
      options: [],
    })
    .run()
  db.insert(mediaTypeProviders)
    .values({ mediaTypeSlug: 'movie', providerSlug: slug })
    .run()
}

describe('uma busca = um tipo = UM provedor', () => {
  it('com dois associados, chama UM provedor só', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    secondProvider()
    const call = respond(MOVIE_RESPONSE)

    await search(cookie, 'type=movie&q=fight')

    // Concatenar chamaria os dois e devolveria a mesma obra duas vezes, sem
    // ranking comum entre catálogos.
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('o CANÔNICO responde, mesmo não sendo o firstCall por slug', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    secondProvider()
    db.update(mediaTypes)
      .set({ defaultProviderSlug: 'tmdb' })
      .where(eq(mediaTypes.slug, 'movie'))
      .run()
    const call = respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.provider.slug).toBe('tmdb')
    expect(String(call.mock.calls[0]?.[0])).toContain('themoviedb.org')
  })

  it('sem padrão e com dois, responde o firstCall por SLUG', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    secondProvider()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    // `mangadex` < `tmdb`. O desempate é por slug e não pela ordem do banco,
    // senão a fonte trocaria sozinha entre duas consultas iguais.
    expect(body.provider.slug).toBe('mangadex')
  })

  it('o `provider` da query é a troca de fonte, e vence o padrão', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    secondProvider()
    db.update(mediaTypes)
      .set({ defaultProviderSlug: 'mangadex' })
      .where(eq(mediaTypes.slug, 'movie'))
      .run()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight&provider=tmdb')

    expect(body.provider.slug).toBe('tmdb')
  })

  it('pedir provedor que não serve o tipo é 400, não 503', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    // 503 mandaria a pessoa esperar por uma coisa que nunca vai acontecer.
    const { status } = await search(cookie, 'type=movie&q=fight&provider=igdb')
    expect(status).toBe(400)
  })

  it('devolve as FONTES do tipo, ordenadas como o desempate', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    secondProvider()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.sources).toEqual([
      { slug: 'mangadex', name: 'MangaDex' },
      { slug: 'tmdb', name: 'TMDB' },
    ])
  })
})

describe('a arte do resultado', () => {
  it('vem como URL absoluta, montada pelo molde da definição', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    // O `poster_path` do TMDB é `/pB8B.jpg`; quem sabe virar URL é a
    // definição, não o cliente — `if (slug === 'tmdb')` desfaria a decisão.
    expect(body.results[0].art).toBe('https://image.tmdb.org/t/p/w342/pB8B.jpg')
  })

  it('item sem pôster devolve nulo, e a tela cai no ladrilho', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    // `Sem data` vem com `poster_path: null` na resposta falsa.
    const withoutArt = body.results.find(
      (r: { title: string }) => r.title === 'Sem data',
    )
    expect(withoutArt.art).toBeNull()
  })

  it('provedor sem molde não inventa URL a partir de caminho relativo', async () => {
    const cookie = await signUpAdmin()
    secondProvider()
    respond(
      JSON.stringify({ results: [{ id: '1', title: 'Solo', art: '/x.jpg' }] }),
    )

    const { body } = await search(cookie, 'type=movie&q=solo&provider=mangadex')

    expect(body.results[0].art).toBeNull()
  })
})

describe('a atribuição é do provedor que respondeu', () => {
  it('vem do registro, com o NOME próprio junto', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.provider.name).toBe('TMDB')
    expect(body.provider.attribution).toContain('TMDB API')
  })

  it('provedor que não exige atribuição devolve nulo, não a frase do vizinho', async () => {
    const cookie = await signUpAdmin()
    secondProvider()
    respond(JSON.stringify({ results: [{ id: '1', title: 'Solo Leveling' }] }))

    const { body } = await search(cookie, 'type=movie&q=solo&provider=mangadex')

    expect(body.provider.attribution).toBeNull()
  })
})

describe('a duplicata se anuncia antes do clique', () => {
  it('marca o resultado que o usuário já tem, com o id da entry dele', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const owner = db.select().from(users).get()
    const entry = db
      .insert(entries)
      .values({
        userId: owner?.id ?? 0,
        mediaType: 'movie',
        title: 'Fight Club',
      })
      .returning()
      .get()
    db.insert(externalIds)
      .values({
        mediaType: 'movie',
        entryId: entry.id,
        provider: 'tmdb',
        externalId: '550',
      })
      .run()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.owned).toEqual({ '550': entry.id })
  })

  it('a entry de OUTRO usuário não marca a minha busca', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const other = db
      .insert(users)
      .values({ username: 'outra', passwordHash: 'x' })
      .returning()
      .get()
    const entry = db
      .insert(entries)
      .values({ userId: other.id, mediaType: 'movie', title: 'Fight Club' })
      .returning()
      .get()
    db.insert(externalIds)
      .values({
        mediaType: 'movie',
        entryId: entry.id,
        provider: 'tmdb',
        externalId: '550',
      })
      .run()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.owned).toEqual({})
  })

  it('sem nada em comum, o mapa vem vazio e não ausente', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(MOVIE_RESPONSE)

    const { body } = await search(cookie, 'type=movie&q=fight')

    expect(body.owned).toEqual({})
  })
})

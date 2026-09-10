import { and, eq, notInArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { mediaTypeNames, mediaTypes } from '../../db/schema/media-types.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { ICON_NAMES } from './media-types.icons.js'
import type { MediaTypePublic } from './media-types.public.js'
import { MEDIA_TYPE_TEMPLATES } from './media-types.templates.js'

/** Os seis que a migration semeia. Teste não os apaga: eles são o estado base. */
const SEEDED = ['movie', 'tv', 'anime', 'manga', 'game', 'book']

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
 * Rebaixa o usuário da sessão em vez de forjar um cookie.
 *
 * O cookie é assinado, então montar um à mão exigiria o segredo da instalação.
 * Rebaixar funciona porque `getSessionUser` lê `is_admin` da tabela a cada
 * requisição — o que também é a razão de a guarda ser confiável: promover ou
 * rebaixar alguém vale no request seguinte, sem esperar a sessão expirar.
 */
function demote(): void {
  db.update(users).set({ isAdmin: false }).run()
}

async function list(cookie: string, query = ''): Promise<MediaTypePublic[]> {
  const res = await app.request(`/api/media-types${query}`, {
    headers: { Cookie: cookie },
  })
  return (await res.json()) as MediaTypePublic[]
}

beforeEach(() => {
  db.delete(entries).run()
  // Só os tipos CRIADOS pelo teste; os semeados são o estado base da instalação
  // e apagá-los deixaria toda criação de obra sem tipo a que se referir.
  db.delete(mediaTypes).where(notInArray(mediaTypes.slug, SEEDED)).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('GET /api/media-types', () => {
  it('exige sessão', async () => {
    const res = await app.request('/api/media-types')
    expect(res.status).toBe(401)
  })

  it('devolve os seis semeados para QUALQUER usuário, não só admin', async () => {
    const cookie = await signUpAdmin()
    demote()

    const types = await list(cookie)

    // Ler é de todo mundo: sem isto, quem não é admin ficaria sem os chips de
    // `/library` e sem o selo da carta.
    expect(types.map((t) => t.slug).sort()).toEqual([...SEEDED].sort())
  })

  it('resolve o nome no idioma de quem lê', async () => {
    const cookie = await signUpAdmin()

    const inEnglish = await list(cookie, '?locale=en')
    const inPortuguese = await list(cookie, '?locale=pt-BR')

    expect(inEnglish.find((t) => t.slug === 'manga')?.name).toBe('Manga')
    expect(inPortuguese.find((t) => t.slug === 'manga')?.name).toBe('Mangá')
    expect(inPortuguese.find((t) => t.slug === 'manga')?.progressUnit).toBe(
      'Capítulos',
    )
  })

  it('traz o mapa cru junto, que é o que a folha de edição consome', async () => {
    const cookie = await signUpAdmin()
    const types = await list(cookie)

    expect(Object.keys(types[0]?.names ?? {}).sort()).toEqual(['en', 'pt-BR'])
  })

  it('conta as obras de TODOS os usuários, não só as de quem pergunta', async () => {
    const cookie = await signUpAdmin()
    await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'tv', title: 'Uma série' }),
    })

    const types = await list(cookie)
    expect(types.find((t) => t.slug === 'tv')?.entryCount).toBe(1)
    expect(types.find((t) => t.slug === 'book')?.entryCount).toBe(0)
  })

  /**
   * **O nome deste teste já mentiu uma vez.** Ele dizia "filme é o ÚNICO", e
   * continuou verde quando `game` passou a acompanhá-lo (`0044`) — porque
   * afirmava `movie` e `tv` e nunca o terceiro. Contar quantos são é o que faz
   * um teste envelhecer calado; afirmar CADA UM é o que o mantém honesto.
   */
  it('diz de cada tipo semeado se ele conta progresso', async () => {
    const cookie = await signUpAdmin()
    const types = await list(cookie)
    const counts = (slug: string) =>
      types.find((t) => t.slug === slug)?.countsProgress

    expect(counts('movie')).toBe(false)
    expect(counts('game')).toBe(false)
    expect(counts('book')).toBe(false)
    expect(counts('tv')).toBe(true)
    expect(counts('anime')).toBe(true)
    expect(counts('manga')).toBe(true)
  })

  it('diz de cada tipo semeado se ele registra TEMPO', async () => {
    // Outra pergunta que `countsProgress`, e as duas convivem: `game` **não
    // conta** (`0044`) e registra tempo (`0049`). Afirma CADA UM pelo mesmo
    // motivo do teste acima — contar quantos são é o que faz um teste
    // envelhecer calado.
    const cookie = await signUpAdmin()
    const types = await list(cookie)
    const tracks = (slug: string) =>
      types.find((t) => t.slug === slug)?.tracksTime

    expect(tracks('game')).toBe(true)
    expect(tracks('movie')).toBe(false)
    expect(tracks('tv')).toBe(false)
    expect(tracks('anime')).toBe(false)
    expect(tracks('manga')).toBe(false)
    expect(tracks('book')).toBe(false)
  })

  it('deixa sem unidade todo tipo que não conta', async () => {
    // A unidade acompanha o contador (`0048`): `Pages` ao lado de um tipo sem
    // contador é um par que a linha de `/settings/media-types` não sabe
    // explicar. Afirma CADA UM pelo mesmo motivo do teste acima.
    const cookie = await signUpAdmin()
    const types = await list(cookie)
    const unit = (slug: string) =>
      types.find((t) => t.slug === slug)?.progressUnit

    expect(unit('movie')).toBeNull()
    expect(unit('game')).toBeNull()
    expect(unit('book')).toBeNull()
    expect(unit('tv')).toBe('Episodes')
    expect(unit('anime')).toBe('Episodes')
    expect(unit('manga')).toBe('Chapters')
  })
})

describe('GET /api/media-types/templates', () => {
  it('devolve os seis embarcados, marcando o que já está instalado', async () => {
    const cookie = await signUpAdmin()

    const res = await app.request('/api/media-types/templates', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)

    const templates = (await res.json()) as Array<{
      slug: string
      installed: boolean
    }>
    expect(templates.map((t) => t.slug)).toEqual(SEEDED)
    // Numa instalação normal os seis já estão lá — e é justamente por isso que
    // a tela precisa saber: oferecer "Movie" sem dizer que ele existe levaria o
    // admin a criar um `movie-2` sem perceber.
    expect(templates.every((t) => t.installed)).toBe(true)
  })

  it('marca como não instalado o template que foi apagado', async () => {
    const cookie = await signUpAdmin()

    // Apaga e RESTAURA no mesmo teste. O `beforeEach` do arquivo preserva os
    // seis semeados de propósito — eles são o estado base da instalação —,
    // então um teste que apague um deles sem repor deixa todos os seguintes
    // rodando contra um banco diferente do que declararam.
    const before = db
      .select()
      .from(mediaTypes)
      .where(eq(mediaTypes.slug, 'book'))
      .get()
    const namesBefore = db
      .select()
      .from(mediaTypeNames)
      .where(eq(mediaTypeNames.mediaTypeId, before?.id ?? 0))
      .all()
    db.delete(mediaTypes).where(eq(mediaTypes.slug, 'book')).run()

    try {
      const res = await app.request('/api/media-types/templates', {
        headers: { Cookie: cookie },
      })
      const templates = (await res.json()) as Array<{
        slug: string
        installed: boolean
      }>

      expect(templates.find((t) => t.slug === 'book')?.installed).toBe(false)
      expect(templates.find((t) => t.slug === 'movie')?.installed).toBe(true)
    } finally {
      // O id novo é outro (AUTOINCREMENT), então os nomes voltam apontando pra
      // ele — o que importa restaurar é o slug, que é a chave que a FK usa.
      const restored = db
        .insert(mediaTypes)
        .values({
          slug: 'book',
          icon: before?.icon ?? 'book-open',
          countsProgress: before?.countsProgress ?? true,
        })
        .returning()
        .get()
      for (const name of namesBefore) {
        db.insert(mediaTypeNames)
          .values({ ...name, mediaTypeId: restored.id })
          .run()
      }
    }
  })

  it('recusa quem não é admin', async () => {
    // Ler a LISTA é de todo mundo, mas template só serve pra criar tipo — e
    // criar tipo é do admin (brief, 3.9).
    const cookie = await signUpAdmin()
    demote()

    const res = await app.request('/api/media-types/templates', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(403)
  })

  it('descreve exatamente o que a migration semeou', async () => {
    // A guarda contra a divergência que `media-types.templates.ts` assume: a
    // migration é o retrato congelado do módulo, e mudar um nome lá sem uma
    // migration que o acompanhe quebra aqui. Compara campo por campo, incluindo
    // o mapa por idioma.
    const cookie = await signUpAdmin()
    const installed = await list(cookie)

    for (const template of MEDIA_TYPE_TEMPLATES) {
      const type = installed.find((t) => t.slug === template.slug)
      expect(type, `o type ${template.slug} não foi seeded`).toBeDefined()
      expect(type?.icon).toBe(template.icon)
      expect(type?.countsProgress).toBe(template.countsProgress)
      expect(type?.tracksTime).toBe(template.tracksTime)
      expect(type?.names).toEqual(template.names)
    }
  })
})

describe('o provedor efetivo do tipo', () => {
  it('resolve sozinho quando o tipo tem UM provedor', async () => {
    const cookie = await signUpAdmin()
    const types = await list(cookie)

    const movie = types.find((t) => t.slug === 'movie')
    expect(movie?.providers).toEqual(['tmdb'])
    // Sem escolha explícita: com um candidato não há o que decidir.
    expect(movie?.effectiveProvider).toBe('tmdb')
  })

  it('é nulo no tipo sem provedor, e isso é legítimo', async () => {
    const cookie = await signUpAdmin()
    const types = await list(cookie)

    const book = types.find((t) => t.slug === 'book')
    expect(book?.providers).toEqual([])
    expect(book?.effectiveProvider).toBeNull()
  })

  it('grava a escolha explícita', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/movie', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultProvider: 'tmdb' }),
    })
    expect(res.status).toBe(200)

    const row = db
      .select()
      .from(mediaTypes)
      .where(eq(mediaTypes.slug, 'movie'))
      .get()
    expect(row?.defaultProviderSlug).toBe('tmdb')
  })

  it('recusa provedor que NÃO serve o tipo', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/book', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultProvider: 'tmdb' }),
    })

    // A FK garante que o provedor existe, não que ele sirva este tipo. Sem esta
    // guarda a busca consultaria um catálogo sem livros e diria "não achei" —
    // a mentira que o brief 3.10 manda evitar.
    expect(res.status).toBe(400)
  })

  it('`null` LIMPA a escolha; ausente não mexe', async () => {
    const cookie = await signUpAdmin()
    const patch = (body: unknown) =>
      app.request('/api/media-types/movie', {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    await patch({ defaultProvider: 'tmdb' })
    // Um PATCH que só mexe no ícone não pode apagar a escolha.
    await patch({ icon: 'film' })
    expect(
      db.select().from(mediaTypes).where(eq(mediaTypes.slug, 'movie')).get()
        ?.defaultProviderSlug,
    ).toBe('tmdb')

    await patch({ defaultProvider: null })
    expect(
      db.select().from(mediaTypes).where(eq(mediaTypes.slug, 'movie')).get()
        ?.defaultProviderSlug,
    ).toBeNull()
  })
})

describe('a guarda de admin', () => {
  it('recusa criar com 403 quem tem sessão mas não é admin', async () => {
    const cookie = await signUpAdmin()
    demote()

    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        icon: 'headphones',
        names: { en: { name: 'Podcast', plural: 'Podcasts' } },
      }),
    })

    // 403 e não 401: a pessoa entrou certo. Mandá-la pro login diria o contrário.
    expect(res.status).toBe(403)
  })

  it('recusa com 401 quem não tem sessão nenhuma', async () => {
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icon: 'headphones',
        names: { en: { name: 'Podcast', plural: 'Podcasts' } },
      }),
    })
    expect(res.status).toBe(401)
  })

  it('recusa apagar e editar para quem não é admin', async () => {
    const cookie = await signUpAdmin()
    demote()

    const patch = await app.request('/api/media-types/book', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ icon: 'newspaper' }),
    })
    const del = await app.request('/api/media-types/book', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(patch.status).toBe(403)
    expect(del.status).toBe(403)
  })
})

describe('POST /api/media-types', () => {
  it('deriva o slug do primeiro nome, sem pedi-lo ao admin', async () => {
    const cookie = await signUpAdmin()

    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        icon: 'headphones',
        names: {
          'pt-BR': {
            name: 'Audiolivro',
            plural: 'Audiolivros',
            progressUnit: 'Capítulos',
          },
        },
      }),
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as MediaTypePublic
    expect(created.slug).toBe('audiolivro')
    expect(created.name).toBe('Audiolivro')
  })

  it('aceita um idioma só — exigir todos travaria a criação', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        icon: 'trophy',
        names: { 'pt-BR': { name: 'Campanha', plural: 'Campanhas' } },
      }),
    })
    expect(res.status).toBe(201)
  })

  it('recusa mapa de idiomas vazio, que deixaria o tipo sem nome nenhum', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ icon: 'trophy', names: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('desempata slug repetido em vez de recusar', async () => {
    const cookie = await signUpAdmin()
    const body = {
      icon: 'disc-3',
      names: { en: { name: 'Movie', plural: 'Movies' } },
    }

    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    })

    // `movie` já existe entre os semeados.
    expect(((await res.json()) as MediaTypePublic).slug).toBe('movie-2')
  })
})

describe('PATCH /api/media-types/{slug}', () => {
  it('troca o ícone sem tocar no resto', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/book', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ icon: 'newspaper' }),
    })

    const updated = (await res.json()) as MediaTypePublic
    expect(updated.icon).toBe('newspaper')
    expect(updated.names['pt-BR']?.name).toBe('Livro')
  })

  it('substitui o mapa inteiro, para que apagar uma tradução seja possível', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/book', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        names: { 'pt-BR': { name: 'Livro', plural: 'Livros' } },
      }),
    })

    const updated = (await res.json()) as MediaTypePublic
    expect(Object.keys(updated.names)).toEqual(['pt-BR'])
  })

  it('responde 404 para tipo que não existe', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/podcast', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ icon: 'headphones' }),
    })
    expect(res.status).toBe(404)
  })

  it('não deixa trocar o slug, porque a FK e a URL apontam pra ele', async () => {
    const cookie = await signUpAdmin()
    await app.request('/api/media-types/book', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ slug: 'livro', icon: 'newspaper' }),
    })

    const still = db
      .select()
      .from(mediaTypes)
      .where(eq(mediaTypes.slug, 'book'))
      .get()
    expect(still).toBeDefined()
  })
})

describe('DELETE /api/media-types/{slug}', () => {
  it('recusa com 409 e devolve a CONTAGEM quando há obra usando', async () => {
    const cookie = await signUpAdmin()
    await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'tv', title: 'Uma série' }),
    })

    const res = await app.request('/api/media-types/tv', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(409)
    // A contagem viaja junto: "não dá" faria o admin adivinhar o tamanho do
    // problema.
    expect((await res.json()) as { entryCount: number }).toMatchObject({
      entryCount: 1,
    })
  })

  it('conta obra de OUTRO usuário na recusa', async () => {
    const cookie = await signUpAdmin()
    await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'book', title: 'Um livro' }),
    })

    // A obra passa a ser de outra conta; o admin não a enxerga em `/library`,
    // e mesmo assim ela segura o tipo. É o caso que a régua de 3.9 criou.
    const other = db
      .insert(users)
      .values({ username: 'outro', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    db.update(entries).set({ userId: other.id }).run()

    const res = await app.request('/api/media-types/book', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(409)
    expect((await res.json()) as { entryCount: number }).toMatchObject({
      entryCount: 1,
    })
  })

  it('apaga o tipo sem obra nenhuma', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/game', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(204)
    expect(
      db.select().from(mediaTypes).where(eq(mediaTypes.slug, 'game')).get(),
    ).toBeUndefined()
  })

  it('responde 404 para tipo que não existe', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types/podcast', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })
})

describe('o acervo de ícones', () => {
  it('recusa glifo fora do acervo', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        icon: 'youtube',
        names: { en: { name: 'YouTube video', plural: 'YouTube videos' } },
      }),
    })

    // O Lucide removeu os ícones de marca, então `youtube` não existe. Aceitar
    // a string faria a carta renderizar sem ícone nenhum, sem erro nenhum.
    expect(res.status).toBe(400)
  })

  it('aceita o glifo de tela, que é a resposta para tipo de plataforma', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        icon: 'monitor-play',
        names: {
          'pt-BR': {
            name: 'Vídeo do YouTube',
            plural: 'Vídeos do YouTube',
            progressUnit: null,
          },
        },
      }),
    })
    expect(res.status).toBe(201)
  })

  it('contém os seis glifos que a migration semeia', () => {
    // Se um corte no acervo tirasse um deles, a migration passaria a semear um
    // ícone que a escrita recusa — inconsistência que só apareceria em produção.
    for (const glyph of [
      'clapperboard',
      'monitor',
      'sparkles',
      'message-square',
      'gamepad-2',
      'book-open',
    ]) {
      expect(ICON_NAMES).toContain(glyph)
    }
  })

  it('não tem alias do Lucide, só nome canônico', () => {
    // `podcast` é alias de `mic-signal`, e alias é o que o Lucide deprecia.
    expect(ICON_NAMES).toContain('mic-signal')
    expect(ICON_NAMES).not.toContain('podcast')
  })
})

describe('vincular tipo a provedor', () => {
  /**
   * **O `beforeEach` do arquivo não restaura a junção**, e este bloco a
   * APAGA — desvincular é metade do que ele testa. Sem isto, o par
   * `(anime, anilist)` sumia para todo teste seguinte do arquivo, e o sintoma
   * era um `404` num teste que não fala de junção nenhuma: *teste que apaga
   * estado SEMEADO envenena os vizinhos, e a conta chega em outro lugar*.
   *
   * O retrato é tirado uma vez, antes de qualquer teste mexer na tabela.
   */
  let seededPairs: (typeof mediaTypeProviders.$inferSelect)[] = []

  beforeEach(() => {
    // Tirado na PRIMEIRA passagem, e não no corpo do `describe`: o corpo roda
    // na COLETA, antes de qualquer `beforeEach`, e ler o banco ali é ler um
    // estado que ainda não é o que os testes vão ver.
    if (seededPairs.length === 0) {
      seededPairs = db.select().from(mediaTypeProviders).all()
    }
    db.delete(mediaTypeProviders).run()
    db.insert(mediaTypeProviders).values(seededPairs).run()
    db.update(mediaTypes).set({ defaultProviderSlug: null }).run()
  })

  const link = (
    cookie: string,
    slug: string,
    provider: string,
    copyFrom: string,
  ) =>
    app.request(`/api/media-types/${slug}/providers/${provider}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom }),
    })

  const unlink = (cookie: string, slug: string, provider: string) =>
    app.request(`/api/media-types/${slug}/providers/${provider}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

  async function createType(cookie: string, name: string): Promise<string> {
    const res = await app.request('/api/media-types', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icon: 'book-open',
        names: { en: { name, plural: `${name}s`, progressUnit: 'Volumes' } },
      }),
    })
    return ((await res.json()) as MediaTypePublic).slug
  }

  it('copia a RECEITA inteira do par de origem, não só a associação', async () => {
    // O que faz um par funcionar não é a linha existir: é `search_body`,
    // `field_map`, `detail_path` e o token. Medido em 10/09/2026: nenhum dos
    // doze pares semeados funciona vazio, e um `Light Novel` ligado ao AniList
    // com a linha em branco herdaria `anilistSearch('ANIME')` do provedor e
    // devolveria ANIME para toda busca — plausível, na coluna certa, sem erro.
    const cookie = await signUpAdmin()
    const slug = await createType(cookie, 'Light novel')

    const res = await link(cookie, slug, 'anilist', 'manga')
    expect(res.status).toBe(200)

    const source = db
      .select()
      .from(mediaTypeProviders)
      .where(
        and(
          eq(mediaTypeProviders.mediaTypeSlug, 'manga'),
          eq(mediaTypeProviders.providerSlug, 'anilist'),
        ),
      )
      .get()
    const copy = db
      .select()
      .from(mediaTypeProviders)
      .where(
        and(
          eq(mediaTypeProviders.mediaTypeSlug, slug),
          eq(mediaTypeProviders.providerSlug, 'anilist'),
        ),
      )
      .get()

    // Campo a campo, e não só dois: é a mesma régua que fez o teste da semente
    // comparar tudo — dois campos iguais não provam que os dez são.
    expect(copy).toBeDefined()
    for (const [column, value] of Object.entries(source ?? {})) {
      if (column === 'mediaTypeSlug') {
        continue
      }
      expect(copy?.[column as keyof typeof copy]).toEqual(value)
    }
    // E a chave primária é do DESTINO, não da origem: copiá-la escreveria o par
    // de origem por cima de si mesmo.
    expect(copy?.mediaTypeSlug).toBe(slug)
  })

  it('devolve o tipo com o provedor já na lista', async () => {
    const cookie = await signUpAdmin()
    const slug = await createType(cookie, 'Light novel')

    const res = await link(cookie, slug, 'anilist', 'manga')
    const body = (await res.json()) as MediaTypePublic

    expect(body.providers).toEqual(['anilist'])
    // Com um candidato só não há o que decidir, e o efetivo se resolve sozinho.
    expect(body.effectiveProvider).toBe('anilist')
  })

  it('recusa copiar de um tipo que aquele provedor NÃO serve', async () => {
    // Sem receita de origem não há promessa a fazer — e o par (movie, anilist)
    // não existe.
    const cookie = await signUpAdmin()
    const slug = await createType(cookie, 'Light novel')

    const res = await link(cookie, slug, 'anilist', 'movie')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain(
      'movie',
    )
  })

  it('troca a receita quando se copia de novo, em vez de recusar', async () => {
    // `PUT` idempotente: repetir com outro `copyFrom` é o gesto de "copiei do
    // tipo errado". Recusar obrigaria a desvincular pra corrigir, e desvincular
    // é o caminho guardado.
    const cookie = await signUpAdmin()
    const slug = await createType(cookie, 'Light novel')

    await link(cookie, slug, 'anilist', 'manga')
    const res = await link(cookie, slug, 'anilist', 'anime')
    expect(res.status).toBe(200)

    const copy = db
      .select()
      .from(mediaTypeProviders)
      .where(
        and(
          eq(mediaTypeProviders.mediaTypeSlug, slug),
          eq(mediaTypeProviders.providerSlug, 'anilist'),
        ),
      )
      .get()
    expect(copy?.providerTypeToken).toBe('ANIME')
  })

  it('recusa quem não é admin, e a guarda cobre o SUB-CAMINHO', async () => {
    // `use('/:slug')` casa um segmento e para ali. Sem uma guarda para
    // `/:slug/*`, isto passaria — e a proteção pareceria estar cobrindo o que
    // não cobre.
    const cookie = await signUpAdmin()
    const slug = await createType(cookie, 'Light novel')
    demote()

    expect((await link(cookie, slug, 'anilist', 'manga')).status).toBe(403)
    expect((await unlink(cookie, 'anime', 'anilist')).status).toBe(403)
  })

  it('desvincula, e limpa o padrão de busca que apontava pra ali', async () => {
    // O padrão não pode apontar pra um provedor que não serve mais o tipo: ele
    // prometeria uma fonte que a busca recusa.
    const cookie = await signUpAdmin()
    await app.request('/api/media-types/anime', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultProvider: 'anilist' }),
    })

    const res = await unlink(cookie, 'anime', 'anilist')
    expect(res.status).toBe(200)

    const body = (await res.json()) as MediaTypePublic
    expect(body.providers).not.toContain('anilist')
    expect(body.effectiveProvider).not.toBe('anilist')
  })

  it('recusa desvincular com a CONTAGEM quando obra já aponta pra ali', async () => {
    // A consequência é invisível: `bindingFor` é o que serve arte, detalhe e
    // resolução. Sem a linha, a obra fica com o vínculo e sem receita — a arte
    // para de carregar e o detalhe para de abrir, sem nada dizendo por quê.
    const cookie = await signUpAdmin()
    const created = await app.request('/api/entries', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'anime', title: 'Uma obra' }),
    })
    const entry = (await created.json()) as { id: number }
    db.insert(externalIds)
      .values({
        entryId: entry.id,
        provider: 'anilist',
        externalId: '21',
        mediaType: 'anime',
      })
      .run()

    const res = await unlink(cookie, 'anime', 'anilist')

    expect(res.status).toBe(409)
    expect((await res.json()) as { entryCount: number }).toMatchObject({
      entryCount: 1,
    })
  })

  it('404 ao desvincular um par que não existe', async () => {
    const cookie = await signUpAdmin()

    expect((await unlink(cookie, 'movie', 'anilist')).status).toBe(404)
  })
})

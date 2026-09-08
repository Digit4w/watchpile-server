import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { providerCache, providers } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { titleSnapshots } from '../../db/schema/title-snapshots.js'
import { users } from '../../db/schema/users.js'
import { resetLimiter } from '../providers/providers.limiter.js'

/** O detalhe do TMDB, com os campos que o `field_map` semeado lê. */
const DETAIL = JSON.stringify({
  id: 550,
  title: 'Fight Club',
  release_date: '1999-10-15',
  poster_path: '/pB8B.jpg',
  overview: 'Um funcionário insone…',
  vote_average: 8.4,
  vote_count: 27310,
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

function respond(body: string, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status }))
}

async function add(cookie: string, externalId = '550'): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      mediaType: 'movie',
      title: 'Clube da Luta',
      source: { provider: 'tmdb', externalId },
    }),
  })
  return ((await res.json()) as { id: number }).id
}

type Detail = {
  provider: { slug: string; name: string; attribution: string | null }
  externalId: string
  title: string
  year: number | null
  synopsis: string | null
  art: string | null
  total: number | null
  ownedEntryId: number | null
}

beforeEach(() => {
  /**
   * **`title_snapshots` é da INSTALAÇÃO, e por isso escapou desta lista.**
   *
   * As outras seis tabelas daqui pendem de um usuário, e apagar o usuário as
   * levava junto ou o teste as apagava explicitamente. O snapshot não tem dono
   * — de propósito, como `art_cache` —, então ele sobrevive a `delete(users)` e
   * o teste seguinte encontra uma obra que "já foi buscada".
   *
   * O modo de falha foi na direção perigosa: o teste de "sem chave, 503"
   * passou a receber **200**, porque a degradação encontrou o snapshot que um
   * teste anterior gravou. Vazamento que faz um teste de recusa passar como
   * sucesso não aparece como flake — aparece como comportamento novo.
   */
  db.delete(titleSnapshots).run()
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
  resetLimiter()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/search/{provider}/{externalId}', () => {
  it('maps the provider detail through the field map', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      externalId: '550',
      title: 'Fight Club',
      year: 1999,
      synopsis: 'Um funcionário insone…',
      ownedEntryId: null,
    })
    // O NOME do provedor, não o slug: slug é chave, não rótulo.
    expect(body.provider.name).toBe('TMDB')
  })

  /**
   * A arte muda de natureza com a posse (brief, 3.10): emprestada da CDN
   * enquanto a obra não é sua, e da nossa rota de cache quando passa a ser.
   */
  it('hotlinks the art while the title is not yours', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail

    expect(body.art).toContain('/pB8B.jpg')
    expect(body.art).not.toContain('/api/entries')
  })

  it('says which entry is yours when you already have it', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)
    const entryId = await add(cookie)

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail

    expect(body.ownedEntryId).toBe(entryId)
    /**
     * E a arte passa a vir do cache, porque agora ela é adquirida — **com o
     * vínculo nomeado**. Sem o `?source=`, o endereço resolvia pelo vínculo
     * EFETIVO da obra, então pedir o detalhe por um provedor devolvia a arte de
     * outro. Ver `titles.resolve.ts`.
     */
    expect(body.art).toBe(`/api/entries/${entryId}/art?source=tmdb`)
  })

  /**
   * O provedor respondeu, e respondeu que não tem. É o não-encontrado da tela
   * de detalhe — não a recusa, e por isso não tem `reason` nem 503.
   */
  it('404s when the provider has no such id', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond('{"status_code":34}', 404)

    const res = await app.request('/api/search/tmdb/999999?type=movie', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    expect((await res.json()) as { reason?: string }).not.toHaveProperty(
      'reason',
    )
  })

  it('503s with a reason when there is no key', async () => {
    const cookie = await signUpAdmin()

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(503)
    expect((await res.json()) as { reason: string }).toMatchObject({
      reason: 'not-configured',
    })
  })

  it('404s on a provider this server does not have', async () => {
    const cookie = await signUpAdmin()

    const res = await app.request('/api/search/nope/550?type=movie', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })

  /**
   * A nota do provedor é CONTEXTO, e vem ao lado da nota do usuário na tela
   * justamente porque são coisas diferentes: uma se lê, a outra se edita.
   */
  it('carries the provider score as context, not as the entry rating', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as { score: number; votes: number }

    expect(body).toMatchObject({ score: 8.4, votes: 27310 })
  })

  it('rejects without a session', async () => {
    expect((await app.request('/api/search/tmdb/550?type=movie')).status).toBe(
      401,
    )
  })
})

describe('GET /api/entries/{id}/details', () => {
  /**
   * A MESMA forma nos dois endereços — é isso que deixa a tela ser uma peça
   * só. Se um dia divergirem, este teste é o que avisa.
   */
  it('answers the same shape as the provider route', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)
    const entryId = await add(cookie)

    const fromProvider = (await (
      await app.request('/api/search/tmdb/550?type=movie', {
        headers: { Cookie: cookie },
      })
    ).json()) as Detail
    const ofEntry = (await (
      await app.request(`/api/entries/${entryId}/details`, {
        headers: { Cookie: cookie },
      })
    ).json()) as Detail

    expect(ofEntry).toEqual(fromProvider)
  })

  /**
   * Obra digitada à mão não tem vínculo, e a tela lê o 404 como "não há
   * contexto", não como erro — ela continua desenhando o que já tem.
   */
  it('404s on a hand-typed title, without calling out', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = vi.spyOn(globalThis, 'fetch')

    const created = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'movie', title: 'Digitada à mão' }),
    })
    const { id } = (await created.json()) as { id: number }

    const res = await app.request(`/api/entries/${id}/details`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    expect(call).not.toHaveBeenCalled()
  })

  it("404s on someone else's title", async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)
    const entryId = await add(cookie)

    const other = db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    db.update(entries)
      .set({ userId: other.id })
      .where(eq(entries.id, entryId))
      .run()

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })

  /**
   * A segunda visita não gasta cota: a resposta do detalhe passa pelo mesmo
   * cache da busca. É o que torna a tela barata de reabrir.
   */
  it('serves the second visit from the response cache', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(DETAIL)
    const entryId = await add(cookie)

    await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    call.mockClear()

    const second = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })

    expect(second.status).toBe(200)
    expect(call).not.toHaveBeenCalled()
  })
})

/** Uma temporada do TMDB, no formato que ele devolve de verdade. */
const SEASON = JSON.stringify({
  season_number: 1,
  episodes: [
    {
      episode_number: 1,
      name: 'Pilot',
      overview: 'Um corpo aparece num campo.',
      still_path: '/still1.jpg',
      air_date: '2026-08-17',
      runtime: 57,
    },
    // Sem número não vira linha: a unidade É a posição no contador.
    { name: 'Sem número', overview: 'x' },
  ],
})

const SERIES = JSON.stringify({
  id: 1396,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  overview: 'Um professor de química…',
  seasons: [
    { season_number: 1, name: 'Season 1', episode_count: 7 },
    // Sem pôster: a arte do grupo é opcional, e o cartão cai no ladrilho.
    { season_number: 2, name: 'Season 2', episode_count: 13 },
  ],
})

describe('unidades — episódios, capítulos, o que o provedor tiver', () => {
  /**
   * O caso que prova que o desenho não é do TMDB: o par (tipo, provedor) é
   * quem declara se há unidades, e o MESMO provedor serve os dois tipos.
   */
  it('a série tem unidades e o filme não, no mesmo provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(SERIES)

    const series = (await (
      await app.request('/api/search/tmdb/1396?type=tv', {
        headers: { Cookie: cookie },
      })
    ).json()) as Detail & { hasUnits: boolean; unitGroups: unknown[] }

    respond(DETAIL)
    const movie = (await (
      await app.request('/api/search/tmdb/550?type=movie', {
        headers: { Cookie: cookie },
      })
    ).json()) as Detail & { hasUnits: boolean; unitGroups: unknown[] }

    expect(series.hasUnits).toBe(true)
    expect(movie.hasUnits).toBe(false)
    expect(movie.unitGroups).toEqual([])
  })

  /**
   * O rótulo do grupo vem do PROVEDOR — nunca escrevemos "Temporada" em lugar
   * nenhum, e é isso que faz volume de mangá funcionar sem código novo.
   */
  it('os grupos saem da MESMA resposta de detalhe, com o nome do provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(SERIES)

    const res = await app.request('/api/search/tmdb/1396?type=tv', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as {
      unitGroups: { number: number; name: string; count: number | null }[]
    }

    expect(body.unitGroups).toEqual([
      { number: 1, name: 'Season 1', count: 7, art: null },
      { number: 2, name: 'Season 2', count: 13, art: null },
    ])
    // Uma ida à rede só: os grupos vinham dentro do detalhe.
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('lista as unidades de um grupo, pelo mapa da junção', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respond(SEASON)

    const res = await app.request(
      '/api/search/tmdb/1396/units?type=tv&group=1',
      {
        headers: { Cookie: cookie },
      },
    )
    const body = (await res.json()) as {
      units: { number: number; title: string | null; art: string | null }[]
    }

    expect(res.status).toBe(200)
    // A linha sem número foi descartada, não virou uma unidade vazia.
    expect(body.units).toHaveLength(1)
    expect(body.units[0]).toMatchObject({ number: 1, title: 'Pilot' })
    expect(body.units[0]?.art).toContain('/still1.jpg')
    // O `{group}` foi para a URL, como o `{id}`.
    expect(String(call.mock.calls[0]?.[0])).toContain('/tv/1396/season/1')
  })

  /**
   * Filme não tem episódio: a pergunta não faz sentido, e isso não é
   * indisponibilidade de ninguém — 404, não 503.
   */
  it('404 quando o par não declara unidades', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = vi.spyOn(globalThis, 'fetch')

    const res = await app.request('/api/search/tmdb/550/units?type=movie', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    // E nem chegou a bater no provedor: a definição já respondeu.
    expect(call).not.toHaveBeenCalled()
  })

  it('a obra da biblioteca lista pelo próprio tipo, sem ninguém informar', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(SERIES)
    const created = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'tv',
        title: 'Breaking Bad',
        source: { provider: 'tmdb', externalId: '1396' },
      }),
    })
    const { id } = (await created.json()) as { id: number }

    respond(SEASON)
    const res = await app.request(`/api/entries/${id}/units?group=1`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(((await res.json()) as { units: unknown[] }).units).toHaveLength(1)
  })
})

/**
 * O defeito de 01/09/2026, visto na tela: pedir o detalhe de uma SÉRIE trazia
 * o filme de mesmo id. O endpoint de detalhe era do provedor, e o TMDB lê
 * `/movie/{id}` e `/tv/{id}` — só podia ser um dos dois.
 *
 * A régua de `search_path` estendida: **o "como" de um DETALHE também é do
 * par**. O cache de arte tinha o mesmo defeito, latente, porque só tinha sido
 * exercido com filme.
 */
describe('o detalhe é lido pelo endpoint do PAR', () => {
  it('série lê /tv/{id} e filme lê /movie/{id}, no mesmo provedor', async () => {
    const cookie = await signUpAdmin()
    giveKey()

    const series = respond(SERIES)
    await app.request('/api/search/tmdb/1396?type=tv', {
      headers: { Cookie: cookie },
    })
    expect(String(series.mock.calls[0]?.[0])).toContain('/tv/1396')
    expect(String(series.mock.calls[0]?.[0])).not.toContain('/movie/')

    vi.restoreAllMocks()
    const movie = respond(DETAIL)
    await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    expect(String(movie.mock.calls[0]?.[0])).toContain('/movie/550')
  })
})

/**
 * Links são CONTEXTO do provedor, não `external_ids`: IMDb e Wikidata não são
 * provedores que este servidor conhece, e criar linha pra eles seria inventar
 * provedor que ninguém configurou.
 */
describe('links para fora', () => {
  it('monta só os que o provedor devolveu, pelo molde da definição', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(
      JSON.stringify({
        id: 550,
        title: 'Fight Club',
        overview: 'x',
        external_ids: { imdb_id: 'tt0137523', wikidata_id: null },
      }),
    )

    const res = await app.request('/api/search/tmdb/550?type=movie', {
      headers: { Cookie: cookie },
    })
    const { links } = (await res.json()) as {
      links: { label: string; url: string }[]
    }

    expect(links).toEqual([
      { label: 'TMDB', url: 'https://www.themoviedb.org/movie/550' },
      { label: 'IMDb', url: 'https://www.imdb.com/title/tt0137523/' },
    ])
    // O Wikidata veio nulo: declarado, mas não vira item morto na caixa.
    expect(links.some(({ label }) => label === 'Wikidata')).toBe(false)
  })

  it('a URL do próprio provedor difere por TIPO, e por isso o link é do par', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(JSON.stringify({ id: 1396, name: 'Breaking Bad', overview: 'x' }))

    const res = await app.request('/api/search/tmdb/1396?type=tv', {
      headers: { Cookie: cookie },
    })
    const { links } = (await res.json()) as {
      links: { label: string; url: string }[]
    }

    expect(links[0]?.url).toBe('https://www.themoviedb.org/tv/1396')
  })
})

/**
 * **A obra sobrevive ao provedor** — 07/09/2026 (brief, 3.10).
 *
 * A régua vinha do cache de arte: o que a pessoa TEM não depende da CDN de
 * terceiro daqui a dois anos. Até aqui a arte era a única parte da obra que a
 * cumpria, e com o AniList desativado toda obra de anime e mangá da biblioteca
 * respondia recusa assim que o `provider_cache` expirava.
 */
describe('o snapshot, quando o provedor não responde', () => {
  /** Falha de rede depois de UMA resposta boa — o caminho que o ciclo existe pra cobrir. */
  async function seedThenBreak(cookie: string): Promise<number> {
    respond(DETAIL)
    const entryId = await add(cookie)
    // A primeira leitura viva é quem grava. Depois dela, o provedor some.
    await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sem rede'))
    db.delete(providerCache).run()
    return entryId
  }

  it('serves the stored title, saying from when it is', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const entryId = await seedThenBreak(cookie)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail & {
      snapshot: { fetchedAt: string; reason: string } | null
    }

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      title: 'Fight Club',
      year: 1999,
      synopsis: 'Um funcionário insone…',
      ownedEntryId: entryId,
    })
    // A data é o que separa degradar de mentir.
    expect(body.snapshot?.fetchedAt).toBeTruthy()
    expect(body.snapshot?.reason).toBe('unreachable')
  })

  /**
   * Resposta viva não carrega data: `snapshot` nulo é o que diz "isto é de
   * agora". Sem esta metade, a tela mostraria o aviso o tempo todo.
   */
  it('says nothing when the provider did answer', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)
    const entryId = await add(cookie)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail & { snapshot: unknown }

    expect(body.snapshot).toBeNull()
  })

  /**
   * A arte degradada vem do NOSSO cache, não da CDN que acabou de não
   * responder — é a régua da posse, e é ela que faz a carta abrir offline.
   */
  it('keeps pointing the art at our cache route', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const entryId = await seedThenBreak(cookie)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail

    expect(body.art).toBe(`/api/entries/${entryId}/art?source=tmdb`)
  })

  /**
   * **`not-found` NÃO degrada.** Ali o provedor respondeu, e respondeu que não
   * tem — servir o snapshot faria a tela afirmar que existe uma obra que a
   * fonte acabou de negar.
   */
  it('still 404s when the provider says it has no such title', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respond(DETAIL)
    const entryId = await add(cookie)
    await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })

    db.delete(providerCache).run()
    respond('{"status_code":34}', 404)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })

  /**
   * Sem snapshot não há o que degradar, e a recusa continua sendo a resposta
   * certa — é a diferença entre uma obra que já foi vista e uma que nunca foi.
   */
  it('refuses when nothing was ever stored', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sem rede'))
    const entryId = await add(cookie)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(503)
  })

  /**
   * A faixa de unidades viria do provedor que acabou de não responder —
   * *resposta que a tela responde sozinha vence a que viria da rede*.
   */
  it('stops offering units it could not list', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const entryId = await seedThenBreak(cookie)

    const res = await app.request(`/api/entries/${entryId}/details`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as Detail & {
      hasUnits: boolean
      unitGroups: unknown[]
      relations: unknown[]
    }

    expect(body.hasUnits).toBe(false)
    expect(body.unitGroups).toEqual([])
    expect(body.relations).toEqual([])
  })
})

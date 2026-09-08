import { describe, expect, it } from 'vitest'
import { malSource } from './import.mal.js'
import { ImportFailure } from './import.types.js'

/**
 * A fonte do MyAnimeList, contra um `fetch` dublê.
 *
 * **As respostas aqui são a forma MEDIDA em 07/09/2026**, contra a API real com
 * um Client ID de verdade — não são invenção. O que estes testes congelam é
 * essa forma: o dia em que ela mudar, quem quebra é aqui, e não a tela de
 * alguém no meio de um import.
 */

type Rota = (url: string) => { status: number; body: unknown }

function dublê(rota: Rota): typeof fetch {
  return (async (url: string | URL | Request) => {
    const { status, body } = rota(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

/** A forma medida de uma linha de `animelist`. */
const linhaAnime = (id: number, title: string, over = {}) => ({
  node: { id, title, main_picture: { medium: 'm', large: 'l' } },
  list_status: {
    status: 'completed',
    score: 7,
    num_episodes_watched: 26,
    is_rewatching: false,
    updated_at: '2007-03-07T17:49:39+00:00',
    ...over,
  },
})

/** A de `mangalist` — e ela é DIFERENTE, que é o ponto de metade destes testes. */
const linhaManga = (id: number, title: string, over = {}) => ({
  node: { id, title, main_picture: { medium: 'm', large: 'l' } },
  list_status: {
    status: 'reading',
    score: 0,
    num_chapters_read: 380,
    num_volumes_read: 41,
    is_rereading: false,
    updated_at: '2020-01-02T03:04:05+00:00',
    ...over,
  },
})

const vazio = { data: [], paging: {} }

/** Responde a lista pedida e vazio na outra. */
function listas(anime: unknown[] = [], manga: unknown[] = []): typeof fetch {
  return dublê((url) => ({
    status: 200,
    body: url.includes('/animelist')
      ? { data: anime, paging: {} }
      : { data: manga, paging: {} },
  }))
}

describe('o vocabulário de status', () => {
  it('traduz os cinco de anime e os cinco de mangá', async () => {
    // Medido em duas contas reais: anime usa `watching`/`plan_to_watch`, mangá
    // usa `reading`/`plan_to_read`, e os três do meio coincidem.
    const { items } = await malSource(
      'f',
      'k',
      listas(
        [
          linhaAnime(1, 'A', { status: 'watching' }),
          linhaAnime(2, 'B', { status: 'completed' }),
          linhaAnime(3, 'C', { status: 'on_hold' }),
          linhaAnime(4, 'D', { status: 'dropped' }),
          linhaAnime(5, 'E', { status: 'plan_to_watch' }),
        ],
        [
          linhaManga(6, 'F', { status: 'reading' }),
          linhaManga(7, 'G', { status: 'plan_to_read' }),
        ],
      ),
    ).read()

    expect(items.map((i) => i.status)).toEqual([
      'watching',
      'completed',
      'on-hold',
      'dropped',
      'planned',
      'watching',
      'planned',
    ])
  })

  it('descarta a linha cujo status não conhecemos', async () => {
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'A'), linhaAnime(2, 'B', { status: 'inventado' })]),
    ).read()

    expect(items.map((i) => i.title)).toEqual(['A'])
  })
})

describe('o campo de progresso muda com o TIPO', () => {
  it('lê episódios no anime e capítulos no mangá', async () => {
    /**
     * **É a falha mais silenciosa que esta fonte poderia ter.** Ler
     * `num_episodes_watched` numa lista de mangá devolveria zero para todas as
     * obras, sem erro nenhum — a pessoa veria a biblioteca inteira em "0 / ?" e
     * não teria como saber por quê.
     */
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'Anime')], [linhaManga(2, 'Mangá')]),
    ).read()

    expect(items).toEqual([
      expect.objectContaining({ mediaType: 'anime', progress: 26 }),
      expect.objectContaining({ mediaType: 'manga', progress: 380 }),
    ])
  })

  it('progresso ausente é zero, não quebra', async () => {
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'A', { num_episodes_watched: undefined })]),
    ).read()

    expect(items[0]?.progress).toBe(0)
  })
})

describe('a identidade', () => {
  it('é SEMPRE parcial, porque o MAL entrega um id só', async () => {
    // O equivalente no AniList existe e este import não tem como sabê-lo, então
    // a obra entra com um vínculo em vez de dois — que é o que a tela promete
    // ao oferecer o vínculo depois.
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(48, '.hack//Sign')]),
    ).read()

    expect(items[0]).toMatchObject({
      links: [{ provider: 'mal', externalId: '48' }],
      partialIdentity: true,
    })
  })

  it('a data retroativa atravessa com o fuso', async () => {
    // `updated_at` vem ISO com fuso — medido. É ela que faz o evento do
    // `event_log` cair no dia certo em vez do dia da migração.
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'A')]),
    ).read()

    expect(items[0]?.occurredAt?.toISOString()).toBe('2007-03-07T17:49:39.000Z')
  })

  it('data ilegível vira nulo, e a obra entra assim mesmo', async () => {
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'A', { updated_at: 'ontem' })]),
    ).read()

    expect(items[0]?.occurredAt).toBeNull()
    expect(items[0]?.title).toBe('A')
  })

  it('não traz o total da obra, e é decisão', async () => {
    // A lista devolve o progresso de quem acompanha, não o tamanho da obra.
    // Pedir `node{num_episodes}` custaria o campo em toda página por um dado
    // que a tela de detalhe busca quando precisa.
    const { items } = await malSource(
      'f',
      'k',
      listas([linhaAnime(1, 'A')]),
    ).read()

    expect(items[0]?.total).toBeNull()
  })
})

describe('a paginação', () => {
  it('segue `paging.next` VERBATIM', async () => {
    /**
     * Ele vem como URL completa, já com `offset` e `fields` — medido. Remontá-la
     * à mão repetiria uma conta que o provedor já fez, e é assim que se perde um
     * parâmetro numa página do meio.
     */
    const vistas: string[] = []
    const impl = dublê((url) => {
      vistas.push(url)
      if (url.includes('/mangalist')) {
        return { status: 200, body: vazio }
      }
      if (url.includes('offset=1000')) {
        return { status: 200, body: { data: [linhaAnime(2, 'B')], paging: {} } }
      }
      return {
        status: 200,
        body: {
          data: [linhaAnime(1, 'A')],
          paging: {
            next: 'https://api.myanimelist.net/v2/users/f/animelist?offset=1000&limit=1000&fields=list_status',
          },
        },
      }
    })

    const { items } = await malSource('f', 'k', impl).read()

    expect(items.map((i) => i.title)).toEqual(['A', 'B'])
    expect(vistas[1]).toBe(
      'https://api.myanimelist.net/v2/users/f/animelist?offset=1000&limit=1000&fields=list_status',
    )
  })

  it('escapa o nome de usuário na URL', async () => {
    const vistas: string[] = []
    const impl = dublê((url) => {
      vistas.push(url)
      return { status: 200, body: vazio }
    })

    await malSource('nome com espaço/', 'k', impl).read()

    expect(vistas[0]).toContain('nome%20com%20espa%C3%A7o%2F')
  })
})

describe('as falhas, e o CORPO é quem as separa', () => {
  const falha = async (status: number, body: unknown, kind = 'anime') => {
    const impl = dublê((url) =>
      url.includes(`/${kind}list`)
        ? { status, body }
        : { status: 200, body: vazio },
    )
    return malSource('f', 'k', impl)
      .read()
      .then(
        () => null,
        (e: unknown) => e as ImportFailure,
      )
  }

  it('403 `not_permitted` é lista privada; 403 `forbidden` é configuração', async () => {
    /**
     * **Dois 403 com significados opostos**, medidos em 07/09/2026. Decidir pelo
     * status mandaria metade das pessoas consertar a coisa errada: uma precisa
     * tornar o perfil público, a outra é a chave da instalação. É o mesmo
     * defeito que o conserto de recusa de hoje tirou da busca — aqui, antes de
     * nascer.
     */
    const privada = await falha(403, {
      message: 'Access to this list has been restricted by the owner.',
      error: 'not_permitted',
    })
    const semChave = await falha(403, { message: '', error: 'forbidden' })

    expect(privada?.kind).toBe('private-profile')
    expect(semChave?.kind).toBe('source-refused')
  })

  it('diz QUAL lista é privada, porque pode ser só uma', async () => {
    // Medido: um perfil pode ter o anime público e o mangá restrito. Importar
    // metade em silêncio seria pior — a pessoa veria a biblioteca sem mangá
    // nenhum e concluiria que o mangá dela sumiu.
    const so_manga = await falha(403, { error: 'not_permitted' }, 'manga')

    expect(so_manga).toMatchObject({
      kind: 'private-profile',
      params: { list: 'manga' },
    })
  })

  it('404 é usuário que não existe', async () => {
    expect((await falha(404, { error: 'not_found' }))?.kind).toBe(
      'user-not-found',
    )
  })

  it('400 "Invalid client id" é do admin', async () => {
    expect((await falha(400, { error: 'bad_request' }))?.kind).toBe(
      'source-refused',
    )
  })

  it('5xx é do lado deles, e a saída é esperar', async () => {
    expect((await falha(503, {}))?.kind).toBe('source-down')
  })

  it('rede fora não vira recusa do provedor', async () => {
    // Ele não respondeu; nada foi recusado. Chamar isso de `refused` mandaria a
    // pessoa conferir o que digitou.
    const impl: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const erro = await malSource('f', 'k', impl)
      .read()
      .then(
        () => null,
        (e: unknown) => e as ImportFailure,
      )

    expect(erro?.kind).toBe('source-down')
  })

  it('corpo ilegível não esconde a falha', async () => {
    const impl: typeof fetch = async () =>
      new Response('<html>', { status: 500 })
    const erro = await malSource('f', 'k', impl)
      .read()
      .then(
        () => null,
        (e: unknown) => e as ImportFailure,
      )

    expect(erro).toBeInstanceOf(ImportFailure)
    expect(erro?.kind).toBe('source-down')
  })
})

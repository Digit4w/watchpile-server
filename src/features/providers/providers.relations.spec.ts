import { describe, expect, it } from 'vitest'
import type { RelationMap } from '../../db/schema/providers.js'
import { mapRelations } from './providers.relations.js'

const BASE = {
  providerSlug: 'p',
  artTemplate: null,
  workType: 'anime',
  typesByToken: { ANIME: 'anime', MANGA: 'manga' },
}

describe('a lista de vínculos', () => {
  it('lê a aresta e o nó, do jeito do AniList', () => {
    const result = mapRelations({
      ...BASE,
      body: {
        data: {
          Media: {
            relations: {
              edges: [
                {
                  relationType: 'ADAPTATION',
                  node: {
                    id: 30002,
                    type: 'MANGA',
                    title: { romaji: 'Berserk' },
                    startDate: { year: 1989 },
                  },
                },
              ],
            },
          },
        },
      },
      map: {
        path: 'data.Media.relations.edges',
        kind: 'relationType',
        id: 'node.id',
        title: 'node.title.romaji',
        year: 'node.startDate.year',
        typeToken: 'node.type',
      },
    })

    expect(result).toEqual([
      {
        // `ADAPTATION` normalizado pela mesma regra do subtipo.
        kind: 'Adaptation',
        provider: 'p',
        externalId: '30002',
        // O que torna o vínculo navegável: o token virou o NOSSO slug.
        type: 'manga',
        title: 'Berserk',
        year: 1989,
        art: null,
      },
    ])
  })

  it('objeto único é lista de um — o `parent_game` do IGDB', () => {
    /**
     * `parent_game` não é array, e exigir que fosse obrigaria a definição a
     * mentir sobre a resposta.
     */
    const result = mapRelations({
      ...BASE,
      workType: 'game',
      body: { parent_game: { id: 14593, name: 'Hollow Knight' } },
      map: {
        path: 'parent_game',
        kindConst: 'parent',
        id: 'id',
        title: 'name',
      },
    })

    expect(result).toEqual([
      {
        kind: 'Parent',
        provider: 'p',
        externalId: '14593',
        // Sem `typeToken`, o nó herda o tipo da obra: no IGDB tudo é jogo.
        type: 'game',
        title: 'Hollow Knight',
        year: null,
        art: null,
      },
    ])
  })

  it('o ano do vínculo respeita o FORMATO declarado', () => {
    /**
     * **O defeito que voltou por outra porta.** O `first_release_date` do IGDB é
     * timestamp Unix, e a primeira versão deste módulo tinha um `yearOf`
     * próprio: lia quatro dígitos e devolvia **1487**. Duas contas da mesma
     * coisa é como uma fica pra trás — e a que ficou foi a nova.
     */
    const result = mapRelations({
      ...BASE,
      workType: 'game',
      body: {
        parent_game: { id: 1, name: 'Hollow Knight', d: 1_487_894_400 },
      },
      map: {
        path: 'parent_game',
        kindConst: 'parent',
        id: 'id',
        title: 'name',
        year: 'd',
        yearFormat: 'unix-seconds',
      },
    })

    expect(result[0]?.year).toBe(2017)
  })

  it('ausência de vínculo é lista vazia, não erro', () => {
    expect(
      mapRelations({
        ...BASE,
        body: {},
        map: { path: 'parent_game', id: 'id', title: 'name' },
      }),
    ).toEqual([])
  })

  it('sem `relations` no mapa, não há o que ler', () => {
    expect(
      mapRelations({
        ...BASE,
        body: { qualquer: 1 },
        map: undefined,
      }),
    ).toEqual([])
  })

  it('token que a instalação NÃO conhece derruba o item', () => {
    /**
     * Um vínculo pra um tipo que este servidor não tem não é navegável, e
     * mostrá-lo seria uma carta que não abre — "affordance descreve o que
     * existe". Acontece de verdade: o admin pode ter apagado o tipo `manga`.
     */
    const result = mapRelations({
      ...BASE,
      typesByToken: { ANIME: 'anime' },
      body: {
        edges: [
          { relationType: 'SEQUEL', node: { id: 1, type: 'ANIME', t: 'Fica' } },
          {
            relationType: 'ADAPTATION',
            node: { id: 2, type: 'MANGA', t: 'Sai' },
          },
        ],
      },
      map: {
        path: 'edges',
        kind: 'relationType',
        id: 'node.id',
        title: 'node.t',
        typeToken: 'node.type',
      },
    })

    expect(result.map((r) => r.title)).toEqual(['Fica'])
  })
})

describe('a junção JSON:API', () => {
  /** O Kitsu nomeia o tipo em minúsculas, ao contrário do AniList. */
  const KITSU = { ...BASE, typesByToken: { anime: 'anime', manga: 'manga' } }

  const kitsuBody = {
    data: [
      {
        attributes: { role: 'adaptation' },
        relationships: { destination: { data: { type: 'anime', id: '7' } } },
      },
    ],
    included: [
      {
        type: 'anime',
        id: '7',
        attributes: { canonicalTitle: 'Berserk', startDate: '1997-10-08' },
      },
    ],
  }

  const kitsuMap: RelationMap = {
    path: 'data',
    kind: 'attributes.role',
    includeRef: 'relationships.destination.data',
    id: 'id',
    title: 'attributes.canonicalTitle',
    year: 'attributes.startDate',
    typeToken: 'type',
  }

  it('casa o item com o recurso incluído', () => {
    /**
     * `kind` sai do ITEM, porque é ele que carrega a relação; o resto sai do
     * recurso RESOLVIDO, porque é ele que é a obra.
     */
    expect(mapRelations({ ...KITSU, body: kitsuBody, map: kitsuMap })).toEqual([
      {
        kind: 'Adaptation',
        provider: 'p',
        externalId: '7',
        type: 'anime',
        title: 'Berserk',
        year: 1997,
        art: null,
      },
    ])
  })

  it('o par (tipo, id) é a chave — id sozinho colidiria', () => {
    /**
     * Em JSON:API o id é único DENTRO do tipo, então um `anime` 8 e um `manga`
     * 8 convivem. Casar só por id devolveria a obra errada, com o título certo
     * na coluna certa e nada acusando.
     */
    const body = {
      data: [
        {
          attributes: { role: 'adaptation' },
          relationships: { destination: { data: { type: 'manga', id: '8' } } },
        },
      ],
      included: [
        { type: 'anime', id: '8', attributes: { canonicalTitle: 'O anime' } },
        { type: 'manga', id: '8', attributes: { canonicalTitle: 'O mangá' } },
      ],
    }

    const result = mapRelations({
      ...KITSU,
      body: body,
      map: kitsuMap,
    })
    expect(result[0]?.title).toBe('O mangá')
    expect(result[0]?.type).toBe('manga')
  })

  it('referência sem recurso correspondente derruba o item', () => {
    // Resposta truncada pela paginação: a referência existe e o incluído não.
    const body = {
      data: [
        {
          attributes: { role: 'sequel' },
          relationships: { destination: { data: { type: 'anime', id: '99' } } },
        },
      ],
      included: [],
    }
    expect(mapRelations({ ...KITSU, body: body, map: kitsuMap })).toEqual([])
  })
})

/**
 * As RECOMENDAÇÕES passam pela MESMA função, e estes três casos são o que
 * justifica isso — 03/09/2026.
 *
 * Eles congelam a forma **medida** de cada provedor no dia em que ela foi
 * medida. Não são teste de mapeador: o mapeador já está coberto acima. São
 * teste de que a definição descreve o que o provedor de verdade devolve — que
 * é a única coisa que um refactor de `providers.seed.ts` pode quebrar em
 * silêncio, porque nada mais lê aqueles caminhos.
 */
describe('a lista de recomendações', () => {
  it('o TMDB devolve envelope paginado, e o tipo vem do endpoint', () => {
    /**
     * `recommendations.results`, via `append_to_response`. **Sem `typeToken`**:
     * `/movie/{id}` só devolve `movie`, então o tipo da obra é a resposta certa
     * — e é o `workType` que o mapeador usa quando o mapa não declara token.
     */
    const result = mapRelations({
      ...BASE,
      workType: 'movie',
      // O molde de verdade da definição: a arte da recomendação passa pelo
      // MESMO `art_template` da obra, porque é arte do mesmo catálogo.
      artTemplate: 'https://image.tmdb.org/t/p/w342{path}',
      body: {
        recommendations: {
          page: 1,
          total_results: 538,
          results: [
            {
              id: 438631,
              title: 'Dune',
              media_type: 'movie',
              poster_path: '/v1.jpg',
              release_date: '2021-09-15',
            },
          ],
        },
      },
      map: {
        path: 'recommendations.results',
        id: 'id',
        title: 'title',
        art: 'poster_path',
        year: 'release_date',
      },
    })

    expect(result).toEqual([
      {
        kind: null,
        provider: 'p',
        externalId: '438631',
        type: 'movie',
        title: 'Dune',
        year: 2021,
        art: 'https://image.tmdb.org/t/p/w342/v1.jpg',
      },
    ])
  })

  it('o AniList tem DOIS saltos até a obra, e o voto fica pelo caminho', () => {
    /**
     * `node` é o voto — ele carrega `rating`, quantos concordaram — e
     * `mediaRecommendation` é a obra. **O `rating` não sobe**: ele já serviu
     * pra ordenar do lado deles, com `sort: RATING_DESC`, e o contrato não tem
     * campo pra um número que só faz sentido dentro da escala do provedor.
     */
    const result = mapRelations({
      ...BASE,
      map: {
        path: 'data.Media.recommendations.edges',
        id: 'node.mediaRecommendation.id',
        title: 'node.mediaRecommendation.title.romaji',
        year: 'node.mediaRecommendation.startDate.year',
        typeToken: 'node.mediaRecommendation.type',
      },
      body: {
        data: {
          Media: {
            recommendations: {
              edges: [
                {
                  node: {
                    rating: 1172,
                    mediaRecommendation: {
                      id: 21827,
                      type: 'ANIME',
                      title: { romaji: 'Violet Evergarden' },
                      startDate: { year: 2018 },
                    },
                  },
                },
                /**
                 * **Recomendação apontando pro vazio.** Acontece quando a obra
                 * recomendada sai do catálogo; o mapeador já derruba item sem
                 * id e sem título, e este caso é o que prova que ela não vira
                 * carta em branco na tela.
                 */
                { node: { rating: 4, mediaRecommendation: null } },
              ],
            },
          },
        },
      },
    })

    expect(result).toEqual([
      {
        kind: null,
        provider: 'p',
        externalId: '21827',
        type: 'anime',
        title: 'Violet Evergarden',
        year: 2018,
        art: null,
      },
    ])
  })

  it('o IGDB devolve os dez dentro do array de um, com o ano em timestamp', () => {
    /**
     * `0.similar_games`, porque o detalhe dele é `[{ … }]`. E o ano é
     * **timestamp Unix**, o mesmo `yearFormat` do `parent_game` — sem ele,
     * `1412035200` daria o ano 1412.
     */
    const result = mapRelations({
      ...BASE,
      workType: 'game',
      artTemplate:
        'https://images.igdb.com/igdb/image/upload/t_cover_big/{path}.jpg',
      body: {
        0: {
          similar_games: [
            {
              id: 3025,
              name: 'Middle-earth: Shadow of Mordor',
              first_release_date: 1_412_035_200,
              cover: { image_id: 'co20pd' },
            },
          ],
        },
      },
      map: {
        path: '0.similar_games',
        id: 'id',
        title: 'name',
        art: 'cover.image_id',
        year: 'first_release_date',
        yearFormat: 'unix-seconds',
      },
    })

    expect(result).toEqual([
      {
        kind: null,
        provider: 'p',
        externalId: '3025',
        type: 'game',
        title: 'Middle-earth: Shadow of Mordor',
        year: 2014,
        art: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co20pd.jpg',
      },
    ])
  })
})

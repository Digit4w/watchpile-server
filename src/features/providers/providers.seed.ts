import type {
  AuthStyle,
  CredentialSpec,
  FieldMap,
  OptionSpec,
  ProviderBody,
  ProviderEndpoints,
  RateLimit,
  UnitMap,
} from '../../db/schema/providers.js'

export type ProviderSeed = {
  slug: string
  name: string
  /** Molde da URL de arte, com `{path}`. Nulo quando o provedor não precisa. */
  artTemplate?: string
  baseUrl: string
  attribution: string | null
  auth: AuthStyle
  /** O teto de requisições dele. Ausente cai no padrão conservador. */
  rateLimit?: RateLimit
  /**
   * Quanto tempo ele tem pra responder, em ms. Ausente cai em
   * {@link DEFAULT_TIMEOUT_MS}, que é a calibragem do TMDB e serve aos três
   * primeiros. Só o Kitsu declara o dele.
   */
  timeoutMs?: number
  endpoints: ProviderEndpoints
  fieldMap: FieldMap
  credentials: CredentialSpec[]
  options: OptionSpec[]
  /**
   * Que tipos ele serve, por slug. **Só cria a junção pros tipos que EXISTEM
   * na instalação** — o wizard vai semear tipos parcialmente (brief, 3.9), e um
   * provedor semeado sem tipo a que se ligar fica **ocioso, não quebrado**.
   */
  mediaTypes: {
    slug: string
    /**
     * O endpoint de busca DESTE par, quando difere do geral do provedor. O
     * TMDB obriga: `/search/movie` e `/search/tv` são rotas diferentes, e o
     * `/search/multi` que as junta devolve os dois formatos misturados. Nulo
     * cai no endpoint do provedor.
     */
    searchPath?: string
    /**
     * O CORPO da busca DESTE par, para quem fala por `POST`. No AniList o
     * caminho é `/` pra tudo, e quem separa anime de mangá é a variável `type`
     * dentro do corpo. Nulo cai no corpo do endpoint do provedor.
     */
    searchBody?: ProviderBody
    /** O corpo do DETALHE deste par, pelo mesmo motivo. */
    detailBody?: ProviderBody
    /**
     * O token que este provedor usa pra nomear este tipo — `ANIME`, `manga`.
     * É ele que resolve o tipo do nó de um vínculo sem mapa em código.
     */
    providerTypeToken?: string
    /** O endpoint de vínculos, quando eles não vêm no corpo do detalhe. */
    relationsPath?: string
    /**
     * O mapa de campos DESTE par, pelo mesmo motivo: filme devolve `title` e
     * `release_date`, série devolve `name` e `first_air_date`. Um mapa por
     * provedor descreveria um dos dois e mentiria sobre o outro. Nulo cai no
     * mapa do provedor.
     */
    fieldMap?: FieldMap
    /**
     * O endpoint das UNIDADES deste par, quando ele tem unidades. `{id}` é a
     * obra e `{group}` o grupo — no TMDB, a temporada. Ausente em tipo que não
     * tem unidade nenhuma, que é filme, jogo e livro.
     */
    /** O detalhe DESTE par. O TMDB obriga: `/movie/{id}` contra `/tv/{id}`. */
    detailPath?: string
    /**
     * O mapa da resposta de DETALHE, quando ela não fala a mesma língua da
     * busca. O TMDB não precisa; o Open Library sim.
     */
    detailFieldMap?: FieldMap
    unitsPath?: string
    /** Como ler uma unidade da resposta acima. */
    unitMap?: UnitMap
  }[]
}

/**
 * As duas consultas do AniList, montadas por tipo.
 *
 * O texto da consulta é **idêntico** entre anime e mangá — o que muda é o valor
 * de `type` em `variables`. Escrevê-las por função em vez de copiar o bloco duas
 * vezes não é economia de linha: é o que impede as duas cópias de divergirem
 * num campo, que é exatamente o defeito que um mapa por par existe pra evitar.
 *
 * **O `type` vai como VARIÁVEL e não interpolado no texto**, e isso importa:
 * dentro do texto ele viraria substituição de string numa linguagem de
 * consulta. Como variável, quem valida é o servidor do provedor.
 *
 * `{term}` e `{id}` ocupam a folha inteira, que é a única forma que o dialeto
 * JSON aceita — ver `providers.body.ts`, sobre a colisão com as chaves do
 * GraphQL.
 */
const ANILIST_FIELDS =
  'id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format'

function anilistSearch(type: 'ANIME' | 'MANGA'): ProviderBody {
  return {
    kind: 'json',
    value: {
      query: `query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { ${ANILIST_FIELDS} } } }`,
      variables: { search: '{term}', type: type },
    },
  }
}

/**
 * `$id` é `Int` no schema deles e o nosso id externo é **string** — e passa.
 * Verificado ao vivo: `"154587"` é coagido a inteiro e responde 200. Id não
 * numérico devolve **400**, que é a resposta certa pra um id que não é dali.
 */
/**
 * As RELAÇÕES entram só no detalhe.
 *
 * `relations { edges { relationType node { … } } }` numa busca de vinte
 * resultados multiplicaria a resposta por um dado que a lista não mostra. O nó
 * traz `type` — `ANIME` ou `MANGA` —, que é o token com que o par se declara e
 * o que torna o vínculo navegável entre tipos.
 */
const ANILIST_RELATIONS =
  'relations { edges { relationType node { id type title { romaji } coverImage { large } startDate { year } } } }'

/**
 * As RECOMENDAÇÕES, e as duas coisas que MEDIR obrigou — 03/09/2026.
 *
 * **`sort: RATING_DESC` não é enfeite.** Sem ele a ordem não é a de relevância:
 * medido em Frieren, os três primeiros voltam com `rating` 298, 254 e 1172 —
 * ou seja, a mais votada de todas em terceiro. Como o teto é nosso e curto, sem
 * ordenar mostraríamos dez quaisquer.
 *
 * **`pageInfo` derruba o servidor deles com 500**, e o `sort` não — isolado num
 * pedido por vez. Por isso não há como saber quantas existem, e não faz falta.
 *
 * `perPage: 10` é o teto, e este é o único dos três em que ele é PEDIDO: o IGDB
 * devolve dez fixos e o TMDB devolve vinte sem aceitar tamanho de página.
 *
 * `mediaRecommendation` pode vir nulo — recomendação apontando pra obra que
 * saiu do catálogo —, e o mapeador já derruba item sem id ou sem título.
 */
const ANILIST_RECOMMENDATIONS =
  'recommendations(sort: RATING_DESC, perPage: 10) { edges { node { mediaRecommendation { id type title { romaji } coverImage { large } startDate { year } } } } }'

function anilistDetail(type: 'ANIME' | 'MANGA'): ProviderBody {
  return {
    kind: 'json',
    value: {
      query: `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${ANILIST_FIELDS} siteUrl ${ANILIST_RELATIONS} ${ANILIST_RECOMMENDATIONS} } }`,
      variables: { id: '{id}', type: type },
    },
  }
}

/**
 * Os campos que o IGDB devolve, iguais na busca e no detalhe.
 *
 * Apicalypse exige listar campo a campo — não há "devolva tudo" barato —, e a
 * lista ser a mesma nas duas consultas é o que faz o mapa de detalhe diferir do
 * de busca só pelo prefixo do array. Escrever duas vezes seria o começo de elas
 * divergirem num campo.
 */
const IGDB_FIELDS =
  'fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url,game_type.type;'

/**
 * O DETALHE pede mais que a busca, e a diferença é o vínculo.
 *
 * `parent_game` só faz sentido numa obra por vez: puxá-lo para cada um de vinte
 * resultados infla a resposta de busca por um dado que aquela tela não mostra.
 * É a mesma razão pela qual `relations` não entra no mapa de busca de ninguém.
 */
const IGDB_DETAIL_FIELDS = IGDB_FIELDS.replace(
  ';',
  ',parent_game.name,parent_game.cover.image_id,parent_game.first_release_date' +
    ',similar_games.name,similar_games.cover.image_id,similar_games.first_release_date;',
)

/**
 * O `fields` do MyAnimeList, na forma de UNIÃO dos dois tipos — o porquê está
 * inteiro no bloco `endpoints` da definição dele.
 *
 * O da BUSCA não pede vínculo nem recomendação, pela mesma razão do IGDB acima:
 * vinte resultados não mostram vínculo, e `relations` não entra em mapa de
 * busca de ninguém.
 */
const MAL_SEARCH_FIELDS =
  'id,title,main_picture,start_date,synopsis,mean,media_type' +
  ',num_episodes,num_chapters'

const MAL_DETAIL_FIELDS =
  `${MAL_SEARCH_FIELDS},related_anime{node{start_date}}` +
  ',related_manga{node{start_date}},recommendations{node{start_date}}'

/**
 * Os provedores que o produto embarca, como DEFINIÇÃO — não como caso especial
 * em código (brief, 3.10).
 *
 * **O TMDB nasce igual à definição que o usuário escreveria**, e isso não é
 * elegância: se o embutido passa por um atalho, a definição do usuário vira
 * cidadão de segunda e ninguém percebe que quebrou. É a mesma régua que a 3.12
 * aplica aos seis tipos semeados.
 *
 * **O segundo provedor entrou em 01/09/2026**, e o desenho aguentou — mas
 * cobrou quatro coisas que o TMDB sozinho escondia: um estilo de auth SEM
 * credencial, o caminho dos resultados declarado em vez de adivinhado, `{id}`
 * que pode conter barra, e um mapa de campos próprio pra resposta de detalhe.
 * Nenhuma delas é caso especial de provedor; as quatro são vocabulário novo na
 * definição. Era pra isso que o segundo servia.
 *
 * **O TERCEIRO entrou no mesmo dia**, e cobrou mais duas: o **teto de
 * requisições** é do provedor (o Jikan tolera uma ordem de grandeza a menos que
 * o TMDB) e a lista de unidades pode ser **PLANA**, sem grupo nenhum — que era
 * a outra metade do desenho de unidades, escrita em 01/09 e nunca exercida.
 *
 * **O QUARTO entrou em 02/09/2026, e não cobrou nada** — o Kitsu passou inteiro
 * pelo vocabulário que os três primeiros já tinham construído: `resultsPath`
 * pro envelope, `detailFieldMap` pro detalhe que fala outra língua, mapa por
 * par pro `total` que difere, e `rateLimit` próprio. É a primeira vez que
 * acrescentar provedor é só escrever a definição, que era a promessa da 3.10.
 *
 * O que ele cobrou foi uma AUSÊNCIA declarada: `score` e `votes` ficam de fora
 * porque a escala dele é 0–100 e a dos outros é 0–10, e o contrato não tem como
 * dizer isso. Ver o comentário no `fieldMap` dele.
 *
 * **O QUINTO entrou em 02/09/2026, e cobrou o degrau que faltava:** o AniList é
 * GraphQL, ou seja **POST com corpo**, que o cliente genérico não sabia dizer —
 * e era essa a única razão pela qual ele estava fora desde o começo. Três peças
 * novas, todas vocabulário e nenhuma exceção: `endpoints.*.body` (união fechada
 * por dialeto), `search_body`/`detail_body` na junção, e `endpoints.textFormat`,
 * porque a prosa dele é HTML.
 *
 * As duas ausências dele são conhecidas: `score`/`votes` fora pela escala 0–100,
 * que é a **segunda** ocorrência da mesma ausência e o que a promove de caso a
 * padrão; e sem lista de unidades, porque ele devolve só a contagem.
 *
 * **O SEXTO entrou no mesmo dia**, e é o IGDB. Ele usa o degrau do corpo pelo
 * outro dialeto (`apicalypse`) e executa o `oauth-client-credentials`, que
 * estava declarado desde sempre e nunca tinha rodado. Cobrou **três** coisas, e
 * a primeira apareceu SEM credencial nenhuma: `idHeader`, porque o 401 dele diz
 * literalmente que o Client-ID viaja num header ao lado do token; o cache de
 * token, porque o da Twitch vale 61,7 dias medidos; e `yearFormat`, porque a
 * data dele é timestamp Unix e ler quatro dígitos daria o ano 1431.
 *
 * Ele é o primeiro provedor que **nasce exigindo configuração do admin**: o
 * secret da Twitch não é embarcado, e a cláusula deles é literal contra. Buscar
 * jogo numa instalação recém-criada recusa com `not-configured`, que é a
 * resposta honesta e já construída.
 *
 * Espelha `providers.embedded.ts` do mesmo jeito que
 * `media-types.templates.ts` espelha a migration: **este módulo é a fonte
 * viva**, e a migration é o retrato congelado dele. Um teste compara os dois.
 */
export const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  {
    slug: 'tmdb',
    name: 'TMDB',
    baseUrl: 'https://api.themoviedb.org/3',
    /**
     * **Condição de uso, não cortesia** (brief, 3.10). Fica na definição porque
     * é propriedade do provedor: um provedor que o usuário cadastre pode não
     * exigir nenhuma, e a tela lê o campo em vez de saber de cor quais exigem.
     */
    attribution:
      'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    /**
     * `{path}` recebe o valor cru de `art` — o `poster_path` do TMDB, que vem
     * como `/abc.jpg`. `w342` atende a carta de 133–150px numa tela 2×.
     */
    artTemplate: 'https://image.tmdb.org/t/p/w342{path}',
    /**
     * A v3 do TMDB aceita a chave em query. A v4 usaria `header-key` com bearer
     * — as duas estão no vocabulário de auth, e trocar seria editar esta
     * definição, não escrever código.
     */
    auth: { style: 'query-key', param: 'api_key', credential: 'api_key' },
    endpoints: {
      /**
       * `{option:<chave>}` é substituído pelo valor efetivo da opção — mesma
       * ideia do `{id}` que o detalhe já usa. É o que faz `nsfw` e `language`
       * chegarem ao provedor **sem que a opção precise declarar onde vai**: o
       * lugar é propriedade do endpoint, não do formulário.
       *
       * Este `path` é o fallback; os dois tipos que o TMDB serve trazem o seu
       * em `mediaTypes`, abaixo.
       */
      search: {
        path: '/search/multi',
        queryParam: 'query',
        query: {
          include_adult: '{option:nsfw}',
          language: '{option:language}',
        },
      },
      /**
       * `append_to_response` traz os ids externos dentro da mesma resposta —
       * uma ida à rede em vez de duas. O `path` daqui é só o fallback: quem
       * manda é o `detail_path` do par (`/movie/{id}` contra `/tv/{id}`).
       *
       * **E as RECOMENDAÇÕES vêm pelo mesmo carona — 03/09/2026.** O TMDB
       * também as serve em `/movie/{id}/recommendations`, e ir por lá custaria
       * três coisas para trazer o mesmo JSON: coluna nova na junção (o caminho
       * é por par), uma segunda ida à rede e uma segunda entrada de cache.
       * Aqui elas chegam onde o IGDB e o AniList já as entregam — dentro do
       * detalhe —, o que deixa `titles.resolve.ts` com um caminho só.
       *
       * **O custo é medido e assumido:** a resposta de detalhe de uma série
       * passa de 5,5 KB para 19,5 KB, e é ela que fica em `provider_cache`. Não
       * dá pra pedir menos — `append_to_response` não seleciona campo —, e o
       * cache tem validade.
       */
      detail: {
        path: '/movie/{id}',
        query: {
          language: '{option:language}',
          append_to_response: 'external_ids,recommendations',
        },
      },
      /**
       * O endpoint mais barato que ainda exige a chave: se ele responde 200, a
       * credencial vale. `/configuration` não devolve nada pesado e é o que o
       * próprio TMDB documenta como sanity check.
       */
      test: { path: '/configuration' },
    },
    fieldMap: {
      externalId: 'id',
      title: 'title',
      year: 'release_date',
      art: 'poster_path',
      synopsis: 'overview',
    },
    credentials: [
      {
        key: 'api_key',
        label: 'API key',
        help: 'Free, from your TMDB account settings under API.',
      },
    ],
    options: [
      /**
       * As duas vêm das flags do Yamtrack (`TMDB_NSFW`, `TMDB_LANG`), e as duas
       * são **da instância** (brief, 3.10): configuração de provedor é inteira
       * do admin. `nsfw` por usuário entraria na chave do cache de resposta,
       * senão a busca sem filtro de um é servida a outro.
       */
      {
        key: 'nsfw',
        type: 'boolean',
        label: 'Include adult titles',
        default: false,
      },
      {
        key: 'language',
        type: 'string',
        label: 'Metadata language',
        default: 'en-US',
      },
    ],
    mediaTypes: [
      {
        slug: 'movie',
        searchPath: '/search/movie',
        detailPath: '/movie/{id}',
        fieldMap: {
          externalId: 'id',
          title: 'title',
          year: 'release_date',
          art: 'poster_path',
          synopsis: 'overview',
          score: 'vote_average',
          votes: 'vote_count',
          links: [
            {
              label: 'TMDB',
              path: 'id',
              template: 'https://www.themoviedb.org/movie/{id}',
            },
            {
              label: 'IMDb',
              path: 'external_ids.imdb_id',
              template: 'https://www.imdb.com/title/{id}/',
            },
            {
              label: 'Wikidata',
              path: 'external_ids.wikidata_id',
              template: 'https://www.wikidata.org/wiki/{id}',
            },
          ],
          /**
           * **Sem `typeToken`, e isso é medido, não descuido.** Os itens trazem
           * `media_type`, mas o endpoint já é do tipo: `/movie/{id}` só devolve
           * `movie` e `/tv/{id}` só devolve `tv`, conferido nos dois. Ausente
           * quer dizer "o mesmo tipo da obra", que é a resposta certa aqui —
           * declarar o token obrigaria a semear `provider_type_token` no par do
           * TMDB para traduzir um valor que nunca varia.
           *
           * Este mapa serve busca e detalhe no TMDB, e já carrega `links` e
           * `unitGroups`, que também só existem no detalhe. Ler um caminho
           * ausente devolve vazio; o que não pode acontecer é a BUSCA *pedir*
           * recomendação, e ela não pede — quem pede é o `append_to_response`
           * do endpoint de detalhe.
           */
          recommendations: {
            path: 'recommendations.results',
            id: 'id',
            title: 'title',
            art: 'poster_path',
            year: 'release_date',
          },
        },
      },
      {
        slug: 'tv',
        searchPath: '/search/tv',
        detailPath: '/tv/{id}',
        // Série devolve `name` e `first_air_date` onde filme devolve `title` e
        // `release_date`. É esta linha que justifica o mapa ser do par.
        fieldMap: {
          externalId: 'id',
          title: 'name',
          year: 'first_air_date',
          /**
           * O total de unidades da série. Sem ele o contador lê "8 / ?" — que
           * é verdade, mas é a verdade menos útil possível quando o provedor
           * sabe o número.
           */
          total: 'number_of_episodes',
          art: 'poster_path',
          synopsis: 'overview',
          score: 'vote_average',
          votes: 'vote_count',
          /**
           * Os links são do PAR porque a URL do próprio TMDB difere por tipo —
           * `/movie/` contra `/tv/`. E são só os que o provedor de fato
           * devolveu: declarado com campo vazio não vira item morto na caixa.
           */
          links: [
            {
              label: 'TMDB',
              path: 'id',
              template: 'https://www.themoviedb.org/tv/{id}',
            },
            {
              label: 'IMDb',
              path: 'external_ids.imdb_id',
              template: 'https://www.imdb.com/title/{id}/',
            },
            {
              label: 'Wikidata',
              path: 'external_ids.wikidata_id',
              template: 'https://www.wikidata.org/wiki/{id}',
            },
          ],
          /**
           * Os grupos vêm da resposta de DETALHE, que o TMDB já devolve com
           * `seasons` dentro. Nenhuma ida à rede a mais pra saber quantas
           * temporadas existem.
           *
           * `name` vem do provedor — é ele que escreve "Season 1", no idioma
           * que a opção `language` pediu. O produto nunca decide como o
           * agrupamento se chama.
           */
          unitGroups: {
            path: 'seasons',
            number: 'season_number',
            name: 'name',
            count: 'episode_count',
            art: 'poster_path',
            /**
             * O coletivo, e ele é do PAR pelo mesmo motivo que `name` é do
             * provedor: **o produto não decide como o agrupamento se chama**.
             * Este é o único par que agrupa hoje, e por isso o único que o
             * declara.
             */
            label: 'Seasons',
          },
          // Mesma forma do par de filme, lendo `name` e `first_air_date` —
          // que é a linha que justifica o mapa ser do par, de novo.
          recommendations: {
            path: 'recommendations.results',
            id: 'id',
            title: 'name',
            art: 'poster_path',
            year: 'first_air_date',
          },
        },
        /**
         * **Só a série tem isto, e o filme não** — que é exatamente por que
         * ele mora na junção. A mesma linha de provedor serve os dois.
         */
        unitsPath: '/tv/{id}/season/{group}',
        unitMap: {
          number: 'episode_number',
          title: 'name',
          synopsis: 'overview',
          art: 'still_path',
          date: 'air_date',
          runtime: 'runtime',
        },
      },
    ],
  },
  {
    slug: 'openlibrary',
    name: 'Open Library',
    baseUrl: 'https://openlibrary.org',
    /**
     * O Internet Archive não exige atribuição pra leitura da API. **Nulo é
     * resposta, não lacuna** — e é o campo que impede a tela de fixar a frase
     * do TMDB debaixo de resultado de qualquer um (design system, seção 8).
     */
    attribution: null,
    /**
     * `{path}` recebe o id da capa. `-M` dá ~180px de largura, que é o que a
     * carta de 133–150px pede numa tela 2×; `-L` seria o dobro do peso pro
     * mesmo pixel.
     */
    artTemplate: 'https://covers.openlibrary.org/b/id/{path}-M.jpg',
    /** **O primeiro provedor sem credencial nenhuma.** */
    auth: { style: 'none' },
    endpoints: {
      /**
       * `fields` corta a resposta: sem ele um resultado traz dezenas de campos
       * de edição que nada aqui lê. O cache de resposta guarda o corpo inteiro,
       * então o que não se pede também não se guarda.
       */
      search: {
        path: '/search.json',
        queryParam: 'q',
        query: {
          limit: '20',
          fields: 'key,title,first_publish_year,cover_i,author_name',
        },
        // O TMDB põe em `results` e o fallback o cobre; este põe em `docs`.
        resultsPath: 'docs',
      },
      /**
       * `{id}` é `/works/OL45804W` — **o id JÁ É um caminho**, e é ele que
       * obrigou a substituição a virar segmento a segmento.
       */
      detail: { path: '{id}.json' },
      /**
       * Sem credencial não há o que validar, então "testar" só responde se o
       * provedor está no ar — e é honesto, porque é literalmente o que uma
       * consulta vai fazer.
       *
       * **`q=test` e não `q=a`.** A primeira versão mirava na consulta mais
       * BARATA possível e o Open Library respondeu **422**: ele recusa termo
       * com menos de três caracteres. O admin via "não foi possível alcançar o
       * provedor" sobre um provedor que estava no ar — a frase errada, causada
       * por nós. **O endpoint de teste tem que ser um pedido que o provedor
       * ACEITA**; "o mais barato" não é critério que sobreviva ao contato.
       */
      test: { path: '/search.json', query: { q: 'test', limit: '1' } },
    },
    /**
     * O mapa da BUSCA. O do detalhe está no par, porque os dois endpoints deste
     * provedor nomeiam as mesmas coisas diferente.
     */
    fieldMap: {
      externalId: 'key',
      title: 'title',
      year: 'first_publish_year',
      art: 'cover_i',
    },
    credentials: [],
    options: [],
    mediaTypes: [
      {
        slug: 'book',
        /**
         * Livro **não tem unidades**: a unidade de progresso é a página, e
         * página não é parte numerada que se marque uma a uma. `unitsPath`
         * ausente é o caso comum, não pendência.
         */
        detailFieldMap: {
          externalId: 'key',
          title: 'title',
          /**
           * A capa do detalhe é um ARRAY (`covers: [8739161]`), a da busca é um
           * escalar (`cover_i`). Mesma coisa, dois nomes e duas formas — é este
           * par de linhas que justifica o mapa de detalhe existir.
           */
          art: 'covers.0',
          /**
           * **Duas formas, dois caminhos.** O `description` vem ora como
           * `"texto"`, ora como `{type, value}` — o Open Library mudou de
           * formato sem reescrever o acervo, e as duas convivem lá hoje. A
           * ordem importa: a string é a forma comum, então ela vem primeiro.
           */
          synopsis: ['description', 'description.value'],
          links: [
            {
              label: 'Open Library',
              path: 'key',
              template: 'https://openlibrary.org{id}',
            },
          ],
        },
      },
    ],
  },
  {
    slug: 'jikan',
    /**
     * O nome é do que a pessoa configura — a API. Os DADOS são do MyAnimeList,
     * e quem diz isso é `attribution`, logo abaixo.
     *
     * ── Era `Jikan (MyAnimeList)`, e o parêntese caiu em 02/09/2026 ─────────
     * O parêntese existia pra que creditar só o Jikan não escondesse de onde a
     * informação vem — o que é verdade, e é **exatamente o que `attribution` já
     * faz**. A mesma informação estava em dois campos, e a cópia redundante era
     * a que cobrava: medido a 12px, `Jikan (MyAnimeList)` ocupa **114px** contra
     * 35 do `TMDB`, 28 do `Kitsu` e 73 do `Open Library` — três a quatro vezes
     * os outros. No menu de escopo isso espremia o nome do TIPO a 40px e o
     * truncava (`Ani...`), justamente na linha ativa.
     *
     * A régua: **nome identifica, atribuição credita — e um não faz o trabalho
     * do outro.** A decisão "provedor se identifica pelo NOME" (design system,
     * seção 5) foi tomada contando caracteres e afirmando que em nenhum dos
     * quatro lugares onde o nome aparece falta espaço pra palavra; um nome que
     * carrega crédito dentro de si desmente essa conta.
     */
    name: 'Jikan',
    baseUrl: 'https://api.jikan.moe/v4',
    attribution: 'Data from MyAnimeList, via the Jikan API.',
    /** O Jikan já devolve URL absoluta, então não há molde a aplicar. */
    auth: { style: 'none' },
    /**
     * **3 por segundo e 60 por minuto, documentados** — uma ordem de grandeza
     * abaixo do TMDB. Sustentado é 1/s; a rajada de 3 cobre a tela disparando
     * busca a cada tecla com debounce.
     */
    rateLimit: { perSecond: 1, burst: 3 },
    endpoints: {
      /**
       * `sfw` é o inverso do `include_adult` do TMDB — lá se pede pra incluir,
       * aqui se pede pra excluir. Fica FIXO em vez de virar opção porque
       * `{option:}` só substitui valor, e uma opção que precisasse SUMIR do
       * query string quando desligada pediria vocabulário novo. Quando o
       * terceiro provedor pedir isso, aí é decisão; hoje seria adivinhação.
       */
      search: {
        path: '/anime',
        queryParam: 'q',
        query: { limit: '20', sfw: 'true' },
        resultsPath: 'data',
      },
      detail: { path: '/anime/{id}' },
      /**
       * Uma busca de um resultado. `q=test` pelo mesmo motivo do Open Library:
       * termo curto demais é recusa em vários catálogos, e a recusa se lê como
       * "o provedor está fora do ar".
       */
      test: { path: '/anime', query: { q: 'test', limit: '1' } },
    },
    /**
     * O mapa da BUSCA, onde cada item já é a obra. O detalhe embrulha em
     * `data`, e é por isso que os dois pares abaixo declaram `detailFieldMap` —
     * o mesmo campo do Open Library, cobrado agora por outro motivo.
     */
    fieldMap: {
      externalId: 'mal_id',
      /**
       * `title` é o romaji e sempre existe; `title_english` costuma faltar. A
       * ordem é a da alternativa: o que sempre vem primeiro.
       */
      title: 'title',
      year: 'year',
      total: 'episodes',
      art: 'images.jpg.image_url',
      synopsis: 'synopsis',
      /** `TV`, `Movie`, `OVA`, `Manga`. **Verificado só no detalhe** — a busca
       * dele responde 504 desde 02/09/2026, e o que atravessou a sonda foi
       * `/anime/{id}`. */
      subtype: 'type',
      score: 'score',
      votes: 'scored_by',
    },
    credentials: [],
    options: [],
    mediaTypes: [
      {
        slug: 'anime',
        detailPath: '/anime/{id}',
        /**
         * **A lista PLANA** — a outra metade do desenho de unidades, e a
         * primeira vez que ela é exercida. Não há `{group}` no caminho e não há
         * `unitGroups` no mapa: anime não agrupa episódio, e o offset absoluto
         * é o próprio número (`domain/unit-offset.ts` devolve 0 sem grupos).
         */
        /**
         * **Uma PÁGINA de 100, e isso é limite conhecido.** Verificado ao vivo:
         * Naruto declara `episodes: 220` no detalhe e `/episodes` devolve 100 —
         * o Jikan pagina, e o cliente genérico lê o primeiro array e para. O
         * contador continua certo (o total vem do detalhe); o que fica curto é
         * a LISTA, a partir do episódio 101.
         *
         * Não foi consertado aqui de propósito: seguir paginação é eixo novo na
         * definição — onde está o "tem próxima", como se pede a seguinte, e
         * quantas se busca antes de parar. É decisão, não conserto mecânico, e
         * o TMDB não a pede porque agrupa por temporada.
         */
        unitsPath: '/anime/{id}/episodes',
        unitMap: {
          // Neste endpoint `mal_id` É o número do episódio, não um id opaco.
          number: 'mal_id',
          title: 'title',
          date: 'aired',
        },
        detailFieldMap: {
          externalId: 'data.mal_id',
          title: 'data.title',
          year: 'data.year',
          total: 'data.episodes',
          art: 'data.images.jpg.image_url',
          synopsis: 'data.synopsis',
          subtype: 'data.type',
          score: 'data.score',
          votes: 'data.scored_by',
          links: [{ label: 'MyAnimeList', path: 'data.url' }],
        },
      },
      {
        slug: 'manga',
        searchPath: '/manga',
        detailPath: '/manga/{id}',
        /**
         * **Mangá não tem lista de unidades aqui**, e a ausência é resposta: o
         * Jikan não expõe capítulos. O contador continua contando capítulo — a
         * lista é apresentação dele, não a fonte (brief, 3.11).
         */
        fieldMap: {
          externalId: 'mal_id',
          title: 'title',
          year: 'published.prop.from.year',
          total: 'chapters',
          art: 'images.jpg.image_url',
          synopsis: 'synopsis',
          subtype: 'type',
          score: 'score',
          votes: 'scored_by',
        },
        detailFieldMap: {
          externalId: 'data.mal_id',
          title: 'data.title',
          year: 'data.published.prop.from.year',
          total: 'data.chapters',
          art: 'data.images.jpg.image_url',
          synopsis: 'data.synopsis',
          subtype: 'data.type',
          score: 'data.score',
          votes: 'data.scored_by',
          links: [{ label: 'MyAnimeList', path: 'data.url' }],
        },
      },
    ],
  },
  {
    slug: 'kitsu',
    name: 'Kitsu',
    baseUrl: 'https://kitsu.app/api/edge',
    /**
     * **Não verificado, e por isso é o único campo desta definição que precisa
     * de confirmação antes de subir.** A documentação do Kitsu não estava
     * acessível em 02/09/2026, e `null` aqui é uma AFIRMAÇÃO — "este provedor
     * não exige crédito" —, não a ausência de uma. Confirmar nos termos deles
     * antes da release; se exigirem, é uma string, não código.
     */
    attribution: null,
    /**
     * URL absoluta em `posterImage.*`, como o Jikan. Sem molde a aplicar.
     */
    auth: { style: 'none' },
    /**
     * **Teto auto-imposto, não documentado por eles.** O Kitsu não publica
     * limite, e omitir cairia no padrão do limitador — que é 20/s, calibrado
     * pelo TMDB e generoso demais pra um serviço de comunidade. Quando o
     * provedor não diz o teto, quem declara é a nossa contenção: 3/s cobre a
     * busca a cada tecla com debounce e fica uma ordem de grandeza abaixo de
     * qualquer coisa que pareça abuso.
     */
    rateLimit: { perSecond: 3, burst: 5 },
    /**
     * **O único que declara prazo, e ele foi MEDIDO.** A busca do Kitsu leva
     * 6 a 12s — detalhe e unidades ficam em ~0,5s —, e os 10s do padrão a
     * transformavam em `unreachable` metade das vezes, que é a mesma resposta
     * de rede fora. 30s é o dobro do pior caso observado, que é o que deixa a
     * variação do host caber sem que lentidão vire recusa.
     */
    timeoutMs: 30_000,
    endpoints: {
      /**
       * `filter[text]` com colchetes, que é JSON:API. Sobrevive inteiro porque
       * `prepareRequest` monta a query com `url.searchParams.set` — os
       * colchetes saem como `%5B`/`%5D`, e foi assim que os pedidos de
       * verificação passaram.
       *
       * Este `path` é o fallback; os dois pares trazem o seu abaixo.
       */
      search: {
        path: '/anime',
        queryParam: 'filter[text]',
        query: { 'page[limit]': '20' },
        // O TMDB põe em `results`, o Jikan e este põem em `data`.
        resultsPath: 'data',
      },
      detail: { path: '/anime/{id}' },
      /**
       * **Um pedido que o provedor ACEITA**, que é a lição que o Open Library
       * cobrou: "o mais barato possível" levou a um 422 lido como provedor fora
       * do ar. Sem credencial não há o que validar, então testar é responder se
       * ele está no ar — e é literalmente o que uma consulta vai fazer.
       */
      test: { path: '/anime', query: { 'page[limit]': '1' } },
      /**
       * **JSON:API, e sem isto ele responde 406 em TUDO.** O padrão do cliente
       * é `application/json`, que os outros três querem e este recusa.
       */
      accept: 'application/vnd.api+json',
    },
    /**
     * O mapa da BUSCA, como fallback. Os dois pares declaram o seu inteiro,
     * porque `fieldMap` do par SUBSTITUI o do provedor em vez de completá-lo, e
     * o que difere entre anime e mangá é justamente o `total`.
     *
     * ── O que NÃO está aqui, e é decisão ────────────────────────────────────
     * **`score` e `votes` ficam de fora.** O `averageRating` do Kitsu é uma
     * STRING numa escala de 0–100 (`"88.81"`), enquanto TMDB e Jikan devolvem
     * número de 0 a 10. O contrato não tem vocabulário de escala, e mapear
     * assim mesmo poria "88.8" na mesma peça de tela onde a obra do TMDB
     * mostra "8.9" — dois números com o mesmo rótulo e sentidos diferentes.
     * Ausente é a leitura honesta; converter é vocabulário novo na definição
     * (`scale`, ou um `transform`), e isso é decisão, não conserto.
     */
    fieldMap: {
      // Em JSON:API o id fica FORA de `attributes`, na raiz do recurso.
      externalId: 'id',
      /**
       * `canonicalTitle` e não `titles.en`, pelo mesmo critério do Jikan: o
       * romaji sempre existe e o inglês costuma faltar. `titles.en` está lá e
       * a lista de caminhos alternativos daria
       * `['attributes.titles.en', 'attributes.canonicalTitle']` — trocar é uma
       * linha, mas é escolha de produto sobre em que idioma a obra se chama, e
       * hoje os outros dois provedores mostram o título nativo.
       */
      title: 'attributes.canonicalTitle',
      year: 'attributes.startDate',
      art: 'attributes.posterImage.medium',
      synopsis: 'attributes.synopsis',
      /** `TV`, `movie`, `OVA` no anime; `manga`, `novel` no mangá. Minúsculo em
       * parte dos valores, que é o outro motivo de `subtypeLabel` existir. */
      subtype: 'attributes.subtype',
    },
    credentials: [],
    options: [],
    mediaTypes: [
      {
        slug: 'anime',
        providerTypeToken: 'anime',
        searchPath: '/anime',
        detailPath: '/anime/{id}',
        /**
         * **Endpoint separado, e o teto vai DENTRO do caminho** — mesma forma
         * do `units_path`, e pelo mesmo motivo: paginação é propriedade do
         * provedor, não escolha nossa. `include=destination` é o que faz o
         * `included[]` existir; sem ele viria só a referência.
         */
        relationsPath:
          '/anime/{id}/media-relationships?include=destination&page[limit]=20',
        fieldMap: {
          externalId: 'id',
          title: 'attributes.canonicalTitle',
          year: 'attributes.startDate',
          total: 'attributes.episodeCount',
          art: 'attributes.posterImage.medium',
          synopsis: 'attributes.synopsis',
          subtype: 'attributes.subtype',
        },
        /**
         * **A lista PLANA**, como no Jikan: anime não agrupa episódio, então
         * não há `{group}` no caminho nem `unitGroups` no mapa.
         *
         * **O `page[limit]=20` vai no caminho, e o 20 é TETO do provedor, não
         * escolha.** Verificado ao vivo: `page[limit]=40` e `=100` devolvem
         * `data: []` — zero itens, sem erro —, o que é a forma mais silenciosa
         * possível de falhar. Sem o parâmetro a página seria de 10.
         *
         * Isso deixa o mesmo limite conhecido que o Jikan tinha, só que mais
         * curto: a lista para no episódio 20, e o contador segue certo porque
         * o total vem de `episodeCount` no detalhe. Seguir paginação continua
         * sendo eixo novo na definição — onde está o "tem próxima", como se
         * pede a seguinte, quantas se busca antes de parar —, e por isso não
         * foi resolvido de contrabando aqui.
         */
        unitsPath: '/anime/{id}/episodes?page[limit]=20',
        unitMap: {
          number: 'attributes.number',
          title: 'attributes.canonicalTitle',
          synopsis: 'attributes.synopsis',
          art: 'attributes.thumbnail.original',
          date: 'attributes.airdate',
          runtime: 'attributes.length',
        },
        /**
         * O detalhe embrulha o recurso em `data` — o mesmo motivo pelo qual o
         * Jikan e o Open Library declaram mapa próprio de detalhe.
         */
        detailFieldMap: {
          externalId: 'data.id',
          title: 'data.attributes.canonicalTitle',
          year: 'data.attributes.startDate',
          total: 'data.attributes.episodeCount',
          art: 'data.attributes.posterImage.medium',
          synopsis: 'data.attributes.synopsis',
          subtype: 'data.attributes.subtype',
          /**
           * **O caso da JUNÇÃO.** O Kitsu devolve a relação e a obra em listas
           * separadas: `role` em `data[]`, destino em `included[]`, ligados por
           * `{type, id}`. `includeRef` diz onde o item aponta, e a partir dali
           * `id`, `title`, `art`, `year` e `typeToken` são lidos do recurso
           * RESOLVIDO — só `kind` continua vindo do item, porque é ele que
           * carrega a relação.
           *
           * `type` do recurso é `anime` ou `manga`, que são exatamente os
           * tokens que os dois pares declaram.
           */
          relations: {
            path: 'data',
            kind: 'attributes.role',
            includeRef: 'relationships.destination.data',
            id: 'id',
            title: 'attributes.canonicalTitle',
            art: 'attributes.posterImage.medium',
            year: 'attributes.startDate',
            typeToken: 'type',
          },
          links: [
            {
              label: 'Kitsu',
              path: 'data.attributes.slug',
              template: 'https://kitsu.app/anime/{id}',
            },
          ],
        },
      },
      {
        slug: 'manga',
        providerTypeToken: 'manga',
        searchPath: '/manga',
        detailPath: '/manga/{id}',
        relationsPath:
          '/manga/{id}/media-relationships?include=destination&page[limit]=20',
        fieldMap: {
          externalId: 'id',
          title: 'attributes.canonicalTitle',
          year: 'attributes.startDate',
          total: 'attributes.chapterCount',
          art: 'attributes.posterImage.medium',
          synopsis: 'attributes.synopsis',
          subtype: 'attributes.subtype',
        },
        /**
         * **Mangá fica SEM lista de unidades, e a ausência aqui é escolha, não
         * limite do provedor** — ao contrário do Jikan, onde ela era ausência
         * de endpoint.
         *
         * `/manga/{id}/chapters` existe e responde 200. Medido em Berserk: os
         * capítulos vêm com `canonicalTitle: null` e `published: null`, e o
         * `meta.count` diz 5000 para uma obra de ~380 capítulos. Uma lista de
         * 20 linhas numeradas, sem título e sem data, para uma obra cujo total
         * o próprio Kitsu devolve como `chapterCount: null`, mostra menos do
         * que não mostrar nada — e a régua de `/piles` vale aqui: affordance
         * descreve o que existe. O contador continua contando capítulo, que é
         * o que o brief 3.11 sempre disse ser a fonte.
         */
        detailFieldMap: {
          externalId: 'data.id',
          title: 'data.attributes.canonicalTitle',
          year: 'data.attributes.startDate',
          total: 'data.attributes.chapterCount',
          art: 'data.attributes.posterImage.medium',
          synopsis: 'data.attributes.synopsis',
          subtype: 'data.attributes.subtype',
          /**
           * **O caso da JUNÇÃO.** O Kitsu devolve a relação e a obra em listas
           * separadas: `role` em `data[]`, destino em `included[]`, ligados por
           * `{type, id}`. `includeRef` diz onde o item aponta, e a partir dali
           * `id`, `title`, `art`, `year` e `typeToken` são lidos do recurso
           * RESOLVIDO — só `kind` continua vindo do item, porque é ele que
           * carrega a relação.
           *
           * `type` do recurso é `anime` ou `manga`, que são exatamente os
           * tokens que os dois pares declaram.
           */
          relations: {
            path: 'data',
            kind: 'attributes.role',
            includeRef: 'relationships.destination.data',
            id: 'id',
            title: 'attributes.canonicalTitle',
            art: 'attributes.posterImage.medium',
            year: 'attributes.startDate',
            typeToken: 'type',
          },
          links: [
            {
              label: 'Kitsu',
              path: 'data.attributes.slug',
              template: 'https://kitsu.app/manga/{id}',
            },
          ],
        },
      },
    ],
  },
  {
    slug: 'anilist',
    name: 'AniList',
    baseUrl: 'https://graphql.anilist.co',
    /**
     * **Não verificado, e é a mesma marca do Kitsu.** `null` aqui é uma
     * AFIRMAÇÃO — "este provedor não exige crédito" —, não a ausência de uma.
     * Confirmar nos termos deles antes de qualquer release.
     */
    attribution: null,
    /**
     * **Nada para leitura pública** (brief, 3.10). O que a API deles pede token
     * pra fazer é escrever na lista do usuário, que não é o que fazemos.
     */
    auth: { style: 'none' },
    /**
     * **MEDIDO no header, não lido na doc.** `x-ratelimit-limit: 30` — trinta
     * por minuto, que é 0,5/s. A documentação deles fala em 90/min; o header diz
     * 30, e o header é o que a instalação vai encontrar. **Quando os dois
     * discordam, vale o observado.**
     *
     * É o primeiro `perSecond` fracionário, e o balde de fichas já era ponto
     * flutuante — ele reenche contínuo, então meia ficha por segundo é uma a
     * cada dois segundos, e não um caso especial.
     */
    rateLimit: { perSecond: 0.5, burst: 5 },
    endpoints: {
      /**
       * **Um endereço só pra tudo**, que é o que GraphQL é: o caminho não
       * distingue busca de detalhe nem anime de mangá. Quem distingue é o
       * CORPO, e por isso ele é do par — ver `search_body` na junção.
       *
       * `queryParam` fica vazio e sem sentido aqui, e é a presença do corpo que
       * faz o cliente parar de acrescentá-lo. Ele continua obrigatório no tipo
       * porque buscar por query string é o caso comum, e afrouxá-lo descreveria
       * pior os quatro provedores que o usam.
       */
      search: {
        path: '/',
        queryParam: '',
        resultsPath: 'data.Page.media',
        body: anilistSearch('ANIME'),
      },
      detail: { path: '/', body: anilistDetail('ANIME') },
      /**
       * **Um pedido que o provedor ACEITA**, e o mais barato que existe: um id
       * fixo, um campo só. Sem credencial não há o que validar, então testar é
       * responder se ele está no ar — e um `GET` na raiz de um GraphQL devolve
       * 400, que se leria como provedor quebrado.
       */
      test: {
        path: '/',
        body: {
          kind: 'json',
          value: {
            query: 'query { Page(perPage: 1) { media(id: 1) { id } } }',
          },
        },
      },
      /**
       * **A prosa dele é HTML, e `asHtml: false` NÃO resolve** — verificado ao
       * vivo em 02/09/2026: a descrição volta com `<br>` e `<i>` das duas
       * formas. Sem esta linha as tags apareceriam literais na tela, que
       * renderiza sinopse como texto puro.
       */
      textFormat: 'html',
    },
    /**
     * O mapa da BUSCA como fallback; os dois pares declaram o seu, porque o que
     * difere entre anime e mangá é o `total` — `episodes` contra `chapters`.
     *
     * ── O que NÃO está aqui, e é a mesma ausência do Kitsu ──────────────────
     * **`score` e `votes` ficam de fora.** `averageScore` é 0–100 e TMDB e Jikan
     * devolvem 0–10; o contrato não tem vocabulário de escala, e mapear assim
     * mesmo poria "91" na mesma peça de tela onde a obra do TMDB mostra "8.9". A
     * segunda ocorrência da mesma ausência é o que a promove de caso a padrão —
     * e o que diz que o vocabulário de escala é decisão esperando dono.
     *
     * **O título sai de `romaji`**, pelo critério que o Jikan e o Kitsu já
     * fixaram: o nativo transliterado sempre existe e o inglês costuma faltar
     * (`english: null` em toda sequência recente). `['title.english',
     * 'title.romaji']` é uma linha e o vocabulário já existe — é escolha de
     * produto sobre em que idioma a obra se chama, não limitação.
     */
    fieldMap: {
      externalId: 'id',
      title: 'title.romaji',
      year: 'startDate.year',
      art: 'coverImage.large',
      synopsis: 'description',
      /** `TV`, `ONA`, `MOVIE`, `MANGA`, `ONE_SHOT` — enum de máquina, e é por
       * isso que `subtypeLabel` existe. */
      subtype: 'format',
    },
    credentials: [],
    options: [],
    mediaTypes: [
      {
        slug: 'anime',
        /** O token com que ELE nomeia este tipo. Ver `provider_type_token`. */
        providerTypeToken: 'ANIME',
        searchBody: anilistSearch('ANIME'),
        detailBody: anilistDetail('ANIME'),
        fieldMap: {
          externalId: 'id',
          title: 'title.romaji',
          year: 'startDate.year',
          total: 'episodes',
          art: 'coverImage.large',
          synopsis: 'description',
          subtype: 'format',
          /**
           * **NÃO medido** — eles respondem 403 desde 07/09/2026. Sai do enum
           * `MediaFormat` documentado: `TV`, `TV_SHORT`, `OVA`, `ONA`, `MOVIE`,
           * `SPECIAL`, `MUSIC`.
           *
           * `TV` sozinho já saía certo pela regra de forma; quem precisa disto é
           * **`TV_SHORT`**, porque ali a sigla está DENTRO de um valor composto
           * e a regra de forma se recusa a agir — com razão, foi um teste que a
           * ensinou (`ONE_SHOT` virava `ONE SHOT`).
           *
           * O mangá dele (`MANGA`, `NOVEL`, `ONE_SHOT`) não tem sigla.
           */
          subtypeAcronyms: ['tv', 'ova', 'ona'],
        },
        /**
         * **Sem lista de unidades, e a ausência é do PROVEDOR** — o AniList dá
         * só a CONTAGEM (brief, 3.10). Não existe campo que devolva episódio a
         * episódio; o contador continua contando, que é o que a 3.11 sempre
         * disse ser a fonte.
         */
        detailFieldMap: {
          externalId: 'data.Media.id',
          title: 'data.Media.title.romaji',
          year: 'data.Media.startDate.year',
          total: 'data.Media.episodes',
          art: 'data.Media.coverImage.large',
          synopsis: 'data.Media.description',
          subtype: 'data.Media.format',
          // Mesma lista da busca: o detalhe lê o mesmo enum por outro caminho.
          subtypeAcronyms: ['tv', 'ova', 'ona'],
          /**
           * O item é a ARESTA (`relationType`) e a obra é o NÓ. Sem junção: os
           * dois vêm juntos, e por isso `kind` sai do item e o resto de dentro
           * dele por caminho.
           */
          relations: {
            path: 'data.Media.relations.edges',
            kind: 'relationType',
            id: 'node.id',
            title: 'node.title.romaji',
            art: 'node.coverImage.large',
            year: 'node.startDate.year',
            typeToken: 'node.type',
          },
          /**
           * Aqui a aresta tem **dois** saltos até a obra — `node` é o voto e
           * `mediaRecommendation` é o que foi recomendado. Sem `kind`, porque
           * não há relação a nomear: o que este provedor guarda na aresta é
           * `rating`, quantos concordaram, e isso não é o nome de nada.
           *
           * `typeToken` fica porque o nó traz `type`, e a junção já traduz
           * `ANIME` e `MANGA` — recomendação de anime para mangá é rara mas
           * possível, e sai navegável de graça.
           */
          recommendations: {
            path: 'data.Media.recommendations.edges',
            id: 'node.mediaRecommendation.id',
            title: 'node.mediaRecommendation.title.romaji',
            art: 'node.mediaRecommendation.coverImage.large',
            year: 'node.mediaRecommendation.startDate.year',
            typeToken: 'node.mediaRecommendation.type',
          },
          links: [{ label: 'AniList', path: 'data.Media.siteUrl' }],
        },
      },
      {
        slug: 'manga',
        providerTypeToken: 'MANGA',
        searchBody: anilistSearch('MANGA'),
        detailBody: anilistDetail('MANGA'),
        fieldMap: {
          externalId: 'id',
          title: 'title.romaji',
          year: 'startDate.year',
          total: 'chapters',
          art: 'coverImage.large',
          synopsis: 'description',
          subtype: 'format',
        },
        detailFieldMap: {
          externalId: 'data.Media.id',
          title: 'data.Media.title.romaji',
          year: 'data.Media.startDate.year',
          total: 'data.Media.chapters',
          art: 'data.Media.coverImage.large',
          synopsis: 'data.Media.description',
          subtype: 'data.Media.format',
          /**
           * O item é a ARESTA (`relationType`) e a obra é o NÓ. Sem junção: os
           * dois vêm juntos, e por isso `kind` sai do item e o resto de dentro
           * dele por caminho.
           */
          relations: {
            path: 'data.Media.relations.edges',
            kind: 'relationType',
            id: 'node.id',
            title: 'node.title.romaji',
            art: 'node.coverImage.large',
            year: 'node.startDate.year',
            typeToken: 'node.type',
          },
          /**
           * Aqui a aresta tem **dois** saltos até a obra — `node` é o voto e
           * `mediaRecommendation` é o que foi recomendado. Sem `kind`, porque
           * não há relação a nomear: o que este provedor guarda na aresta é
           * `rating`, quantos concordaram, e isso não é o nome de nada.
           *
           * `typeToken` fica porque o nó traz `type`, e a junção já traduz
           * `ANIME` e `MANGA` — recomendação de anime para mangá é rara mas
           * possível, e sai navegável de graça.
           */
          recommendations: {
            path: 'data.Media.recommendations.edges',
            id: 'node.mediaRecommendation.id',
            title: 'node.mediaRecommendation.title.romaji',
            art: 'node.mediaRecommendation.coverImage.large',
            year: 'node.mediaRecommendation.startDate.year',
            typeToken: 'node.mediaRecommendation.type',
          },
          links: [{ label: 'AniList', path: 'data.Media.siteUrl' }],
        },
      },
    ],
  },
  /**
   * O SÉTIMO provedor, e o primeiro desde o TMDB que pode carregar `score`.
   *
   * **Tudo aqui foi MEDIDO em 07/09/2026**, contra a API real com um Client ID
   * de verdade — e isso não é zelo: a referência oficial do MyAnimeList **não
   * traz uma amostra de resposta sequer** (`node` aparece zero vezes no texto
   * dela). O envelope `data[].node` só é conhecido por wrappers da comunidade,
   * e escrever `field_map` a partir disso seria modelar de terceira mão.
   *
   * ── `mean` é 0–10, e isso quebra uma sequência ──────────────────────────────
   * Kitsu, AniList e IGDB ficaram sem `score` porque a escala deles é 0–100 e o
   * contrato não tem vocabulário de escala — três ausências declaradas que
   * promoveram a lacuna a pendência com dono. **O MyAnimeList devolve 9.25**,
   * a mesma escala do TMDB, então aqui o campo entra sem inventar nada.
   *
   * ── O zero que significa "desconhecido" ────────────────────────────────────
   * `num_chapters` e `num_volumes` vêm **0** para obra em publicação — medido:
   * Berserk (`currently_publishing`) devolve 0, Monster (`finished`) devolve
   * 162, Vagabond (`on_hiatus`) devolve 327. O mapeador já lê zero como ausente
   * (`|| null`, comentado em `providers.detail.ts`), então não houve vocabulário
   * novo a inventar — mas a razão passou a estar escrita nos dois lados.
   *
   * ── A marca dele NÃO entra na nossa tela, e é o contrato que diz ───────────
   * A seção 17 do *API License and Developer Agreement* proíbe incluir as marcas
   * deles em "Your Applications", com uma exceção só (3(a)(xiii)): usá-las **para
   * atribuir** a fonte, e o exemplo que eles dão é uma FRASE, não um logo. O
   * design system já tinha previsto o caso ao decidir marca de terceiro — "um
   * brand que não se possa empacotar simplesmente não tem logo, e a tela
   * continua inteira". Então: `attribution` com texto, e o ladrilho fica na
   * inicial.
   */
  {
    slug: 'mal',
    name: 'MyAnimeList',
    baseUrl: 'https://api.myanimelist.net/v2',
    /**
     * **Texto, e é o único uso da marca que o contrato permite** — 3(a)(xiii):
     * "except to attribute MyAnimeList and the Company Offering as the source of
     * MyAnimeList Content". Ao contrário do Kitsu, isto está **verificado**: li
     * o contrato inteiro, não presumi.
     */
    attribution: 'Data from MyAnimeList',
    /**
     * O Client ID viaja num header próprio, sem prefixo — medido: `Bearer` não
     * entra, e sem o header a resposta é **403 `forbidden`**.
     */
    auth: {
      style: 'header-key',
      header: 'X-MAL-Client-ID',
      credential: 'client_id',
    },
    /**
     * **Teto auto-imposto: eles não publicam nenhum, e não mandam header.**
     * Medido — a resposta não traz `x-ratelimit-*`, ao contrário do AniList, e a
     * documentação não cita limite. Mesma régua do Kitsu: quando o provedor não
     * diz o teto, quem declara é a nossa contenção. 3/s cobre a busca a cada
     * tecla com debounce e fica uma ordem de grandeza abaixo de qualquer coisa
     * que pareça abuso.
     *
     * O Yamtrack anota no próprio código que "MAL has no limit" — observação
     * deles, não garantia, e limite ausente por observação é o que muda sem
     * aviso.
     */
    rateLimit: { perSecond: 3, burst: 5 },
    endpoints: {
      /**
       * `fields` é obrigatório para vir qualquer coisa além de id, título e
       * imagem — medido.
       *
       * ── Ele é do PROVEDOR e o conteúdo dele é do TIPO ─────────────────────
       * Um comentário aqui dizia que "os dois pares trazem o seu, porque o
       * campo de total difere". **Isso nunca existiu**: `query` mora em
       * `endpoints`, e o par só sobrescreve `path` e `body`. O comentário
       * descrevia um mecanismo que ninguém construiu, e por isso ninguém foi
       * conferir o que a lista anime-only estava custando.
       *
       * Custava quatro coisas, todas silenciosas porque o `fieldMap` lê um
       * caminho que a resposta simplesmente não traz (09/09/2026):
       *
       *   1. **A busca não pedia total nenhum**, nos dois tipos — o `total` do
       *      mapa aponta pra `node.num_episodes` / `node.num_chapters`
       *   2. **O detalhe de mangá não pedia `num_chapters`**
       *   3. **O detalhe de mangá não pedia `related_manga`**, então mangá
       *      nenhum jamais mostrou vínculo
       *   4. **Nem vínculo nem recomendação pediam a data**, e a carta dizia
       *      `Year unknown` em todas
       *
       * ── A saída é a UNIÃO, e ela foi medida ───────────────────────────────
       * O MAL **ignora em silêncio** o campo que não se aplica ao tipo: a busca
       * de anime devolve `num_episodes` e omite `num_chapters`, a de mangá faz
       * o inverso, e nenhuma das duas erra. Coluna de query por par seria a
       * quinta propriedade a fazer o caminho *"o que pertence ao par se
       * declara"* — e é o certo no dia em que um segundo provedor precisar
       * dela. Hoje só o MAL usa `fields` com mais de um tipo (o Open Library
       * usa, e tem um tipo só), então a união paga alguns bytes por pedido em
       * vez de uma coluna que serviria a um caso.
       *
       * A sub-seleção com chaves (`recommendations{node{start_date}}`) é
       * dialeto do MAL, e também foi medida: sem ela o `node` volta com id,
       * título e imagem, e nada mais.
       */
      search: {
        path: '/anime',
        queryParam: 'q',
        query: {
          limit: '20',
          fields: MAL_SEARCH_FIELDS,
        },
        // O TMDB põe em `results`; este põe em `data`, e cada item vem
        // embrulhado num `node`.
        resultsPath: 'data',
      },
      detail: {
        path: '/anime/{id}',
        query: {
          fields: MAL_DETAIL_FIELDS,
        },
      },
      /**
       * **Um pedido que o provedor ACEITA** — a lição que o Open Library
       * cobrou. Com credencial errada isto responde **400 `bad_request`** com
       * "Invalid client id", que é exatamente o que o "testar conexão" precisa
       * distinguir de rede fora.
       *
       * **`q` tem MÍNIMO DE TRÊS caracteres, e isto nasceu com `q: 'a'`** —
       * medido em 07/09/2026: `a` e `ab` devolvem 400 `invalid q`, `abc` e
       * `test` devolvem 200. Ou seja, "testar conexão" falhava SEMPRE neste
       * provedor, com a mesma frase de credencial errada, enquanto a chave
       * funcionava perfeitamente em busca e import.
       *
       * O comentário acima já dizia a regra que a linha abaixo violava, e é o
       * que torna o caso instrutivo: **enunciar a régua não a cumpre**. O
       * pedido de teste tem que ser EXECUTADO uma vez contra o provedor de
       * verdade — é a única prova de que ele o aceita.
       */
      test: { path: '/anime', query: { q: 'test', limit: '1' } },
    },
    fieldMap: {
      externalId: 'node.id',
      title: 'node.title',
      year: 'node.start_date',
      art: 'node.main_picture.large',
      synopsis: 'node.synopsis',
      score: 'node.mean',
      subtype: 'node.media_type',
    },
    credentials: [
      {
        key: 'client_id',
        label: 'Client ID',
        help: 'Free, from myanimelist.net/apiconfig. Only the ID is needed.',
      },
    ],
    options: [],
    mediaTypes: [
      {
        slug: 'anime',
        searchPath: '/anime',
        detailPath: '/anime/{id}',
        providerTypeToken: 'anime',
        fieldMap: {
          externalId: 'node.id',
          title: 'node.title',
          year: 'node.start_date',
          total: 'node.num_episodes',
          art: 'node.main_picture.large',
          synopsis: 'node.synopsis',
          score: 'node.mean',
          subtype: 'node.media_type',
          /**
           * **MEDIDO em 08/09/2026:** `tv`, `ona`, `movie`, `tv_special` — tudo
           * minúsculo, e `tv_special` composto. A regra de FORMA de
           * `subtypeLabel` não alcança nenhum dos dois casos, e o resultado era
           * `Tv` e `Tv Special`.
           *
           * **O mangá dele NÃO entra**, e isso também foi medido:
           * `light_novel`, `manga`, `manhwa`, `one_shot` não têm sigla nenhuma,
           * e a regra genérica já os escreve certo.
           */
          subtypeAcronyms: ['tv', 'ova', 'ona'],
        },
        /** No DETALHE o recurso vem na raiz, sem o `node` da lista. */
        detailFieldMap: {
          externalId: 'id',
          title: 'title',
          year: 'start_date',
          total: 'num_episodes',
          art: 'main_picture.large',
          synopsis: 'synopsis',
          score: 'mean',
          subtype: 'media_type',
          // O detalhe lê o mesmo enum que a busca, na raiz em vez de sob `node`
          // — então a lista se repete. Ver o `fieldMap` acima para o porquê.
          subtypeAcronyms: ['tv', 'ova', 'ona'],
          /**
           * **Vínculo com tipo, e ele vem NOMEADO** — medido:
           * `related_anime[].relation_type` devolve `other`, `prequel`,
           * `sequel`. É o terceiro provedor com o conceito, e o primeiro cujo
           * `kind` sai pronto sem tradução.
           */
          relations: {
            path: 'related_anime',
            id: 'node.id',
            title: 'node.title',
            art: 'node.main_picture.large',
            /**
             * **O `kind` sai PRONTO, e é o primeiro provedor assim.** Medido:
             * `relation_type` devolve `other`/`prequel`/`sequel` e
             * `relation_type_formatted` devolve `Other` já capitalizado. Usar o
             * formatado dispensa a normalização que `subtypeLabel` faz nos
             * outros — quem escreveu a frase foi o provedor.
             */
            kind: 'relation_type_formatted',
            /**
             * **A data vem da SUB-SELEÇÃO, e ela precisa ser pedida** — sem
             * `{node{start_date}}` no `fields`, o `node` volta com id, título e
             * imagem e mais nada, e a carta dizia `Year unknown` em todas.
             * `start_date` começa pelo ano (`2009-10-12`), então nenhum
             * `yearFormat` é preciso.
             */
            year: 'node.start_date',
            /**
             * **Sem `typeToken`, e a ausência é a resposta certa.**
             * `related_anime` num detalhe de anime só devolve anime — o
             * endpoint já é do tipo. Ausente quer dizer "o mesmo tipo da obra",
             * que é o que o TMDB já faz pelos dois pares dele.
             */
          },
          recommendations: {
            path: 'recommendations',
            id: 'node.id',
            title: 'node.title',
            art: 'node.main_picture.large',
            year: 'node.start_date',
          },
        },
      },
      {
        slug: 'manga',
        searchPath: '/manga',
        detailPath: '/manga/{id}',
        providerTypeToken: 'manga',
        fieldMap: {
          externalId: 'node.id',
          title: 'node.title',
          year: 'node.start_date',
          // Zero aqui significa DESCONHECIDO — ver o bloco do topo.
          total: 'node.num_chapters',
          art: 'node.main_picture.large',
          synopsis: 'node.synopsis',
          score: 'node.mean',
          subtype: 'node.media_type',
        },
        detailFieldMap: {
          externalId: 'id',
          title: 'title',
          year: 'start_date',
          total: 'num_chapters',
          art: 'main_picture.large',
          synopsis: 'synopsis',
          score: 'mean',
          subtype: 'media_type',
          relations: {
            path: 'related_manga',
            id: 'node.id',
            title: 'node.title',
            art: 'node.main_picture.large',
            /**
             * **O `kind` sai PRONTO, e é o primeiro provedor assim.** Medido:
             * `relation_type` devolve `other`/`prequel`/`sequel` e
             * `relation_type_formatted` devolve `Other` já capitalizado. Usar o
             * formatado dispensa a normalização que `subtypeLabel` faz nos
             * outros — quem escreveu a frase foi o provedor.
             */
            kind: 'relation_type_formatted',
            /**
             * **A data vem da SUB-SELEÇÃO, e ela precisa ser pedida** — sem
             * `{node{start_date}}` no `fields`, o `node` volta com id, título e
             * imagem e mais nada, e a carta dizia `Year unknown` em todas.
             * `start_date` começa pelo ano (`2009-10-12`), então nenhum
             * `yearFormat` é preciso.
             */
            year: 'node.start_date',
            /**
             * **Sem `typeToken`, e a ausência é a resposta certa.**
             * `related_anime` num detalhe de anime só devolve anime — o
             * endpoint já é do tipo. Ausente quer dizer "o mesmo tipo da obra",
             * que é o que o TMDB já faz pelos dois pares dele.
             */
          },
          recommendations: {
            path: 'recommendations',
            id: 'node.id',
            title: 'node.title',
            art: 'node.main_picture.large',
            year: 'node.start_date',
          },
        },
      },
    ],
  },
  {
    slug: 'igdb',
    name: 'IGDB',
    baseUrl: 'https://api.igdb.com/v4',
    /**
     * **Não verificado nos termos, como o do Kitsu e o do AniList.** `null` é
     * uma afirmação — "este provedor não exige crédito" —, e o IGDB é da Twitch,
     * que costuma exigir. Conferir antes de qualquer release.
     */
    attribution: null,
    /**
     * `image_id` mais o tamanho, que é como o CDN deles monta. `t_cover_big`
     * dá 264×374, verificado ao vivo: 200 com 21 KB.
     */
    artTemplate:
      'https://images.igdb.com/igdb/image/upload/t_cover_big/{path}.jpg',
    /**
     * **O primeiro `oauth-client-credentials` executado**, e o primeiro provedor
     * que nasce exigindo configuração do admin.
     *
     * Verificado ao vivo em 02/09/2026: o token vale **5.327.537 segundos**, ou
     * 61,7 dias — é esse número que faz o cache de token existir, porque pedir
     * um a cada busca bateria no endpoint da Twitch por um valor que não muda
     * em dois meses.
     *
     * **`idHeader` é exigência DELE, não do OAuth.** O 401 do IGDB responde com
     * uma lista de dicas, e a primeira é literal: "Ensure you are sending
     * Authorization and Client-ID as headers". Foi assim, sem credencial
     * nenhuma, que essa peça do contrato foi descoberta.
     *
     * **O secret não é embarcado** (brief, 3.10). A cláusula da Twitch é
     * literal contra, e o teto é por `client_id` — uma chave nossa na release
     * seria o mesmo orçamento dividido por todas as instalações do Watchpile.
     */
    auth: {
      style: 'oauth-client-credentials',
      tokenUrl: 'https://id.twitch.tv/oauth2/token',
      header: 'Authorization',
      prefix: 'Bearer ',
      idHeader: 'Client-ID',
      credentials: { id: 'client_id', secret: 'client_secret' },
    },
    /**
     * **Da documentação, não medido** — e a diferença importa, porque o AniList
     * ensinou que os dois podem discordar. O IGDB **não devolve header de rate
     * limit**, verificado: não há `x-ratelimit-*` na resposta. Então aqui o que
     * existe é o número publicado — 4 por segundo, 8 requisições abertas.
     */
    rateLimit: { perSecond: 4, burst: 8 },
    endpoints: {
      /**
       * **Um endereço só, e o corpo em apicalypse.** Não há rota de busca
       * separada: `POST /games` responde busca e detalhe, e o que muda é a
       * consulta no corpo — `search "…"` contra `where id = …`.
       *
       * `queryParam` fica vazio pelo mesmo motivo do AniList: o termo mora no
       * corpo, e a presença dele é o que faz o cliente parar de acrescentar
       * parâmetro nenhum à URL.
       *
       * **Sem `resultsPath`**: ele devolve o array na raiz, que o cliente
       * genérico já cobre.
       *
       * ── O que NÃO está no corpo, e é decisão ───────────────────────────────
       * **Nada de `where game_type = 0;`.** Medido: o filtro tira o port de
       * Vita e a DLC da busca por "hollow knight", o que parece uma melhora —
       * mas tira junto remaster, port e expansão standalone, que são obras que
       * alguém legitimamente acompanha. Uma busca que esconde o que existe é
       * pior que uma busca com um item a mais, e quem decide qual é a obra
       * certa é quem procurou.
       */
      search: {
        path: '/games',
        queryParam: '',
        body: {
          kind: 'apicalypse',
          template: `search "{term}"; ${IGDB_FIELDS} limit 20;`,
        },
      },
      /**
       * **`{id}` entra SOLTO na sintaxe**, sem aspas em volta — e é por isso
       * que `providers.body.ts` escapa os marcadores de forma diferente: aqui o
       * valor É a consulta, e um id como `1 | id = 2` a reescreveria sem ter
       * uma aspa sequer pra escapar.
       */
      detail: {
        path: '/games',
        body: {
          kind: 'apicalypse',
          template: `${IGDB_DETAIL_FIELDS} where id = {id};`,
        },
      },
      /**
       * **Um pedido que o provedor ACEITA**, e o mais barato: um campo, um
       * item. Ao contrário dos quatro primeiros, aqui testar valida a
       * CREDENCIAL de verdade — a troca de token acontece antes, então uma
       * chave errada falha na troca e a tela diz isso, em vez de dizer que o
       * provedor está fora do ar.
       */
      test: {
        path: '/games',
        body: { kind: 'apicalypse', template: 'fields id; limit 1;' },
      },
    },
    /**
     * ── A ausência declarada, pela TERCEIRA vez ─────────────────────────────
     * **`score` e `votes` ficam de fora.** `total_rating` é 0–100 (medido:
     * 82.2256… para Elden Ring Nightreign), contra os 0–10 do TMDB. Terceira
     * ocorrência da mesma ausência, depois do Kitsu e do AniList — e três vezes
     * é o que transforma "falta vocabulário de escala" de observação em
     * pendência com dono.
     */
    fieldMap: {
      externalId: 'id',
      title: 'name',
      /**
       * **`game_type` é referência, e `.type` é o nome dela.** Pedir só
       * `game_type` devolveria o id do tipo (`0`, `5`, `14`); o apicalypse
       * expande a referência quando se pede o campo de dentro, e é isso que
       * traz `Main Game` e `Mod` em vez de números.
       */
      subtype: 'game_type.type',
      year: 'first_release_date',
      /**
       * **Medido**: `1431993600` é maio de 2015, que é quando The Witcher 3
       * saiu. Sem esta linha, os quatro primeiros dígitos dariam o ano **1431**
       * — um número plausível, na coluna certa, sem erro nenhum.
       */
      yearFormat: 'unix-seconds',
      art: 'cover.image_id',
      synopsis: 'summary',
    },
    credentials: [
      {
        key: 'client_id',
        label: 'Client ID',
        help: 'Create an application at dev.twitch.tv/console/apps. Requires 2FA on the Twitch account.',
      },
      {
        key: 'client_secret',
        label: 'Client secret',
        help: 'Shown once, when you generate it. Generating a new one invalidates the old.',
      },
    ],
    options: [],
    mediaTypes: [
      {
        slug: 'game',
        /**
         * **Sem token, e é declaração**: o IGDB não distingue tipo, então o nó
         * de um vínculo herda o tipo da obra. Declarar `game` aqui seria
         * inofensivo e mentiroso — nada na resposta dele carrega esse token.
         */
        /**
         * **Sem lista de unidades, e a ausência é do OBJETO.** Jogo não tem
         * parte numerada — não há episódio nem capítulo a marcar —, e é o mesmo
         * caso de filme e livro, que também não declaram `units_path`.
         */
        detailFieldMap: {
          /**
           * **O prefixo `0.` é o array da resposta.** O IGDB devolve
           * `[{ … }]` mesmo para um id só — verificado —, ao contrário do
           * AniList, que devolve o objeto direto. O leitor de caminho pontuado
           * atravessa índice numérico sem código novo, porque array em
           * JavaScript é objeto com chave de texto.
           */
          externalId: '0.id',
          title: '0.name',
          subtype: '0.game_type.type',
          year: '0.first_release_date',
          yearFormat: 'unix-seconds',
          art: '0.cover.image_id',
          synopsis: '0.summary',
          /**
           * **O caso degenerado do vínculo**: um só, sem tipo de relação
           * nomeado, e nunca trocando de tipo de mídia — tudo no IGDB é jogo.
           * `kindConst` é o que a definição diz no lugar do provedor, e
           * `typeToken` fica ausente justamente porque não há o que resolver.
           */
          relations: {
            path: '0.parent_game',
            kindConst: 'parent',
            id: 'id',
            title: 'name',
            art: 'cover.image_id',
            year: 'first_release_date',
            /** Timestamp Unix, como o da própria obra. Sem isto: ano 1487. */
            yearFormat: 'unix-seconds',
          },
          /**
           * `similar_games` — **dez, e o número é dele**: medido em duas obras,
           * volta exatamente dez das duas vezes, e não há parâmetro pra pedir
           * outro tanto. É o único dos três em que o teto não é escolha de
           * ninguém.
           *
           * Sem `typeToken` pelo mesmo motivo do `parent_game` logo acima: tudo
           * no IGDB é jogo, e um vínculo nunca troca de tipo. E sem `kindConst`,
           * ao contrário dele — lá a definição nomeia a relação porque há uma;
           * aqui não há.
           */
          recommendations: {
            path: '0.similar_games',
            id: 'id',
            title: 'name',
            art: 'cover.image_id',
            year: 'first_release_date',
            yearFormat: 'unix-seconds',
          },
          links: [{ label: 'IGDB', path: '0.url' }],
        },
      },
    ],
  },
]

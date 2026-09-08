import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import type { FieldMap, ProviderBody, UnitMap } from './providers.js'
import { providers } from './providers.js'

/**
 * A junção mora em arquivo PRÓPRIO porque pertence aos dois lados, e não a um —
 * 01/09/2026.
 *
 * O motivo imediato é mecânico: `media_types` passou a apontar pro provedor
 * padrão, e com a junção dentro de `providers.ts` os dois arquivos de schema
 * se importariam em ciclo. Drizzle sobreviveria (as referências são callbacks),
 * mas ciclo de módulo que só funciona por ordem de avaliação é defeito
 * esperando dia ruim.
 *
 * O motivo que sobrevive ao mecânico: uma tabela de junção não é do provedor
 * nem do tipo. Guardá-la num dos dois sempre foi uma escolha de conveniência.
 */
/**
 * Que provedores servem que tipos de mídia.
 *
 * **Muitos-para-muitos, e opcional nos dois sentidos** (brief, 3.10): o TMDB
 * serve filme e série; um anime pode querer AniList e TMDB. Tabela de junção,
 * não coluna em nenhum dos lados.
 *
 * **Tipo sem provedor é legítimo — é o estado de todos os seis hoje.** Exigir
 * provedor na criação seria inventar um requisito que nem os embutidos cumprem.
 * O que a ausência muda é a BUSCA, e ela devolve **erro explicativo**, nunca
 * lista vazia: lista vazia significa "procurei e não achei", e usar a mesma
 * tela pra "não tinha onde procurar" faz o usuário concluir que a obra não
 * existe no catálogo.
 *
 * **Provedor sem tipo também é legítimo** — fica ocioso, não quebrado, e a tela
 * diz isso. É o estado em que um provedor semeado nasce quando o wizard não
 * semeou o tipo correspondente (brief, 3.9).
 *
 * Os dois lados por SLUG, como o resto do schema.
 */
export const mediaTypeProviders = sqliteTable(
  'media_type_providers',
  {
    mediaTypeSlug: text('media_type_slug')
      .notNull()
      .references(() => mediaTypes.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    providerSlug: text('provider_slug')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /**
     * O endpoint de busca DESTE par, quando ele difere do endpoint geral do
     * provedor — 01/09/2026.
     *
     * O TMDB obriga: `/search/movie` e `/search/tv` são rotas diferentes, e o
     * `/search/multi` que as junta devolve os dois formatos misturados, com um
     * `media_type` por item que o mapa de campos teria que interpretar. Buscar
     * por tipo é o que o produto faz — a tela pergunta "procure um filme" —,
     * então o par é a granularidade certa.
     *
     * Nulo cai no endpoint do provedor. É o caso do AniList e do Open Library,
     * que têm uma rota só pra tudo que servem.
     */
    searchPath: text('search_path'),
    /**
     * O CORPO da busca DESTE par — 02/09/2026.
     *
     * É `search_path` estendido ao dialeto de quem fala por `POST`. No AniList
     * o caminho é `/` para tudo, e o que separa anime de mangá é a variável
     * `type` **dentro do corpo**; no IGDB o que separa jogo de outra coisa é o
     * endpoint apicalypse. Sem isto, o par não teria como diferir — e o efeito
     * seria o mesmo defeito do TMDB com o id 1396: verificado ao vivo, pedir um
     * id de anime como `MANGA` no AniList devolve **404**, então o tipo no corpo
     * está fazendo trabalho de verdade.
     *
     * Nulo cai no corpo do endpoint do provedor, que é o caso dos quatro
     * primeiros — nenhum deles tem corpo nenhum.
     */
    searchBody: text('search_body', { mode: 'json' }).$type<ProviderBody>(),
    /**
     * O mapa de campos DESTE par, pelo mesmo motivo: filme devolve `title` e
     * `release_date`, série devolve `name` e `first_air_date`. Um mapa por
     * provedor descreveria um dos dois e mentiria sobre o outro.
     *
     * Nulo cai no mapa do provedor.
     */
    fieldMap: text('field_map', { mode: 'json' }).$type<FieldMap>(),
    /**
     * O endpoint que lista as UNIDADES deste par — episódios de uma série,
     * capítulos de um mangá (brief, 3.10).
     *
     * `{id}` recebe o id externo da obra e `{group}` o número do grupo, mesmo
     * templating que o detalhe já usa. Provedor cujas unidades não se agrupam
     * simplesmente não põe `{group}` no caminho.
     *
     * **Mora na junção e não no provedor**, pelo mesmo motivo de `search_path`:
     * o TMDB serve filme e série pela mesma linha, e só série tem unidades. Um
     * caminho por provedor descreveria um dos dois e mentiria sobre o outro.
     *
     * **Nulo é o caso comum**, e é o que faz filme, jogo e livro não terem
     * lista nenhuma — sem coluna extra e sem caso especial, do mesmo jeito que
     * tipo sem provedor já é legítimo.
     */
    /**
     * O endpoint de DETALHE deste par (01/09/2026).
     *
     * **Descoberto rodando**: o TMDB lê `/movie/{id}` e `/tv/{id}`, e o
     * endpoint do provedor só podia ser um dos dois. Pedir o detalhe de uma
     * série trazia o filme de mesmo id — id 1396 é Breaking Bad em série e
     * *Mirror* (1975) em filme, e a tela mostrava o filme com o selo de série.
     * O cache de arte tinha o mesmo defeito, latente: só tinha sido exercido
     * com filme.
     *
     * É a régua de `search_path` estendida: **o "como" de um DETALHE também é
     * do par**, não do provedor. Nulo cai no do provedor, que é o caso de quem
     * tem uma rota só.
     */
    detailPath: text('detail_path'),
    /** O corpo do DETALHE deste par, pelo mesmo motivo de `search_body`. */
    detailBody: text('detail_body', { mode: 'json' }).$type<ProviderBody>(),
    /**
     * O mapa de campos da resposta de DETALHE, quando ela não fala a mesma
     * língua da busca.
     *
     * **O TMDB escondeu que essas duas coisas podem diferir** — lá `title`,
     * `poster_path` e `overview` têm o mesmo nome nos dois endpoints, então um
     * mapa só descrevia os dois. O Open Library não: a busca devolve
     * `cover_i` e `first_publish_year`, e o detalhe devolve `covers[0]` e
     * `description`, que a busca não tem. Um mapa só deixaria metade nula, e a
     * metade nula seria a arte — o que quebraria o cache em silêncio.
     *
     * Fica no PAR, como `detail_path`, e pelo mesmo motivo. Nulo cai no mapa da
     * busca, que é o que mantém o TMDB inalterado.
     */
    detailFieldMap: text('detail_field_map', {
      mode: 'json',
    }).$type<FieldMap>(),
    /**
     * O token que ESTE provedor usa pra nomear ESTE tipo — 02/09/2026.
     *
     * `ANIME` no par (anime, anilist), `anime` no (anime, kitsu), `MANGA` e
     * `manga` nos de mangá. Ele existe por um motivo só: **resolver o tipo do
     * nó de um vínculo sem mapa em código**.
     *
     * Um vínculo atravessa tipo — o `ADAPTATION` de um anime aponta pra um
     * mangá —, e a rota de detalhe precisa do nosso slug pra navegar. O
     * provedor devolve o token DELE; a junção diz a que tipo aquele token
     * corresponde. Escrever `MANGA → manga` em código seria o
     * `if (slug === …)` que o brief 3.10 recusa, com outra roupa.
     *
     * **Nulo quer dizer que o provedor não distingue**, e é o caso do IGDB:
     * tudo ali é jogo, e um vínculo nunca troca de tipo.
     */
    providerTypeToken: text('provider_type_token'),
    /**
     * O endpoint que lista os VÍNCULOS deste par, quando eles não vêm na
     * resposta de detalhe.
     *
     * Mesma forma de `units_path`, e pelo mesmo motivo: o Kitsu serve relação
     * em `/{tipo}/{id}/media-relationships`, enquanto IGDB e AniList a
     * devolvem dentro do detalhe que já foi buscado. **Nulo é o caso comum** —
     * e significa "leia do corpo do detalhe", não "não há vínculo".
     *
     * O teto de paginação vai DENTRO do caminho, como no `units_path`: é
     * propriedade do provedor, não escolha nossa.
     */
    relationsPath: text('relations_path'),
    unitsPath: text('units_path'),
    /** Como ler uma unidade da resposta acima. Nulo quando não há unidades. */
    unitMap: text('unit_map', { mode: 'json' }).$type<UnitMap>(),
  },
  (table) => [
    primaryKey({ columns: [table.mediaTypeSlug, table.providerSlug] }),
  ],
)

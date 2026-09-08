import { createRoute, z } from '@hono/zod-openapi'

const MessageSchema = z.object({ message: z.string() })

/**
 * Um resultado de provedor, e ele **não é uma obra**.
 *
 * Sem `id` nosso, sem status, sem progresso, sem dono — nada do que `entries`
 * guarda existe até alguém adicionar. Devolver algo com cara de `Entry` e
 * `id: null` seria a mentira que cobra depois: toda tela que recebesse a lista
 * teria que lembrar de checar o nulo, e uma esqueceria.
 */
const SearchResultSchema = z.object({
  provider: z.string(),
  externalId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  art: z.string().nullable(),
  synopsis: z.string().nullable(),
  /**
   * O que a obra é DENTRO do tipo dela — `TV`, `Mod`, `One Shot`.
   *
   * **É o que separa duas linhas com o mesmo título** na busca: o IGDB devolve
   * o jogo e um Mod chamado igual, e sem isto nada na tela os distingue. Nulo
   * nos provedores que não têm o conceito (TMDB, Open Library).
   *
   * Já chega normalizado — ver `subtypeLabel`. O cliente desenha o que recebe.
   */
  subtype: z.string().nullable(),
})

const ProviderRefSchema = z.object({
  slug: z.string(),
  /**
   * O nome próprio, e ele viaja junto porque **slug é chave, não rótulo**
   * (design system, seção 8, sexta leva). Sem isto a tela escreveria `tmdb`
   * onde devia escrever `TMDB`, que é o defeito já corrigido três vezes aqui.
   */
  name: z.string(),
})

const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  /**
   * **Quem respondeu — um só** (brief, 3.10, fechado em 01/09/2026). Era
   * `providers: string[]` enquanto o handler concatenava; uma busca tem uma
   * fonte, e a tela nomeia essa fonte.
   *
   * A `attribution` vem junto porque **é do provedor, não da tela** (design
   * system, seção 8, sétima leva): o TMDB exige a frase como condição de uso,
   * AniList e Open Library não exigem nenhuma, e uma tela que escrevesse a do
   * TMDB fixa creditaria o provedor errado no dia em que outro respondesse.
   * Nulo quer dizer "este provedor não pede atribuição", não "esqueci".
   */
  provider: ProviderRefSchema.extend({
    attribution: z.string().nullable(),
  }),
  /**
   * As fontes possíveis para este tipo, incluindo quem respondeu. É o que
   * alimenta a troca de fonte da tela — com uma só, não há o que trocar, e a
   * tela mostra o nome sem controle nenhum.
   */
  sources: z.array(ProviderRefSchema),
  /**
   * `externalId` → o id da obra que o usuário JÁ tem (brief, 3.10). Mapa ao
   * lado, e não campo dentro do resultado: um `entryId` dentro daria a
   * `ProviderResult` a cara de `Entry` que o comentário acima recusa.
   */
  owned: z.record(z.string(), z.number().int()),
  /** Se veio do cache. Diagnóstico honesto; a tela não precisa mostrar. */
  cached: z.boolean(),
})

/**
 * A recusa que existe **para não mentir** (brief, 3.10).
 *
 * Procurar num tipo sem provedor não devolve lista vazia: lista vazia significa
 * "procurei e não achei", e usar a mesma tela pra "não tinha onde procurar" faz
 * o usuário concluir que a obra não existe no catálogo — quando não houve
 * catálogo nenhum.
 *
 * `reason` é campo porque as saídas são diferentes: quem caiu em `no-provider`
 * precisa de um admin, quem caiu em `not-configured` precisa de uma chave, e
 * quem caiu em `rate-limited` só precisa esperar.
 *
 * **`provider-error` virou dois em 02/09/2026**, e o motivo é o mesmo pelo qual
 * `reason` é campo: o `4xx` tem o que arrumar e o `5xx` tem o que esperar. A
 * tela tira três coisas daqui — o título, o tom e o botão de configuração —, e
 * um motivo só a obrigaria a reabrir o status pra decidir as três. **Onde o
 * servidor decide, a tela LÊ a decisão.**
 */
const SearchUnavailableSchema = z.object({
  message: z.string(),
  reason: z.enum([
    'no-provider',
    'not-configured',
    'rate-limited',
    'provider-refused',
    'provider-down',
    'unreachable',
  ]),
})

const SearchQuerySchema = z.object({
  /** O slug do tipo de mídia. A busca é POR TIPO, e é o que decide o endpoint. */
  type: z.string().min(1),
  q: z.string().trim().min(1),
  /**
   * A troca de fonte, quando o tipo tem mais de um provedor associado.
   * Ausente, responde o efetivo — ver `search.provider-choice.ts` para a
   * precedência inteira e para por que ela difere de `effectiveProviderOf`.
   */
  provider: z.string().min(1).optional(),
})

export const search = createRoute({
  method: 'get',
  path: '/',
  tags: ['Search'],
  request: { query: SearchQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: SearchResponseSchema } },
      description: 'What the providers for this media type returned',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    /**
     * Pedir um provedor que não serve este tipo é **pedido inválido**, não
     * indisponibilidade: 503 mandaria a pessoa esperar por uma coisa que nunca
     * vai acontecer.
     */
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'That provider does not serve this media type',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No media type with that slug',
    },
    /**
     * 503 e não 200-com-lista-vazia, nem 500: não houve onde procurar, e isso é
     * uma indisponibilidade temporária de uma dependência — que é exatamente o
     * que 503 quer dizer. 500 diria que o defeito é nosso.
     */
    503: {
      content: { 'application/json': { schema: SearchUnavailableSchema } },
      description: 'There was nowhere to search, and the reason says why',
    },
  },
})

export type SearchRoute = typeof search

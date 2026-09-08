import { createRoute, z } from '@hono/zod-openapi'
import { TitleDetailsSchema } from './titles.public.js'

const MessageSchema = z.object({ message: z.string() })

/**
 * A recusa, com a **mesma forma da busca** (`search.routes.ts`).
 *
 * As saídas continuam sendo diferentes por motivo — `not-configured` precisa
 * de um admin com uma chave, `rate-limited` só precisa esperar —, e é o campo
 * `reason` que deixa a tela escolher a copy. Repetir a forma aqui não é
 * duplicação: é o mesmo contrato de "não deu pra perguntar ao terceiro", e as
 * duas telas o traduzem igual.
 *
 * **`not-found` não entra nesta lista**: o provedor respondeu, e respondeu que
 * não tem. Isso é 404, e é o estado de não-encontrado da tela de detalhe
 * (design system, seção 6) — não a recusa.
 */
const UnavailableSchema = z.object({
  message: z.string(),
  reason: z.enum([
    'not-configured',
    'rate-limited',
    'provider-error',
    'unreachable',
  ]),
})

const responses = {
  200: {
    content: { 'application/json': { schema: TitleDetailsSchema } },
    description: 'What the provider knows about this title',
  },
  401: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'No active session',
  },
  404: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'The provider has no such title, or there is nothing to ask',
  },
  503: {
    content: { 'application/json': { schema: UnavailableSchema } },
    description: 'The provider could not answer, and the reason says why',
  },
} as const

/**
 * O detalhe de uma obra do PROVEDOR — a que ainda não é de ninguém.
 *
 * Mora sob `/api/search` porque é de lá que se chega nela, e porque ela é o
 * que a busca devolveu, olhado de perto. Um pai neutro (`/api/titles`) seria
 * um destino que não existe na navegação.
 */
export const getProviderTitle = createRoute({
  method: 'get',
  path: '/{provider}/{externalId}',
  tags: ['Search'],
  request: {
    params: z.object({
      provider: z.string().min(1),
      externalId: z.string().min(1),
    }),
    /**
     * **O tipo é obrigatório, e não é burocracia.** No TMDB o id `1396` é uma
     * série e pode ser outro filme: o par (tipo, id) é que identifica a obra,
     * e é ele que diz qual endpoint ler e qual mapa de campos aplicar. Sem o
     * tipo, a rota teria que adivinhar — e adivinharia errado metade das
     * vezes num provedor que serve dois.
     *
     * É também o que decide se há unidades: `units_path` mora na junção
     * `(tipo, provedor)`.
     */
    query: z.object({ type: z.string().min(1) }),
  },
  responses: responses,
})

/**
 * O mesmo detalhe, para a obra que JÁ é sua.
 *
 * Responde 404 quando a obra não tem vínculo com provedor nenhum — a digitada
 * à mão —, e a tela lê isso como "não há contexto a mostrar", não como erro:
 * ela continua desenhando tudo que `GET /api/entries/{id}` já deu.
 */
export const getEntryDetails = createRoute({
  method: 'get',
  path: '/{id}/details',
  tags: ['Entries'],
  request: { params: z.object({ id: z.coerce.number().int() }) },
  responses: responses,
})

/**
 * As UNIDADES de uma obra — episódios de uma série, capítulos de um mangá.
 *
 * **Não se chama "episodes"** de propósito: o que generaliza entre provedores
 * são partes numeradas, opcionalmente agrupadas, e o vocabulário já existe em
 * `media_types.progress_unit`. Assar "episode" aqui traria de volta o "seis de
 * tudo" que o brief 3.12 recusou — a rota guardando capítulo no dia do mangá.
 *
 * `group` é opcional porque nem todo provedor agrupa: o TMDB pede a temporada,
 * o Jikan devolve a lista inteira de uma vez.
 */
const UnitSchema = z.object({
  number: z.number().int(),
  title: z.string().nullable(),
  synopsis: z.string().nullable(),
  art: z.string().nullable(),
  date: z.string().nullable(),
  runtime: z.number().int().nullable(),
})

const unitResponses = {
  200: {
    content: {
      'application/json': {
        schema: z.object({ units: z.array(UnitSchema) }),
      },
    },
    description: 'The units of this title, in provider order',
  },
  401: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'No active session',
  },
  /**
   * **Também responde 404 quando o par não TEM unidades**, e é honesto: filme
   * não tem episódio, e a pergunta não faz sentido. A tela nem chega a fazê-la
   * — `hasUnits` no detalhe já disse.
   */
  404: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'There are no units to list for this title',
  },
  503: {
    content: { 'application/json': { schema: UnavailableSchema } },
    description: 'The provider could not answer, and the reason says why',
  },
} as const

const GroupQuerySchema = z.object({
  group: z.coerce.number().int().optional(),
})

export const getProviderUnits = createRoute({
  method: 'get',
  path: '/{provider}/{externalId}/units',
  tags: ['Search'],
  request: {
    params: z.object({
      provider: z.string().min(1),
      externalId: z.string().min(1),
    }),
    query: GroupQuerySchema.extend({ type: z.string().min(1) }),
  },
  responses: unitResponses,
})

export const getEntryUnits = createRoute({
  method: 'get',
  path: '/{id}/units',
  tags: ['Entries'],
  request: {
    params: z.object({ id: z.coerce.number().int() }),
    query: GroupQuerySchema,
  },
  responses: unitResponses,
})

export type GetProviderUnitsRoute = typeof getProviderUnits
export type GetEntryUnitsRoute = typeof getEntryUnits
export type GetProviderTitleRoute = typeof getProviderTitle
export type GetEntryDetailsRoute = typeof getEntryDetails

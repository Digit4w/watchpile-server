import { createRoute, z } from '@hono/zod-openapi'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import { ENTRY_SORTS } from './entries.query.js'

export const EntrySchema = createSelectSchema(entries)
  /**
   * `primaryProvider` sai junto com `userId`, e por um motivo próprio: a forma
   * ÚTIL dele já viaja em `GET /api/entries/{id}/links`, como `chosen` ao lado
   * de `effective`. A coluna crua seria uma segunda maneira de perguntar a
   * mesma coisa — e **duas contas da mesma coisa é como uma fica pra trás**,
   * que é o defeito que este repositório já pegou na escolha da fonte de busca.
   *
   * Sozinha ela também não responde nada: um slug que não está entre os
   * vínculos é ignorado por `sourceOf`, então lê-la sem a lista ao lado daria
   * uma resposta errada com cara de certa.
   */
  .omit({ userId: true, primaryProvider: true })
  .extend({
    /**
     * O endereço da arte, ou `null` (brief, 3.10). **Derivado**, não coluna: a
     * obra tem arte quando existe um `external_ids` de onde tirá-la.
     *
     * O servidor manda a URL pronta pelo mesmo motivo do resultado de busca —
     * montar endereço de arte no cliente seria o `if (slug === 'tmdb')` que o
     * brief recusa —, e aqui vale duas vezes: o cliente não precisa saber que
     * existe cache. A forma pública inteira mora em `entries.public.ts`.
     */
    art: z.string().nullable(),
  })
  /**
   * O nome que a obra tem NO contrato — `components.schemas.Entry`, e não uma
   * forma anônima repetida dentro de cada resposta (brief, 3.7).
   *
   * Sem ele o cliente escreve a entidade à mão, que é o que o brief recusa, ou
   * a alcança por um caminho que nomeia uma ROTA e não a coisa
   * (`paths['/api/entries']['get']['responses'][200]…`) — e esse caminho passa
   * a mentir no dia em que duas rotas devolverem formas diferentes.
   */
  .openapi('Entry')

// nota pessoal é 0–10 com uma casa decimal (brief, 6) — a tabela guarda
// `real`, então a régua da escala só existe aqui
const ratingSchema = z
  .number()
  .min(0)
  .max(10)
  .refine((value) => Number.isInteger(value * 10), {
    message: 'Rating accepts at most one decimal place',
  })

// `progress` fica de fora de propósito: ele só se move pelo endpoint de
// progresso, que escreve no log append-only junto (brief, 3.11)
const EntryBodySchema = createInsertSchema(entries, {
  title: (schema) => schema.min(1),
  rating: () => ratingSchema,
  total: (schema) => schema.int().positive(),
}).pick({
  mediaType: true,
  title: true,
  status: true,
  rating: true,
  notes: true,
  total: true,
})

/**
 * De onde a obra veio, quando veio da busca (brief, 3.10).
 *
 * **Adicionar é UM passo pra quem usa e DOIS no schema:** a linha de `entries`
 * e a de `external_ids` nascem juntas, na mesma transação. Sem o par, uma obra
 * adicionada do TMDB ficaria sem vínculo — e reconectá-la depois só se faria
 * apagando e re-adicionando, o que leva progresso e log junto.
 *
 * Objeto e não dois campos soltos: os dois valem juntos ou nenhum, e um
 * `externalId` sem `provider` é um id que ninguém sabe ler.
 */
const SourceSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1),
})

const CreateBodySchema = EntryBodySchema.required({ mediaType: true }).extend({
  /** Ausente é o caminho normal: obra digitada à mão não tem procedência. */
  source: SourceSchema.optional(),
  /**
   * Em quais pilhas a obra entra ao nascer (brief, 3.17).
   *
   * **Escreve na MESMA transação** que já cria `entries` e `external_ids`: a
   * folha é um gesto só pra quem usa, e uma obra que nascesse fora da pilha
   * que a pessoa escolheu seria pior que um erro — seria um acerto pela
   * metade, sem nada na tela dizendo qual metade falhou.
   *
   * **Posição é o fim da pilha**, pelo índice fracionário (brief, 3.14).
   * Escolher onde não cabe aqui: quem ordena é a tela da pilha, que tem
   * arrasto e mostra os vizinhos.
   *
   * Ausente e vazio são a mesma coisa — obra vive fora de pilha, e isso é
   * normal no modelo.
   */
  pileIds: z.array(z.number().int()).optional(),
})
const UpdateBodySchema = EntryBodySchema.partial()

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const ListQuerySchema = z.object({
  mediaType: EntrySchema.shape.mediaType.optional(),
  status: EntrySchema.shape.status.optional(),
  /**
   * Busca por texto no título. Campo vazio vira ausente em vez de erro: a
   * caixa de busca de `/library` fica vazia a maior parte do tempo, e apagar
   * o que se digitou não pode responder 400.
   */
  q: z
    .string()
    .trim()
    .optional()
    .transform((term) => term || undefined),
  sort: z.enum(ENTRY_SORTS).default('updated'),
})

const MessageSchema = z.object({
  message: z.string(),
})

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Entries'],
  request: {
    query: ListQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(EntrySchema) } },
      description: "The current user's entries",
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const create = createRoute({
  method: 'post',
  path: '/',
  tags: ['Entries'],
  request: {
    body: { content: { 'application/json': { schema: CreateBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: EntrySchema } },
      description: 'The entry was created',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description:
        'The media type, the provider or one of the piles does not exist here',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    /**
     * A obra já está na biblioteca de quem pediu.
     *
     * **É rede, não a defesa principal** (brief, 3.10): a busca já devolve
     * `owned` e a tela desabilita o resultado antes do clique, porque o app não
     * tem toast pra explicar uma falha depois dele. Isto cobre as duas abas
     * clicando junto — e devolve o `entryId` pra que a tela ainda consiga
     * apontar pra obra existente em vez de só dizer não.
     */
    409: {
      content: {
        'application/json': {
          schema: MessageSchema.extend({ entryId: z.number().int() }),
        },
      },
      description: 'That title is already in this library',
    },
  },
})

/**
 * O resumo do que o log sabe — quando começou, a última vez, quantas vezes.
 *
 * **Resumo e não lista**: é o que cabe numa caixa da coluna, e é o que responde
 * "faz quanto tempo que larguei isto?". A lista inteira é outra tela, e ela
 * ainda não existe.
 */
export const getHistory = createRoute({
  method: 'get',
  path: '/{id}/history',
  tags: ['Entries'],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            startedAt: z.string().nullable(),
            lastAt: z.string().nullable(),
            /** Quantos EVENTOS de progresso, não quantas unidades. */
            events: z.number().int(),
          }),
        },
      },
      description: 'What the log knows about this title',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
  },
})

export type GetHistoryRoute = typeof getHistory

export const getById = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EntrySchema } },
      description: 'The entry',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
  },
})

export const update = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EntrySchema } },
      description: 'The entry was updated',
    },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The media type does not exist on this server',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
  },
})

// ajuste de progresso é evento novo no log, nunca UPDATE na linha antiga
// (brief, 3.11) — por isso ele tem rota própria e `progress` fica fora do
// PATCH acima
const ProgressBodySchema = z.object({
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, { message: 'Delta must not be zero' }),
  occurredAt: z.coerce.date().optional(),
  origin: createSelectSchema(eventLog).shape.origin.optional(),
})

export const addProgress = createRoute({
  method: 'post',
  path: '/{id}/progress',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: ProgressBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EntrySchema } },
      description: 'The entry, with the counter already advanced',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
    422: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The delta would move the counter out of range',
    },
  },
})

export const remove = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
  },
  responses: {
    204: { description: 'The entry was deleted' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Entry not found',
    },
  },
})

/**
 * Apagar a biblioteca INTEIRA desta pessoa.
 *
 * ── Por que ela existe, e o que ela custa ───────────────────────────────────
 * Pedida pelo dono do projeto em 07/09/2026 para poder recomeçar do zero sem
 * apagar o arquivo do banco — o que levaria junto pilhas, widgets, tipos de
 * mídia e a configuração dos provedores, que é infraestrutura e não conteúdo.
 * O recorte é o oposto: só `entries`, e o que pende dela.
 *
 * **Ela leva mais do que o nome diz, e por cascade:** `event_log`,
 * `external_ids`, `pile_entries` e `widget_entry_order` são donas por
 * transitividade. Progresso, histórico, vínculo com provedor e a posição da
 * obra em cada pilha somem junto — as PILHAS ficam, vazias. É por isso que a
 * tela promete isso antes do clique, com a contagem ao lado (design system,
 * seção 5).
 *
 * ── Sem segunda tranca no protocolo, e é decisão ────────────────────────────
 * Nenhum parâmetro de confirmação (`?confirm=yes`) e nenhum corpo com a
 * contagem esperada. O único cliente que existe passaria os dois
 * automaticamente, então eles não protegeriam ninguém — seriam a confirmação
 * escrita no lugar errado. Quem confirma é a tela, uma vez, com a contagem à
 * vista.
 *
 * **200 e não 204**, ao contrário do delete de uma obra: aqui o número apagado
 * é a resposta que a tela mostra. `204` obrigaria a contar antes e torcer para
 * que nada tivesse mudado no meio.
 */
export const removeAll = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Entries'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({ deleted: z.number().int() })
            .openapi('DeletedEntries'),
        },
      },
      description: 'How many entries were deleted',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export type ListRoute = typeof list
export type CreateRoute = typeof create
export type GetByIdRoute = typeof getById
export type UpdateRoute = typeof update
export type AddProgressRoute = typeof addProgress
export type RemoveRoute = typeof remove
export type RemoveAllRoute = typeof removeAll

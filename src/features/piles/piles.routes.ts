import { createRoute, z } from '@hono/zod-openapi'
import { createInsertSchema } from 'drizzle-zod'
import { piles } from '../../db/schema/piles.js'
import { PileWithDetailsSchema as PileSchema } from './piles.public.js'
import { PILE_SORTS } from './piles.query.js'

const PileFieldsSchema = createInsertSchema(piles, {
  name: (schema) => schema.min(1),
  /**
   * Vazia e ausente são a mesma coisa: apagar o texto da folha manda `''`, e
   * guardar string vazia faria a lista desenhar uma linha de descrição em
   * branco onde deveria não haver linha nenhuma.
   */
  description: (schema) => schema.trim().transform((text) => text || null),
}).pick({ name: true, description: true, removeWhenCompleted: true })

/**
 * Criar aceita descrição, mas o popover de `New pile` não a manda — e as duas
 * coisas estão certas. "Criar pede só o nome" é decisão de FORMULÁRIO (brief,
 * 3.17: o peso do formulário acompanha o objeto), não de contrato; um import
 * de Trakt/CSV (3.12) chega com nome e descrição juntos e não deve precisar de
 * dois requests pra gravar o que já tem na mão.
 */
const CreateBodySchema = PileFieldsSchema.partial({
  description: true,
  removeWhenCompleted: true,
})

/**
 * Parcial de propósito: renomear sem tocar na descrição é pedido legítimo, e
 * exigir o corpo inteiro faria o cliente reenviar um texto que não mudou — e
 * sobrescrever o que outra aba tivesse escrito no meio.
 */
const UpdateBodySchema = PileFieldsSchema.partial().extend({
  /**
   * O cliente diz a INTENÇÃO, o servidor escolhe o instante — mesma regra que
   * `position` já segue em `piles.entries.routes.ts`. Aceitar `pinnedAt` cru
   * deixaria um cliente gravar uma data futura e furar a ordem das fixadas
   * sem que nada no servidor tivesse errado.
   */
  pinned: z.boolean().optional(),
})

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const ListQuerySchema = z.object({
  /**
   * Busca por nome de pilha. Campo vazio vira ausente em vez de 400, mesmo
   * motivo de `entries.routes.ts`: a caixa passa a maior parte do tempo vazia,
   * e apagar o que se digitou não pode ser erro.
   */
  q: z
    .string()
    .trim()
    .optional()
    .transform((term) => term || undefined),
  sort: z.enum(PILE_SORTS).default('updated'),
})

const MessageSchema = z.object({
  message: z.string(),
})

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Piles'],
  request: {
    query: ListQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PileSchema) } },
      description: "The current user's piles",
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
  tags: ['Piles'],
  request: {
    body: { content: { 'application/json': { schema: CreateBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: PileSchema } },
      description: 'The pile was created',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const getById = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Piles'],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PileSchema } },
      description: 'The pile',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Pile not found',
    },
  },
})

export const update = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Piles'],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PileSchema } },
      description: 'The pile was updated',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Pile not found',
    },
  },
})

export const remove = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Piles'],
  request: {
    params: IdParamSchema,
  },
  responses: {
    204: { description: 'The pile was deleted' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Pile not found',
    },
  },
})

export type ListRoute = typeof list
export type CreateRoute = typeof create
export type GetByIdRoute = typeof getById
export type UpdateRoute = typeof update
export type RemoveRoute = typeof remove

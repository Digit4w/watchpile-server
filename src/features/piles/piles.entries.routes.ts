import { createRoute, z } from '@hono/zod-openapi'
import { EntrySchema } from '../entries/entries.routes.js'

const PileIdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const MembershipParamSchema = PileIdParamSchema.extend({
  entryId: z.coerce.number().int(),
})

const AddBodySchema = z.object({
  entryId: z.number().int(),
})

// `position` nunca sai nem entra pelo JSON: o cliente diz atrás de quem o item
// vai, e o servidor escolhe o número (brief, 3.14 — índice fracionário). Assim
// nenhum cliente consegue gravar posição duplicada ou esgotar a precisão.
const MoveBodySchema = z.object({
  after: z
    .number()
    .int()
    .nullable()
    .openapi({ description: 'Entry to sit behind; null moves it to the top' }),
})

const MessageSchema = z.object({
  message: z.string(),
})

const notFound = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'Pile or entry not found',
}

const unauthorized = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'No active session',
}

export const listEntries = createRoute({
  method: 'get',
  path: '/{id}/entries',
  tags: ['Piles'],
  request: { params: PileIdParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(EntrySchema) } },
      description: 'The entries in the pile, in their manual order',
    },
    401: unauthorized,
    404: notFound,
  },
})

export const addEntry = createRoute({
  method: 'post',
  path: '/{id}/entries',
  tags: ['Piles'],
  request: {
    params: PileIdParamSchema,
    body: { content: { 'application/json': { schema: AddBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: EntrySchema } },
      description: 'The entry was appended to the end of the pile',
    },
    401: unauthorized,
    404: notFound,
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The entry is already in the pile',
    },
  },
})

export const moveEntry = createRoute({
  method: 'patch',
  path: '/{id}/entries/{entryId}',
  tags: ['Piles'],
  request: {
    params: MembershipParamSchema,
    body: { content: { 'application/json': { schema: MoveBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(EntrySchema) } },
      description: 'The pile, in its new order',
    },
    401: unauthorized,
    404: notFound,
    422: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The anchor entry cannot receive this move',
    },
  },
})

export const removeEntry = createRoute({
  method: 'delete',
  path: '/{id}/entries/{entryId}',
  tags: ['Piles'],
  request: { params: MembershipParamSchema },
  responses: {
    204: { description: 'The entry was removed from the pile' },
    401: unauthorized,
    404: notFound,
  },
})

export type ListEntriesRoute = typeof listEntries
export type AddEntryRoute = typeof addEntry
export type MoveEntryRoute = typeof moveEntry
export type RemoveEntryRoute = typeof removeEntry

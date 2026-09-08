import { createRoute, z } from '@hono/zod-openapi'
import { createSelectSchema } from 'drizzle-zod'
import { homeWidgets } from '../../db/schema/home-widgets.js'
import { EntrySchema } from '../entries/entries.routes.js'
import { WidgetFilterSchema } from './home-widgets.filter.js'

const widgetTable = createSelectSchema(homeWidgets)

const LayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
})

/**
 * `pileIds` vazio significa a biblioteca inteira (brief, 3.15) — não é campo
 * faltando, é ausência de restrição de fonte.
 */
const WidgetSchema = widgetTable.omit({ userId: true, filter: true }).extend({
  filter: WidgetFilterSchema,
  pileIds: z.array(z.number().int()),
})

/**
 * Campos do widget, SEM default. O create abaixo aplica os defaults; o patch
 * fica com este cru, e a diferença não é estilo.
 *
 * `.partial()` não desfaz `.default()` — chave ausente continua produzindo o
 * valor default. Um PATCH só de `filter` gravaria `w: 4, h: 4` por cima do
 * layout do usuário, ou seja: mexer no filtro apagaria o tamanho do widget.
 */
const WidgetFieldsSchema = z.object({
  type: widgetTable.shape.type,
  // `null` devolve o rótulo derivado; string vazia é normalizada pra `null` no
  // handler, pra não existirem dois jeitos de dizer "sem nome".
  title: z.string().max(60).nullable(),
  filter: WidgetFilterSchema,
  pileIds: z.array(z.number().int()),
  itemCount: z.number().int().positive().nullable(),
  x: LayoutSchema.shape.x,
  y: LayoutSchema.shape.y,
  w: LayoutSchema.shape.w,
  h: LayoutSchema.shape.h,
})

const CreateBodySchema = WidgetFieldsSchema.extend({
  title: z.string().max(60).nullable().default(null),
  filter: WidgetFilterSchema.default({}),
  pileIds: z.array(z.number().int()).default([]),
  itemCount: z.number().int().positive().nullable().default(null),
  x: LayoutSchema.shape.x.default(0),
  y: LayoutSchema.shape.y.default(0),
  w: LayoutSchema.shape.w.default(4),
  h: LayoutSchema.shape.h.default(4),
})

const UpdateBodySchema = WidgetFieldsSchema.partial()

const IdParamSchema = z.object({ id: z.coerce.number().int() })

const MessageSchema = z.object({ message: z.string() })

const unauthorized = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'No active session',
}
const notFound = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'Widget not found',
}

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Home widgets'],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WidgetSchema) } },
      description: "The current user's home layout",
    },
    401: unauthorized,
  },
})

export const create = createRoute({
  method: 'post',
  path: '/',
  tags: ['Home widgets'],
  request: {
    body: { content: { 'application/json': { schema: CreateBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: WidgetSchema } },
      description: 'The widget was created',
    },
    401: unauthorized,
    422: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'A referenced pile does not belong to the user',
    },
  },
})

/**
 * Layout em lote. O `react-grid-layout` emite a posição de TODOS os widgets a
 * cada arrasto — um PATCH por widget seria uma rajada de requisições por
 * gesto, e um erro no meio deixaria o layout pela metade.
 *
 * Precisa ser registrada antes de `/{id}`: sem isso o path bate no param.
 */
export const updateLayout = createRoute({
  method: 'patch',
  path: '/layout',
  tags: ['Home widgets'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            widgets: z
              .array(LayoutSchema.extend({ id: z.number().int() }))
              .min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WidgetSchema) } },
      description: 'The home layout, as saved',
    },
    401: unauthorized,
    404: notFound,
  },
})

export const update = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Home widgets'],
  request: {
    params: IdParamSchema,
    body: {
      content: { 'application/json': { schema: UpdateBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WidgetSchema } },
      description: 'The widget was updated',
    },
    401: unauthorized,
    404: notFound,
    422: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'A referenced pile does not belong to the user',
    },
  },
})

export const remove = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Home widgets'],
  request: { params: IdParamSchema },
  responses: {
    204: { description: 'The widget was removed' },
    401: unauthorized,
    404: notFound,
  },
})

const MembershipParamSchema = z.object({
  id: z.coerce.number().int(),
  entryId: z.coerce.number().int(),
})

// Mesma forma do reorder de pile: o cliente diz atrás de QUEM o item vai, e o
// servidor escolhe o número (brief, 3.14). Nenhum cliente grava `position`.
const MoveBodySchema = z.object({
  after: z
    .number()
    .int()
    .nullable()
    .openapi({ description: 'Entry to sit behind; null moves it to the top' }),
})

export const listEntries = createRoute({
  method: 'get',
  path: '/{id}/entries',
  tags: ['Home widgets'],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(EntrySchema) } },
      description: 'The works this widget resolves to, in display order',
    },
    401: unauthorized,
    404: notFound,
  },
})

export type ListRoute = typeof list
export type CreateRoute = typeof create
export type UpdateLayoutRoute = typeof updateLayout
export type UpdateRoute = typeof update
export type RemoveRoute = typeof remove
export const moveEntry = createRoute({
  method: 'patch',
  path: '/{id}/entries/{entryId}',
  tags: ['Home widgets'],
  request: {
    params: MembershipParamSchema,
    body: { content: { 'application/json': { schema: MoveBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(EntrySchema) } },
      description: 'The widget entries, in their new order',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Widget or entry not found',
    },
    422: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The anchor entry cannot receive this move',
    },
  },
})

export type ListEntriesRoute = typeof listEntries
export type MoveEntryRoute = typeof moveEntry

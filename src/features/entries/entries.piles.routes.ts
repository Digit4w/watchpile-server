import { createRoute, z } from '@hono/zod-openapi'
import { PublicPileSchema } from '../piles/piles.public.js'

const PileSchema = PublicPileSchema

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * Em quais pilhas esta obra já está.
 *
 * É a metade que faltava pra tela de "adicionar à pilha" conseguir mostrar o
 * estado atual em vez de só oferecer o destino. Sem ela, o cliente teria que
 * buscar os membros de cada pilha e cruzar — uma requisição por pilha, e a
 * conta piora com o uso.
 *
 * Vive em `entries` e não em `piles` porque a pergunta é sobre a OBRA: dado um
 * card, onde ele está. A direção contrária já existe em
 * `GET /api/piles/{id}/entries`.
 */
export const listPiles = createRoute({
  method: 'get',
  path: '/{id}/piles',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PileSchema) } },
      description: 'The piles this entry belongs to',
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

export type ListPilesRoute = typeof listPiles

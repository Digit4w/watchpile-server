import { createRoute, z } from '@hono/zod-openapi'
import { PileWithDetailsSchema } from './piles.public.js'

/**
 * Os limites da capa (design system, decisão em aberto #9, fechada em
 * 31/08/2026 na parte que o servidor precisa).
 *
 * `COVER_MAX_BYTES` não é o tamanho esperado — é o teto contra um cliente que
 * não seja o nosso. O navegador sobe ~40KB já reduzidos (400×400 WebP), e o
 * servidor **não normaliza dimensão** (brief, 3.17), então o que protege o
 * arquivo de banco é a contagem de bytes e nada mais. 2MB dá ~50× de folga e
 * ainda impede que alguém engorde o `.db`, que é o arquivo do backup.
 *
 * **400×400 e não os 300×300 que o design system chutava**: o número mudou
 * quando `/piles/:id` ganhou um hero que mostra a capa a 200px de lado — num
 * display 2× isso são 400 pixels reais. O chute antigo era do tempo em que o
 * maior uso era o ladrilho de 150px.
 */
export const COVER_MAX_BYTES = 2 * 1024 * 1024

/**
 * Lista de permissão, nunca de bloqueio.
 *
 * O nosso cliente manda `image/webp` sempre. Os outros dois existem porque o
 * servidor é de quem hospeda e vai receber import um dia (3.12) — e porque uma
 * lista de bloqueio deixaria passar `image/svg+xml`, que é documento
 * executável, não imagem.
 */
export const COVER_TYPES = ['image/webp', 'image/png', 'image/jpeg'] as const

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const MessageSchema = z.object({
  message: z.string(),
})

const unauthorized = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'No active session',
}

const notFound = {
  content: { 'application/json': { schema: MessageSchema } },
  description: 'Pile not found',
}

/**
 * A capa tem endereço próprio, e é isso que a mantém fora do JSON.
 *
 * O `<img>` a busca como busca qualquer imagem, o navegador a cacheia, e a
 * listagem de pilhas continua sendo texto. A alternativa — base64 dentro da
 * resposta de `GET /api/piles` — multiplicaria por mil uma resposta que
 * desenha quadrados de 150px.
 */
export const getCover = createRoute({
  method: 'get',
  path: '/{id}/cover',
  tags: ['Piles'],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: {
        'image/webp': { schema: z.string() },
        'image/png': { schema: z.string() },
        'image/jpeg': { schema: z.string() },
      },
      description: 'The uploaded cover',
    },
    304: { description: 'The cover has not changed since the cached copy' },
    401: unauthorized,
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The pile does not exist, or has no cover',
    },
  },
})

/**
 * Corpo cru, com o mime no `Content-Type` — não `multipart/form-data`.
 *
 * O que o cliente tem em mãos é um `Blob` saído do canvas, e
 * `fetch(url, { method: 'PUT', body: blob })` já manda o tipo certo sozinho.
 * Multipart pediria um parser no servidor e um `FormData` no cliente pra
 * transportar um arquivo só, sem campo nenhum ao lado dele.
 *
 * `PUT` e não `POST`: a pilha tem uma capa, e subir de novo substitui. Não há
 * coleção de capas onde uma nova seria criada.
 */
export const putCover = createRoute({
  method: 'put',
  path: '/{id}/cover',
  tags: ['Piles'],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        'image/webp': { schema: z.string() },
        'image/png': { schema: z.string() },
        'image/jpeg': { schema: z.string() },
      },
      description: `The image bytes, at most ${COVER_MAX_BYTES} bytes`,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PileWithDetailsSchema } },
      description: 'The pile, now with a cover',
    },
    401: unauthorized,
    404: notFound,
    413: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The image is larger than the limit',
    },
    415: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The Content-Type is not an accepted image type',
    },
  },
})

export const removeCover = createRoute({
  method: 'delete',
  path: '/{id}/cover',
  tags: ['Piles'],
  request: { params: IdParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PileWithDetailsSchema } },
      description:
        'The pile, now without a cover — the tile falls back to the mosaic',
    },
    401: unauthorized,
    404: notFound,
  },
})

export type GetCoverRoute = typeof getCover
export type PutCoverRoute = typeof putCover
export type RemoveCoverRoute = typeof removeCover

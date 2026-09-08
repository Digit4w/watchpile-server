import { createRoute, z } from '@hono/zod-openapi'

const SourceQuerySchema = z.object({
  source: z.string().min(1).optional(),
})

const IdParamSchema = z.object({
  id: z.coerce.number().int(),
})

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * A arte da obra, servida do cache em disco (brief, 3.10).
 *
 * **Mora sob `/api/entries` e não numa rota própria de arte**, porque quem
 * autoriza é a obra: a permissão é de quem tem a linha em `entries`. Um
 * `/api/art/tmdb/550` seria endereçável por qualquer sessão e diria, a quem
 * tentasse, o que o servidor já baixou de outras contas.
 *
 * **Uma resposta só, e 404 pra todo o resto** — inclusive para arte que o
 * provedor não tem e para falha de rede. Isto é o alvo de um `<img src>`: o
 * navegador não lê corpo de erro e não mostra mensagem, e o que a tela faz em
 * qualquer um dos casos é o mesmo, desenhar o ladrilho com a inicial. O motivo
 * fica no log do servidor, que é onde quem hospeda vai procurar.
 */
export const getArt = createRoute({
  method: 'get',
  path: '/{id}/art',
  tags: ['Entries'],
  request: {
    params: IdParamSchema,
    /**
     * De QUAL vínculo desta obra, quando não é o efetivo.
     *
     * Nasceu em 02/09/2026 com o preview de troca de fonte: sem ele a tela
     * mostraria o pôster do vínculo de HOJE debaixo da sinopse do vínculo que
     * se está prevendo — a metade errada da previsão, e do tipo que parece
     * certa.
     *
     * **Não vaza a semântica de cache pro cliente**, que é o que o brief 3.10
     * proíbe: o endereço continua sendo "a arte desta obra", agora dizendo por
     * qual vínculo. Quem o monta segue sendo o servidor.
     *
     * Vínculo que a obra não tem cai no efetivo, em vez de 404: o parâmetro é
     * um refinamento, e o pedido sem ele já tinha resposta.
     */
    query: SourceQuerySchema,
  },
  responses: {
    200: {
      content: {
        'image/webp': { schema: z.string() },
        'image/png': { schema: z.string() },
        'image/jpeg': { schema: z.string() },
      },
      description: 'The artwork, from the on-disk cache',
    },
    304: { description: 'The artwork has not changed since the cached copy' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The entry does not exist, or has no artwork to serve',
    },
  },
})

export type GetArtRoute = typeof getArt

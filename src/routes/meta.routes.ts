import { createRoute, z } from '@hono/zod-openapi'

/**
 * Fatos sobre o PROCESSO que está respondendo — não sobre um domínio.
 *
 * Fica em `routes/` e não numa feature pelo mesmo motivo do health check: não
 * há entidade aqui, e o que ela responde vale igual pra qualquer instalação.
 *
 * **Separada do `/health`, que é público.** O health check é o que o Docker
 * chama sem sessão, e pendurar a versão nele a publicaria antes do login —
 * versão não é segredo, mas dizer a estranhos qual build está rodando é um
 * favor gratuito a quem procura instalação desatualizada.
 */
const MessageSchema = z.object({
  message: z.string(),
})

/**
 * **A versão é a do SERVIDOR, e é a única que a tela mostra** — numa
 * instalação self-hosted é ele que define o que a instalação é, e o cliente
 * pode ser qualquer um (brief, 3.7). Mostrar a do cliente responderia à
 * pergunta errada com um número que parece a resposta certa.
 *
 * **Nula é estado legítimo**, não erro: ela é lida do `package.json` que
 * empacotou o processo, e um layout que não o traga responde "não sei" em vez
 * de derrubar a rota. `About` sabe dizer isso.
 */
const MetaSchema = z
  .object({
    version: z.string().nullable(),
  })
  .openapi('ServerMeta')

export const getMeta = createRoute({
  method: 'get',
  path: '/',
  tags: ['Meta'],
  responses: {
    200: {
      content: { 'application/json': { schema: MetaSchema } },
      description: 'Facts about the server answering this request',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export type GetMetaRoute = typeof getMeta

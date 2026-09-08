import { createRoute, z } from '@hono/zod-openapi'

/**
 * A rede da INSTALAÇÃO — em qual interface este servidor escuta.
 *
 * **É infraestrutura, então é do admin** (brief, 3.9): quem escreve isto decide
 * quem alcança o servidor na rede de quem hospeda. A leitura também, porque não
 * há nada aqui que sirva a quem não pode mudar.
 *
 * Feature própria e não uma rota dentro de `settings`: o assunto é o processo,
 * não a instalação — o único campo que ela expõe é o único que precisa de um
 * reinício para valer, e isso não se parece com nenhuma outra configuração.
 */

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * Por que o controle não pode ser usado — e a tela usa isto para desabilitá-lo
 * **com o motivo à vista**, em vez de aceitar o toque e falhar depois (design
 * system, seção 5).
 */
const HostLockSchema = z.enum(['not-offered', 'set-by-environment'])

const NetworkSchema = z
  .object({
    /** O endereço em que o processo está escutando AGORA. */
    host: z.string(),
    /** Se esse endereço aceita conexão de fora da máquina. */
    allowsRemote: z.boolean(),
    /**
     * O que valeria num próximo boot. Igual a `allowsRemote` quase sempre —
     * diferente exatamente quando há um reinício pendente.
     */
    intendedAllowsRemote: z.boolean(),
    /**
     * **Trocar o endereço não vale na hora** (decisão do dono): o listener já
     * está aberto, e religá-lo derrubaria a requisição que pediu a troca. Como
     * o controle só existe no desktop, "feche e abra o app" é vocabulário que a
     * plataforma já tem.
     */
    restartPending: z.boolean(),
    /** `null` quando o controle pode ser usado. */
    lock: HostLockSchema.nullable(),
  })
  .openapi('NetworkSettings')

const SetNetworkSchema = z.object({
  allowRemote: z.boolean(),
})

export const get = createRoute({
  method: 'get',
  path: '/',
  tags: ['Network'],
  responses: {
    200: {
      content: { 'application/json': { schema: NetworkSchema } },
      description: 'Where this server is listening, and who decided it',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Not an admin of this server',
    },
  },
})

export const set = createRoute({
  method: 'put',
  path: '/',
  tags: ['Network'],
  request: {
    body: {
      content: { 'application/json': { schema: SetNetworkSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: NetworkSchema } },
      description: 'Saved. It takes effect when the server restarts',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Not an admin of this server',
    },
    /**
     * O controle não está disponível, e o corpo diz por quê. A tela já sabe
     * disso pelo `lock` do `GET` e desabilita antes — este 409 é a rede para
     * quem fala com a API direto.
     */
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'This installation does not decide its bind address here',
    },
  },
})

export type GetRoute = typeof get
export type SetRoute = typeof set

import { createRoute, z } from '@hono/zod-openapi'

/**
 * Atualizar esta instalação — **do admin, caminho inteiro** (brief, 3.9:
 * infraestrutura da instância é do admin).
 *
 * A versão em si NÃO mora aqui: ela é fato de todo mundo e sai em
 * `GET /api/meta`, porque `About` fica fora dos dois grupos de Settings. O que
 * é do admin é decidir sobre atualizar — e sobre sair pra rede pra descobrir.
 */
const MessageSchema = z.object({
  message: z.string(),
})

const UpdateStateSchema = z
  .object({
    current: z.string().nullable(),
    /** Se esta instalação procura versão nova. */
    enabled: z.boolean(),
    /**
     * A mais nova publicada — **mesmo quando não é mais nova que a instalada**.
     * Guardar só quando há novidade deixaria a tela sem o que dizer no caso
     * comum, que é *você está em dia*.
     */
    latest: z.string().nullable(),
    latestUrl: z.string().nullable(),
    /** Quando a última consulta ACONTECEU — inclusive quando ela falhou. */
    checkedAt: z.string().nullable(),
    /**
     * A conta já feita. A tela **não** compara versão: quem sabe o formato que
     * este produto emite é quem o emite, e duas contas da mesma coisa é como
     * uma fica pra trás.
     */
    updateAvailable: z.boolean(),
  })
  .openapi('UpdateState')

export const getUpdates = createRoute({
  method: 'get',
  path: '/',
  tags: ['Updates'],
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateStateSchema } },
      description: 'What this installation knows about newer versions',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'This is for the admin of this server',
    },
  },
})

export const setCheck = createRoute({
  method: 'put',
  path: '/check',
  tags: ['Updates'],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ enabled: z.boolean() }) },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateStateSchema } },
      description: 'The choice was saved',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'This is for the admin of this server',
    },
  },
})

/**
 * Conferir AGORA, e este é o único caminho que espera a rede.
 *
 * Ele existe porque a cadência diária tem um custo honesto: quem acabou de ler
 * que há uma versão nova em outro lugar não quer esperar até amanhã, e uma
 * queda momentânea de rede adia a tentativa automática em um dia inteiro.
 *
 * **Recusa com 409 quando a checagem está desligada**, em vez de ligá-la de
 * volta: o botão confere, não muda configuração. Ligar é o outro gesto, e ele
 * tem o seu próprio controle na mesma tela.
 */
export const checkNow = createRoute({
  method: 'post',
  path: '/check',
  tags: ['Updates'],
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateStateSchema } },
      description: 'The check ran, whether or not it found anything',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'This is for the admin of this server',
    },
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Update checking is turned off on this server',
    },
  },
})

export type GetUpdatesRoute = typeof getUpdates
export type SetCheckRoute = typeof setCheck
export type CheckNowRoute = typeof checkNow

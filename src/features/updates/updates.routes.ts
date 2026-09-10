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

/**
 * O progresso é BARRA nesta tela, e é exceção registrada (10/09/2026, decisão
 * do dono): a regra de 06/09 diz *número, nunca barra*, e o teste dela é *"o
 * denominador é conhecido E o numerador anda de um em um?"* — num download o
 * denominador é conhecido e o numerador anda aos milhares.
 *
 * O servidor manda os dois NÚMEROS e a tela desenha: `total` nulo (servidor sem
 * `Content-Length`) é o caso em que ela cai numa barra indeterminada em vez de
 * mentir uma fração.
 */
const DownloadSchema = z
  .object({
    state: z.enum(['idle', 'downloading', 'ready', 'failed']),
    version: z.string().nullable(),
    received: z.number().int().nullable(),
    total: z.number().int().nullable(),
    /** `kind`, nunca frase: quem escreve a copy é a tela. */
    reason: z.enum(['no-asset', 'no-release', 'failed']).nullable(),
  })
  .openapi('UpdateDownload')

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
    /**
     * Se ESTA instalação sabe aplicar uma atualização sozinha.
     *
     * **Quem responde é o servidor, e não a tela**, porque o cliente é
     * agnóstico de host (brief, 3.4): ele não pode perguntar se está no
     * Electron. Falso é o Docker, onde atualizar é `compose pull` — que
     * acontece fora do processo, e por isso a tela mostra o comando em vez de
     * um botão que finge.
     */
    canInstall: z.boolean(),
    /**
     * Como a atualização TERMINA nesta plataforma, escrita por quem registrou
     * a capacidade — no Windows o instalador substitui e o app fecha, no macOS
     * o `.dmg` abre e a última etapa é arrastar. Nula quando não há como
     * instalar daqui.
     */
    installHint: z.string().nullable(),
    download: DownloadSchema,
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

/**
 * Baixa o instalador da versão nova. **Responde na hora e não espera** — a
 * tela acompanha lendo o estado, como no import.
 */
export const download = createRoute({
  method: 'post',
  path: '/download',
  tags: ['Updates'],
  responses: {
    202: {
      content: { 'application/json': { schema: UpdateStateSchema } },
      description: 'The download started, or was already running',
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
      description:
        'There is nothing to download, or this install cannot apply one',
    },
  },
})

/**
 * Entrega o arquivo baixado ao sistema.
 *
 * **Ela normalmente não devolve nada**, porque o processo termina: o
 * instalador precisa substituir o que está rodando. A resposta é 202 e não
 * 200 — o servidor aceitou e o resultado acontece fora dele.
 */
export const install = createRoute({
  method: 'post',
  path: '/install',
  tags: ['Updates'],
  responses: {
    202: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'The installer was handed to the system',
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
      description:
        'Nothing has been downloaded, or this install cannot apply one',
    },
  },
})

export type DownloadRoute = typeof download
export type InstallRoute = typeof install

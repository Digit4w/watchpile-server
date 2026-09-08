import { createRoute, z } from '@hono/zod-openapi'
import { NOTIFICATION_KINDS } from './notifications.kinds.js'

/**
 * A central de notificações (brief, 3.9; design system, seções 4, 5, 7 e 8).
 *
 * **Duas superfícies, uma rota.** O sino abre um painel com o RECENTE ainda não
 * dispensado; `/notifications` mostra o histórico inteiro, dispensados
 * inclusive. É `include` que separa os dois — e é a distinção entre *lido* e
 * *dispensado* que dá endereço próprio ao histórico: se dispensar apagasse a
 * linha, ele seria o painel com rolagem.
 *
 * **A resposta não carrega frase.** Ela devolve `kind` + `params`, e quem monta
 * a copy é o cliente. Escrever "IGDB needs an API key" aqui seria copy de tela
 * nascendo no servidor — a quarta ocorrência do padrão que o design system já
 * registrou (seção 8) —, e aqui é pior porque a linha é persistida: a frase
 * sobreviveria à tradução do app e ficaria em inglês num histórico antigo.
 */

const MessageSchema = z.object({
  message: z.string(),
})

const NotificationSchema = z
  .object({
    id: z.number().int(),
    audience: z.enum(['instance', 'user']),
    severity: z.enum(['info', 'warning', 'danger']),
    kind: z.enum(NOTIFICATION_KINDS),
    /**
     * O que a frase interpola. Número chega como NÚMERO, não como texto
     * pronto: formatar é `Intl` no cliente, que é onde se sabe o idioma de quem
     * lê (brief, 3.8).
     */
    params: z.record(z.string(), z.union([z.string(), z.number()])),
    createdAt: z.string(),
    read: z.boolean(),
    dismissed: z.boolean(),
  })
  .openapi('Notification')

const ListSchema = z
  .object({
    notifications: z.array(NotificationSchema),
    /** `null` quando não há mais página. Cursor por id, decrescente. */
    nextCursor: z.number().int().nullable(),
  })
  .openapi('NotificationList')

const UnreadCountSchema = z
  .object({
    count: z.number().int(),
    /**
     * A PIOR severidade entre os não lidos — é ela que colore o selo do sino.
     * `null` quando `count` é zero.
     *
     * Vem do servidor e não é recalculada na tela porque o contador é do
     * conjunto inteiro, e a tela só tem a página que pediu. É a régua de "onde
     * o servidor decide, a tela LÊ a decisão" (design system, seção 8).
     */
    severity: z.enum(['info', 'warning', 'danger']).nullable(),
  })
  .openapi('NotificationUnreadCount')

const ListQuerySchema = z.object({
  /**
   * `open` é o painel — o que ainda não foi dispensado. `all` é o histórico.
   * O padrão é `open` porque é o pedido mais frequente: o painel abre em toda
   * sessão, o histórico é visita.
   */
  include: z.enum(['open', 'all']).optional().default('open'),
  /**
   * O eixo de recorte da faixa de baixo de `/notifications`, e **ele só existe
   * pra admin** — quem não é vê um grupo só, e uma fileira com um `All` sozinho
   * é chrome que não faz nada (design system, seção 5). Aqui o filtro é apenas
   * um AND sobre o que a pessoa já podia ver: não-admin pedindo `instance`
   * recebe lista vazia, não 403, porque pra ele aquelas linhas não existem.
   */
  audience: z.enum(['instance', 'user']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  /** Id da última linha da página anterior. */
  cursor: z.coerce.number().int().optional(),
})

export const list = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notifications'],
  request: { query: ListQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSchema } },
      description: 'Notifications this user can see, newest first',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const unreadCount = createRoute({
  method: 'get',
  path: '/unread-count',
  tags: ['Notifications'],
  responses: {
    200: {
      content: { 'application/json': { schema: UnreadCountSchema } },
      description: 'How many unread, and the worst severity among them',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

/**
 * Marca como lido o que o painel MOSTROU, por id — nunca "tudo".
 *
 * O gesto é fechar o painel (design system, seção 5): o não lido só se apaga
 * quando a pessoa termina de olhar, e apagar os pontos durante a leitura é "a
 * lista não se reordena sob a mão" aplicada ao rastro.
 *
 * **Por id e não `mark all`** porque o painel mostra uma página. Um "marcar
 * tudo" implícito no fechar apagaria o rastro de linhas que a pessoa nunca
 * rolou até ver — o contador iria a zero por causa de coisa que ela não leu.
 */
export const markRead = createRoute({
  method: 'post',
  path: '/read',
  tags: ['Notifications'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ ids: z.array(z.number().int()).max(200) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UnreadCountSchema } },
      description: 'The unread counter after the write',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

/**
 * Dispensar tira do painel e **mantém no histórico** — é o que faz
 * `/notifications` merecer uma URL.
 *
 * O mesmo verbo é usado pelo reconciliador quando a condição se resolve
 * sozinha: dispensar significa "terminei com isto", e resolver a condição É
 * terminar com ela (design system, seção 5). Nenhum estado novo pra isso.
 */
export const dismiss = createRoute({
  method: 'post',
  path: '/{id}/dismiss',
  tags: ['Notifications'],
  request: { params: z.object({ id: z.coerce.number().int() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Dismissed',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    404: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No such notification for this user',
    },
  },
})

export type ListRoute = typeof list
export type UnreadCountRoute = typeof unreadCount
export type MarkReadRoute = typeof markRead
export type DismissRoute = typeof dismiss

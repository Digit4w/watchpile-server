import { createRoute, z } from '@hono/zod-openapi'
import { LocaleSchema } from '../media-types/media-types.public.js'

/**
 * O wizard de primeiro uso, em UM lugar (brief, 3.9).
 *
 * **Estas rotas moraram em `features/auth/` até 03/09/2026**, porque a única
 * que existia criava o admin. Com o passo de INSTÂNCIA — idioma-base e quais
 * tipos de mídia a instalação mantém —, "auth" passaria a decidir vocabulário
 * de mídia, que não é assunto dele. `auth` volta a ser só sessão: login,
 * logout e quem sou eu.
 */

const AuthUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  isAdmin: z.boolean(),
})

const CredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
})

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * O que a instalação ainda precisa antes de servir pra alguma coisa.
 *
 * **Deixou de ser booleano em 03/09/2026**, e a razão é que a pergunta cresceu:
 * `setupRequired: true` só sabia dizer "falta criar o admin". Com dois passos,
 * um booleano obrigaria a tela a adivinhar em qual deles ela está — e adivinhar
 * a partir de "tem sessão?" erraria justamente em quem cria o admin e fecha o
 * navegador.
 *
 * `null` é a instalação pronta. Os dois passos são ordenados: não há como estar
 * em `instance` sem ter passado por `account`.
 */
const StatusSchema = z.object({
  pending: z.enum(['account', 'instance']).nullable(),
})

/**
 * O que o passo de instância escreve.
 *
 * **`keep`, não `create`** — e o verbo é o mecanismo (brief, 3.9). A migration
 * `0006` semeia os seis incondicionalmente e migration não se reescreve, então
 * num banco recém migrado já estão todos lá: o que o wizard faz é APAGAR os que
 * ficaram de fora.
 */
const InstanceSetupSchema = z.object({
  language: LocaleSchema,
  keep: z
    .array(z.string().min(1))
    .min(1, { message: 'Pick at least one media type' }),
})

export const status = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Setup'],
  responses: {
    200: {
      content: { 'application/json': { schema: StatusSchema } },
      description: 'Which first-run step, if any, is still pending',
    },
  },
})

export const account = createRoute({
  method: 'post',
  path: '/account',
  tags: ['Setup'],
  request: {
    body: { content: { 'application/json': { schema: CredentialsSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: AuthUserSchema } },
      description: 'The admin account was created, and the session is open',
    },
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'A user already exists — this step has run',
    },
  },
})

export const instance = createRoute({
  method: 'post',
  path: '/instance',
  tags: ['Setup'],
  request: {
    body: { content: { 'application/json': { schema: InstanceSetupSchema } } },
  },
  responses: {
    204: { description: 'The instance is configured' },
    400: {
      content: { 'application/json': { schema: MessageSchema } },
      description:
        'The body failed validation (empty `keep`, bad locale), or a slug in `keep` does not exist on this server',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
    403: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Only the server admin configures the instance',
    },
    409: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'This step has already run',
    },
  },
})

export type StatusRoute = typeof status
export type AccountRoute = typeof account
export type InstanceRoute = typeof instance

import { createRoute, z } from '@hono/zod-openapi'

/**
 * `auth` é SESSÃO, e só — desde 03/09/2026.
 *
 * `GET /status` e `POST /setup` moraram aqui enquanto o wizard de primeiro uso
 * era uma coisa só (criar o admin). Com o passo de INSTÂNCIA entrando — idioma
 * -base e quais tipos de mídia a instalação mantém —, eles foram pra
 * `features/setup/`: "auth" decidindo vocabulário de mídia não é assunto dele.
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

export const login = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  request: {
    body: { content: { 'application/json': { schema: CredentialsSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AuthUserSchema } },
      description: 'Logged in',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'Invalid credentials',
    },
  },
})

export const logout = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Auth'],
  responses: {
    204: { description: 'Logged out' },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export const me = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  responses: {
    200: {
      content: { 'application/json': { schema: AuthUserSchema } },
      description: 'The current user',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export type LoginRoute = typeof login
export type LogoutRoute = typeof logout
export type MeRoute = typeof me

import type { OpenAPIHono, RouteConfig, RouteHandler } from '@hono/zod-openapi'
import type { PinoLogger } from 'hono-pino'
import type { AuthUser } from '../features/auth/auth.entity.js'

export interface AppBindings {
  Variables: {
    logger: PinoLogger
    user?: AuthUser
  }
}

export type AppOpenAPI = OpenAPIHono<AppBindings>

export type AppRouteHandler<R extends RouteConfig> = RouteHandler<
  R,
  AppBindings
>

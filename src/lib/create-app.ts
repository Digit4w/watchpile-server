import { OpenAPIHono } from '@hono/zod-openapi'
import { pinoLoggerMiddleware } from '../middlewares/pino-logger.js'
import { sessionMiddleware } from '../middlewares/session.js'
import { notFound, onError } from './errors.js'
import type { AppBindings } from './types.js'

export function createRouter() {
  return new OpenAPIHono<AppBindings>({ strict: false })
}

export function createApp() {
  const app = createRouter()

  app.use(pinoLoggerMiddleware())
  app.use(sessionMiddleware())
  app.notFound(notFound)
  app.onError(onError)

  return app
}

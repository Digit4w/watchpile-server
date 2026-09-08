import { serveStatic } from '@hono/node-server/serve-static'
import type { MiddlewareHandler } from 'hono'
import { env } from '../env.js'
import type { AppOpenAPI } from './types.js'

// /api/* nunca cai no fallback do client: um 404 de rota da API tem que
// continuar sendo JSON do errors.ts, não o index.html do SPA.
function skipApi(handler: MiddlewareHandler): MiddlewareHandler {
  return (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return handler(c, next)
  }
}

export function configureClientServing(app: AppOpenAPI) {
  if (!env.WATCHPILE_SERVE_CLIENT) return

  const root = env.WATCHPILE_CLIENT_DIST_PATH

  app.use('*', skipApi(serveStatic({ root })))
  app.use('*', skipApi(serveStatic({ path: `${root}/index.html` })))
}

import type { MiddlewareHandler } from 'hono'
import { getSessionUser } from '../features/auth/auth.session.js'
import type { AppBindings } from '../lib/types.js'

export function sessionMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = await getSessionUser(c)
    if (user) {
      c.set('user', user)
    }
    await next()
  }
}

import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { users } from '../../db/schema/users.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { verifyPassword } from './auth.crypto.js'
import type { LoginRoute, LogoutRoute, MeRoute } from './auth.routes.js'
import { createSession, destroySession } from './auth.session.js'

export const login: AppRouteHandler<LoginRoute> = async (c) => {
  const { username, password } = c.req.valid('json')

  const user = db.select().from(users).where(eq(users.username, username)).get()

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return c.json({ message: 'Invalid credentials' }, 401)
  }

  await createSession(c, user.id)

  return c.json(
    { id: user.id, username: user.username, isAdmin: user.isAdmin },
    200,
  )
}

export const logout: AppRouteHandler<LogoutRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  await destroySession(c)

  return c.body(null, 204)
}

export const me: AppRouteHandler<MeRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  return c.json(user, 200)
}

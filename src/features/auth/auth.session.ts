import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { db } from '../../db/client.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import type { AuthUser } from './auth.entity.js'

export const SESSION_COOKIE = 'watchpile_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

let cachedSecret: string | undefined

function getSessionSecret(): string {
  if (cachedSecret) {
    return cachedSecret
  }

  const existing = db.select().from(settings).where(eq(settings.id, 1)).get()
  if (existing) {
    cachedSecret = existing.sessionSecret
    return cachedSecret
  }

  const secret = randomBytes(32).toString('hex')
  db.insert(settings).values({ id: 1, sessionSecret: secret }).run()
  cachedSecret = secret
  return secret
}

export async function createSession(c: Context, userId: number) {
  const token = randomBytes(32).toString('hex')
  db.insert(sessions).values({ id: token, userId }).run()

  await setSignedCookie(c, SESSION_COOKIE, token, getSessionSecret(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function destroySession(c: Context) {
  const token = await getSignedCookie(c, getSessionSecret(), SESSION_COOKIE)
  if (token) {
    db.delete(sessions).where(eq(sessions.id, token)).run()
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export async function getSessionUser(
  c: Context,
): Promise<AuthUser | undefined> {
  const token = await getSignedCookie(c, getSessionSecret(), SESSION_COOKIE)
  if (!token) {
    return undefined
  }

  return db
    .select({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .get()
}

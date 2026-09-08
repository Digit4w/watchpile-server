import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

beforeEach(() => {
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await app.request('/api/setup/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fernando', password: 'password123' }),
    })
  })

  it('logs in with the right credentials', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fernando', password: 'password123' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('rejects the wrong password', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fernando', password: 'wrong-pass' }),
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('returns the user with a valid session, and 401 without one', async () => {
    const setupRes = await app.request('/api/setup/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fernando', password: 'password123' }),
    })
    const cookie = cookieFrom(setupRes)

    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(meRes.status).toBe(200)
    expect(await meRes.json()).toEqual({
      id: expect.any(Number),
      username: 'fernando',
      isAdmin: true,
    })

    const meWithoutCookie = await app.request('/api/auth/me')
    expect(meWithoutCookie.status).toBe(401)

    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(logoutRes.status).toBe(204)

    const meAfterLogout = await app.request('/api/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(meAfterLogout.status).toBe(401)
  })
})

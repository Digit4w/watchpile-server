import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import app from '../app.js'
import { db } from '../db/client.js'
import { sessions } from '../db/schema/sessions.js'
import { users } from '../db/schema/users.js'
import { APP_VERSION } from '../lib/version.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUp(): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'fernando', password: 'password123' }),
  })
  return cookieFrom(res)
}

describe('GET /api/meta', () => {
  it('answers with the version this build carries', async () => {
    db.delete(sessions).run()
    db.delete(users).run()
    const cookie = await signUp()

    const res = await app.request('/api/meta', { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ version: APP_VERSION })
  })

  it('refuses without a session, unlike /health', async () => {
    // The health check is what Docker calls with no session, and hanging the
    // version off it would publish which build is running before the login.
    expect((await app.request('/api/meta')).status).toBe(401)
  })
})

describe('the version this build carries', () => {
  it('is found, and looks like a version', () => {
    // Null is a legitimate answer from the ROUTE — a layout that does not
    // carry the `package.json` says "I do not know" instead of falling over.
    // It is not a legitimate answer HERE: the suite runs from the repo, where
    // the file is one directory up, and null would mean the walk broke.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is the one in package.json, not one written down twice', () => {
    // The CI reads this same file to name the image and cut the release, so
    // it is the source. A second copy is the one that goes stale.
    const declared = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    expect(APP_VERSION).toBe(declared.version)
  })
})

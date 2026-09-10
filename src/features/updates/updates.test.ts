import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { notifications } from '../../db/schema/notifications.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { resetDownload } from './updates.download.js'
import { registerInstaller } from './updates.installer.js'
import { runCheck } from './updates.store.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUpAdmin(): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'fernando', password: 'password123' }),
  })
  return cookieFrom(res)
}

async function signUpMember(): Promise<string> {
  db.insert(users)
    .values({
      username: 'membro',
      passwordHash: hashPassword('password123'),
      isAdmin: false,
    })
    .run()

  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'membro', password: 'password123' }),
  })
  return cookieFrom(res)
}

const get = (cookie?: string) =>
  app.request('/api/updates', cookie ? { headers: { cookie } } : undefined)

const setCheck = (enabled: boolean, cookie: string) =>
  app.request('/api/updates/check', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ enabled }),
  })

const checkNow = (cookie: string) =>
  app.request('/api/updates/check', { method: 'POST', headers: { cookie } })

/** Um feed do GitHub, na forma medida contra o repositório real. */
function feed(...releases: { tag: string; draft?: boolean }[]) {
  return vi.fn(async () =>
    Response.json(
      releases.map((r) => ({
        tag_name: r.tag,
        draft: r.draft ?? false,
        prerelease: true,
        html_url: `https://github.com/x/y/releases/tag/${r.tag}`,
      })),
    ),
  ) as unknown as typeof fetch
}

/** Grava o resultado de uma consulta sem passar pela rede. */
function seenVersion(version: string | null) {
  db.update(settings)
    .set({
      updateLatestVersion: version,
      updateLatestUrl: version ? `https://example.test/${version}` : null,
      updateCheckedAt: new Date(),
    })
    .where(eq(settings.id, 1))
    .run()
}

beforeEach(() => {
  db.delete(notifications).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.update(settings)
    .set({
      updateCheckEnabled: true,
      updateCheckedAt: null,
      updateLatestVersion: null,
      updateLatestUrl: null,
    })
    .where(eq(settings.id, 1))
    .run()
})

describe('GET /api/updates', () => {
  it('is for the admin of this server, not for everyone', async () => {
    // 403 and not 404: someone without the role signed in correctly, and
    // sending them to the login would say the opposite. The version itself
    // is everyone's and lives on GET /api/meta.
    await signUpAdmin()
    const member = await signUpMember()

    expect((await get(member)).status).toBe(403)
  })

  it('refuses without a session', async () => {
    expect((await get()).status).toBe(401)
  })

  it('starts with nothing known and the check on', async () => {
    const cookie = await signUpAdmin()

    const body = (await (await get(cookie)).json()) as Record<string, unknown>

    expect(body.enabled).toBe(true)
    expect(body.latest).toBeNull()
    expect(body.updateAvailable).toBe(false)
  })
})

describe('the check itself', () => {
  it('picks the newest by VERSION, not the first in the list', async () => {
    // The API orders by creation date, and this product's CI reuses an
    // existing release when `main` is repromoted without a version bump.
    await runCheck(
      feed({ tag: 'v0.1.0' }, { tag: 'v0.3.0' }, { tag: 'v0.2.0' }),
    )

    const row = db.select().from(settings).where(eq(settings.id, 1)).get()
    expect(row?.updateLatestVersion).toBe('v0.3.0')
  })

  it('ignores drafts', async () => {
    await runCheck(feed({ tag: 'v9.9.9', draft: true }, { tag: 'v0.2.0' }))

    const row = db.select().from(settings).where(eq(settings.id, 1)).get()
    expect(row?.updateLatestVersion).toBe('v0.2.0')
  })

  it('stamps the date even when the network fails', async () => {
    // Without this, an install with no network would try on every read of the
    // bell — which is exactly what the cadence exists to prevent.
    const dead = vi.fn(async () => {
      throw new Error('no network')
    }) as unknown as typeof fetch

    await runCheck(dead)

    const row = db.select().from(settings).where(eq(settings.id, 1)).get()
    expect(row?.updateCheckedAt).not.toBeNull()
    expect(row?.updateLatestVersion).toBeNull()
  })

  it('a release older than the installed one is not an update', async () => {
    const cookie = await signUpAdmin()
    seenVersion('v0.0.1')

    const body = (await (await get(cookie)).json()) as Record<string, unknown>

    expect(body.latest).toBe('v0.0.1')
    expect(body.updateAvailable).toBe(false)
  })
})

describe('turning the check off', () => {
  it('forgets what it had already seen', async () => {
    // Turning it off is the gesture of not wanting to know. Keeping the
    // answer would leave the screen — and the notification — standing on a
    // question the person just said they did not want asked.
    const cookie = await signUpAdmin()
    seenVersion('v9.9.9')

    const body = (await (await setCheck(false, cookie)).json()) as Record<
      string,
      unknown
    >

    expect(body.enabled).toBe(false)
    expect(body.latest).toBeNull()
    expect(body.updateAvailable).toBe(false)
  })

  it('refuses to check on demand while it is off, instead of turning it on', async () => {
    // The button checks; it does not change configuration. Turning it back on
    // is the other gesture, and it has its own control on the same screen.
    const cookie = await signUpAdmin()
    await setCheck(false, cookie)

    expect((await checkNow(cookie)).status).toBe(409)
  })
})

describe('the notification it raises', () => {
  /** O sino do admin, que é onde as condições de instância se reconciliam. */
  const bell = (cookie: string) =>
    app.request('/api/notifications', { headers: { cookie } })

  /**
   * O que está ABERTO — `include` já é `open` por padrão, que é o painel. O
   * histórico é outra pergunta, e é o que a dispensa automática deixa de pé.
   */
  async function kinds(cookie: string): Promise<string[]> {
    const body = (await (await bell(cookie)).json()) as {
      notifications: { kind: string }[]
    }
    return body.notifications.map((n) => n.kind)
  }

  it('raises one when a newer version is known', async () => {
    const cookie = await signUpAdmin()
    seenVersion('v9.9.9')

    expect(await kinds(cookie)).toContain('update-available')
  })

  it('raises nothing while the installed version is the newest', async () => {
    const cookie = await signUpAdmin()
    seenVersion('v0.0.1')

    expect(await kinds(cookie)).not.toContain('update-available')
  })

  it('dismisses itself once the installation is no longer behind', async () => {
    // This is the "resolved condition dismisses itself" mechanism, and the
    // subject of the dedupe key is the VERSION — which is what makes it work
    // without anything comparing state by hand.
    const cookie = await signUpAdmin()
    seenVersion('v9.9.9')
    expect(await kinds(cookie)).toContain('update-available')

    seenVersion('v0.0.1')

    expect(await kinds(cookie)).not.toContain('update-available')
  })

  it('raises a new one for a new version, not a second for the same', async () => {
    const cookie = await signUpAdmin()
    seenVersion('v9.9.9')
    await bell(cookie)
    await bell(cookie)

    const rows = db.select().from(notifications).all()
    expect(rows.filter((r) => r.kind === 'update-available')).toHaveLength(1)

    seenVersion('v9.9.10')
    expect(await kinds(cookie)).toContain('update-available')
  })

  it('raises nothing while the check is off', async () => {
    const cookie = await signUpAdmin()
    await setCheck(false, cookie)
    seenVersion('v9.9.9')
    db.update(settings)
      .set({ updateCheckEnabled: false })
      .where(eq(settings.id, 1))
      .run()

    expect(await kinds(cookie)).not.toContain('update-available')
  })
})

describe('downloading the installer', () => {
  const download = (cookie: string) =>
    app.request('/api/updates/download', {
      method: 'POST',
      headers: { cookie },
    })

  const install = (cookie: string) =>
    app.request('/api/updates/install', { method: 'POST', headers: { cookie } })

  beforeEach(async () => {
    registerInstaller(null)
    await resetDownload()
  })

  it('refuses when this install cannot apply an update', async () => {
    // Docker: a container does not replace itself, and `compose pull` happens
    // outside the process. Downloading hundreds of megabytes nobody can apply
    // is worse than saying no.
    const cookie = await signUpAdmin()
    seenVersion('v9.9.9')

    expect((await download(cookie)).status).toBe(409)
  })

  it('refuses when there is nothing newer', async () => {
    const cookie = await signUpAdmin()
    registerInstaller({ hint: 'x', apply: () => {} })
    seenVersion('v0.0.1')

    expect((await download(cookie)).status).toBe(409)
  })

  it('says whether this install can apply one, so the screen does not guess', async () => {
    // The client cannot ask whether it is inside Electron (brief, 3.4), so
    // the server answers — and the hint travels with the capability, because
    // it ends differently on each platform.
    const cookie = await signUpAdmin()

    const before = (await (await get(cookie)).json()) as Record<string, unknown>
    expect(before.canInstall).toBe(false)
    expect(before.installHint).toBeNull()

    registerInstaller({ hint: 'It will restart.', apply: () => {} })

    const after = (await (await get(cookie)).json()) as Record<string, unknown>
    expect(after.canInstall).toBe(true)
    expect(after.installHint).toBe('It will restart.')
  })

  it('refuses to apply when nothing has been downloaded', async () => {
    const cookie = await signUpAdmin()
    registerInstaller({ hint: 'x', apply: () => {} })

    expect((await install(cookie)).status).toBe(409)
  })

  it('is for the admin, on both paths', async () => {
    await signUpAdmin()
    const member = await signUpMember()

    expect((await download(member)).status).toBe(403)
    expect((await install(member)).status).toBe(403)
  })
})

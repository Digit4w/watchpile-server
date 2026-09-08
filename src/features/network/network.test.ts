import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { env } from '../../env.js'
import { intendedBind, rememberBound } from './network.store.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUp(username: string): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

function get(cookie?: string) {
  return app.request(
    '/api/network',
    cookie ? { headers: { Cookie: cookie } } : undefined,
  )
}

function put(cookie: string, allowRemote: boolean) {
  return app.request('/api/network', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ allowRemote }),
  })
}

/**
 * Simula o boot: `restartPending` é afirmação sobre o PROCESSO, e a suíte
 * exercita a app por `app.request()` sem passar por `startServer()`. Sem isto o
 * estado cairia no "ainda não subiu", onde nada pode estar pendente — que é a
 * resposta certa, e não a que estes casos querem provar.
 */
function boot(): void {
  rememberBound(intendedBind().host)
}

/**
 * O controle e a variável de ambiente são lidos do `env` validado, então os
 * testes os movem ali — é onde o servidor de verdade os lê, e simular por outro
 * caminho provaria outra coisa.
 */
const original = {
  control: env.WATCHPILE_HOST_CONTROL,
  host: env.WATCHPILE_HOST,
}

beforeEach(() => {
  db.delete(sessions).run()
  db.delete(users).run()
  db.update(settings).set({ bindHost: null }).where(eq(settings.id, 1)).run()
  env.WATCHPILE_HOST_CONTROL = original.control
  env.WATCHPILE_HOST = original.host
})

afterEach(() => {
  env.WATCHPILE_HOST_CONTROL = original.control
  env.WATCHPILE_HOST = original.host
})

describe('GET /api/network', () => {
  it('refuses without a session', async () => {
    expect((await get()).status).toBe(401)
  })

  it('reports the default of an installation that does not offer the control', async () => {
    const cookie = await signUp('fernando')

    const res = await get(cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      allowsRemote: true,
      restartPending: false,
      lock: 'not-offered',
    })
  })

  it('reports a closed default where the control IS offered', async () => {
    env.WATCHPILE_HOST_CONTROL = 'ui'
    const cookie = await signUp('fernando')

    expect(await (await get(cookie)).json()).toMatchObject({
      allowsRemote: false,
      lock: null,
    })
  })

  it('says the environment is what fixed the address', async () => {
    env.WATCHPILE_HOST_CONTROL = 'ui'
    env.WATCHPILE_HOST = '0.0.0.0'
    const cookie = await signUp('fernando')

    expect(await (await get(cookie)).json()).toMatchObject({
      allowsRemote: true,
      lock: 'set-by-environment',
    })
  })
})

describe('PUT /api/network', () => {
  it('refuses without a session', async () => {
    const res = await app.request('/api/network', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowRemote: true }),
    })
    expect(res.status).toBe(401)
  })

  it('saves, and says the change is waiting for a restart', async () => {
    env.WATCHPILE_HOST_CONTROL = 'ui'
    boot()
    const cookie = await signUp('fernando')

    const res = await put(cookie, true)

    expect(res.status).toBe(200)
    // O que ESTÁ valendo não mudou — o listener já está aberto —, e o que
    // valeria num boot, sim. É a resposta dizendo o que a escrita fez e o que
    // ela ainda não fez.
    expect(await res.json()).toMatchObject({
      allowsRemote: false,
      intendedAllowsRemote: true,
      restartPending: true,
    })
  })

  it('keeps the choice for the next read', async () => {
    env.WATCHPILE_HOST_CONTROL = 'ui'
    boot()
    const cookie = await signUp('fernando')

    await put(cookie, true)

    expect(await (await get(cookie)).json()).toMatchObject({
      intendedAllowsRemote: true,
      restartPending: true,
    })
  })

  it('refuses where the control is not offered', async () => {
    const cookie = await signUp('fernando')

    const res = await put(cookie, false)

    expect(res.status).toBe(409)
    // E nada foi gravado: a recusa não pode deixar rastro que valha no próximo
    // boot.
    const stored = db
      .select({ host: settings.bindHost })
      .from(settings)
      .where(eq(settings.id, 1))
      .get()
    expect(stored?.host).toBeNull()
  })

  it('refuses when the environment fixed the address', async () => {
    env.WATCHPILE_HOST_CONTROL = 'ui'
    env.WATCHPILE_HOST = '127.0.0.1'
    const cookie = await signUp('fernando')

    expect((await put(cookie, true)).status).toBe(409)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { hiddenMediaTypes } from '../../db/schema/hidden-media-types.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'

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
    '/api/preferences/media-types',
    cookie ? { headers: { Cookie: cookie } } : undefined,
  )
}

function put(cookie: string, body: unknown) {
  return app.request('/api/preferences/media-types', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  db.delete(hiddenMediaTypes).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('GET /api/preferences/media-types', () => {
  it('starts with nothing hidden', async () => {
    const cookie = await signUp('fernando')

    const res = await get(cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hidden: [] })
  })

  it('refuses without a session', async () => {
    expect((await get()).status).toBe(401)
  })
})

describe('PUT /api/preferences/media-types', () => {
  it('saves the selection and reads it back', async () => {
    const cookie = await signUp('fernando')

    const res = await put(cookie, { hidden: ['game', 'book'] })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hidden: ['book', 'game'] })
    expect(await (await get(cookie)).json()).toEqual({
      hidden: ['book', 'game'],
    })
  })

  /**
   * A escrita SUBSTITUI, e é o que faz um toggle desligado voltar a ligado sem
   * uma segunda rota.
   */
  it('replaces the whole selection instead of adding to it', async () => {
    const cookie = await signUp('fernando')
    await put(cookie, { hidden: ['game', 'book'] })

    await put(cookie, { hidden: ['book'] })

    expect(await (await get(cookie)).json()).toEqual({ hidden: ['book'] })
  })

  it('accepts an empty selection — that is "show everything"', async () => {
    const cookie = await signUp('fernando')
    await put(cookie, { hidden: ['game'] })

    const res = await put(cookie, { hidden: [] })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hidden: [] })
  })

  it('refuses a slug that does not exist on this server', async () => {
    const cookie = await signUp('fernando')

    const res = await put(cookie, { hidden: ['movie', 'podcast'] })

    expect(res.status).toBe(400)
    expect(await (await get(cookie)).json()).toEqual({ hidden: [] })
  })

  /**
   * Esconder tudo deixaria a folha de criar obra sem tipo pra oferecer e a
   * busca sem escopo — beco de onde só se sai voltando a esta tela.
   */
  it('refuses to hide every media type', async () => {
    const cookie = await signUp('fernando')

    const res = await put(cookie, {
      hidden: ['movie', 'tv', 'anime', 'manga', 'game', 'book'],
    })

    expect(res.status).toBe(400)
    expect(await (await get(cookie)).json()).toEqual({ hidden: [] })
  })

  it('ignores a repeated slug instead of failing on the primary key', async () => {
    const cookie = await signUp('fernando')

    const res = await put(cookie, { hidden: ['game', 'game'] })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hidden: ['game'] })
  })

  it('refuses without a session', async () => {
    const res = await app.request('/api/preferences/media-types', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: [] }),
    })

    expect(res.status).toBe(401)
  })
})

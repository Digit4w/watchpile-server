import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { hiddenMediaTypes } from '../../db/schema/hidden-media-types.js'
import { preferredSearchSources } from '../../db/schema/preferred-search-sources.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import {
  searchSourcesOf,
  setSearchSource,
} from './preferences.search-sources.js'

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
  db.delete(preferredSearchSources).run()
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

function getSources(cookie?: string) {
  return app.request(
    '/api/preferences/search-sources',
    cookie ? { headers: { Cookie: cookie } } : undefined,
  )
}

function putSource(cookie: string, type: string, body: unknown) {
  return app.request(`/api/preferences/search-sources/${type}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

describe('GET /api/preferences/search-sources', () => {
  it('starts empty, because never having chosen is the default', async () => {
    const cookie = await signUp('fernando')

    const res = await getSources(cookie)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sources: {} })
  })

  it('refuses without a session', async () => {
    expect((await getSources()).status).toBe(401)
  })
})

describe('PUT /api/preferences/search-sources/{mediaType}', () => {
  it('saves the choice and gives back the whole map', async () => {
    const cookie = await signUp('fernando')

    const res = await putSource(cookie, 'anime', { provider: 'kitsu' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sources: { anime: 'kitsu' } })
  })

  it('keeps one source per type, not one source', async () => {
    // This is what the device-side memory could not do: it held a single
    // pair, so choosing a source for manga forgot the one for anime.
    const cookie = await signUp('fernando')

    await putSource(cookie, 'anime', { provider: 'kitsu' })
    const res = await putSource(cookie, 'manga', { provider: 'jikan' })

    await expect(res.json()).resolves.toEqual({
      sources: { anime: 'kitsu', manga: 'jikan' },
    })
  })

  it('replaces the choice for a type instead of adding a second one', async () => {
    const cookie = await signUp('fernando')

    await putSource(cookie, 'anime', { provider: 'kitsu' })
    const res = await putSource(cookie, 'anime', { provider: 'jikan' })

    await expect(res.json()).resolves.toEqual({ sources: { anime: 'jikan' } })
  })

  it('undoes the choice with null, so the instance default answers again', async () => {
    const cookie = await signUp('fernando')

    await putSource(cookie, 'anime', { provider: 'kitsu' })
    const res = await putSource(cookie, 'anime', { provider: null })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sources: {} })
  })

  it('refuses a provider that does not serve that type', async () => {
    // Same rule as `?provider=` on the search: an external id is only legible
    // inside the pair, so a preference outside it would be born unreadable.
    const cookie = await signUp('fernando')

    const res = await putSource(cookie, 'movie', { provider: 'kitsu' })

    expect(res.status).toBe(400)
  })

  it('answers 404 for a type that does not exist, not 400', async () => {
    // The order of the guards is a decision: a typo must not read as "that
    // provider does not serve this", or whoever wrote it goes looking for the
    // association instead of the typo.
    const cookie = await signUp('fernando')

    const res = await putSource(cookie, 'nope', { provider: 'tmdb' })

    expect(res.status).toBe(404)
  })

  it('is a preference of one person, never of the installation', () => {
    // The whole reason this is not `media_types.default_provider_slug`: that
    // column is the admin's, and writing it from the search would change what
    // everyone on the server searches with.
    //
    // The second user is inserted straight into the table, and that is not a
    // shortcut: this server has NO route that creates a second user (there is
    // no registration and no admin-side creation), so every installation today
    // has exactly one. The guard has to be provable before the day the route
    // exists — that day is the one where finding out is expensive.
    const [one] = db
      .insert(users)
      .values({ username: 'fernando', passwordHash: 'x' })
      .returning({ id: users.id })
      .all()
    const [two] = db
      .insert(users)
      .values({ username: 'someone-else', passwordHash: 'x' })
      .returning({ id: users.id })
      .all()
    if (!one || !two) {
      throw new Error('could not seed the two users')
    }

    setSearchSource(one.id, 'anime', 'kitsu')

    expect(searchSourcesOf(one.id)).toEqual({ anime: 'kitsu' })
    expect(searchSourcesOf(two.id)).toEqual({})
  })

  it('refuses without a session', async () => {
    const res = await app.request('/api/preferences/search-sources/anime', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'kitsu' }),
    })

    expect(res.status).toBe(401)
  })
})

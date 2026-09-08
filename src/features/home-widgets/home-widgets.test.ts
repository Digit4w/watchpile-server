import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { homeWidgets } from '../../db/schema/home-widgets.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { widgetEntryOrder } from '../../db/schema/widget-entry-order.js'
import { widgetPiles } from '../../db/schema/widget-piles.js'

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

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function post(cookie: string, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

function patch(cookie: string, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

async function createPile(cookie: string, name: string): Promise<number> {
  return (
    await json<{ id: number }>(await post(cookie, '/api/piles', { name }))
  ).id
}

async function createEntry(
  cookie: string,
  body: Record<string, unknown>,
): Promise<number> {
  return (await json<{ id: number }>(await post(cookie, '/api/entries', body)))
    .id
}

async function createWidget(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: number; pileIds: number[] }> {
  const res = await post(cookie, '/api/home-widgets', body)
  expect(res.status).toBe(201)
  return json<{ id: number; pileIds: number[] }>(res)
}

async function titlesIn(cookie: string, widgetId: number): Promise<string[]> {
  const res = await app.request(`/api/home-widgets/${widgetId}/entries`, {
    headers: { Cookie: cookie },
  })
  expect(res.status).toBe(200)
  return (await json<{ title: string }[]>(res)).map(({ title }) => title)
}

function pileIdsOf(widgetId: number): number[] {
  return db
    .select({ pileId: widgetPiles.pileId })
    .from(widgetPiles)
    .where(eq(widgetPiles.widgetId, widgetId))
    .all()
    .map(({ pileId }) => pileId)
}

beforeEach(() => {
  db.delete(widgetEntryOrder).run()
  db.delete(widgetPiles).run()
  db.delete(homeWidgets).run()
  db.delete(pileEntries).run()
  db.delete(entries).run()
  db.delete(piles).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('POST /api/home-widgets', () => {
  it('creates a widget with no piles, meaning the whole library', async () => {
    const cookie = await signUp('fernando')

    const widget = await createWidget(cookie, { type: 'list' })

    expect(widget).toMatchObject({
      type: 'list',
      filter: {},
      pileIds: [],
      itemCount: null,
      x: 0,
      y: 0,
      w: 4,
      h: 4,
    })
  })

  it('accepts more than one pile as the source', async () => {
    const cookie = await signUp('fernando')
    const a = await createPile(cookie, 'Watching')
    const b = await createPile(cookie, 'Backlog')

    const widget = await createWidget(cookie, {
      type: 'grid',
      pileIds: [a, b],
    })

    expect(widget.pileIds.sort()).toEqual([a, b].sort())
  })

  it('422s on a pile owned by someone else', async () => {
    const cookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherPile = db
      .insert(piles)
      .values({ userId: other.id, name: 'Anime do Ano' })
      .returning({ id: piles.id })
      .get()

    const res = await post(cookie, '/api/home-widgets', {
      type: 'list',
      pileIds: [otherPile.id],
    })

    expect(res.status).toBe(422)
    expect(db.select().from(homeWidgets).all()).toHaveLength(0)
  })

  it('rejects an unknown widget type', async () => {
    const cookie = await signUp('fernando')

    const res = await post(cookie, '/api/home-widgets', { type: 'calendar' })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown key in the filter', async () => {
    const cookie = await signUp('fernando')

    const res = await post(cookie, '/api/home-widgets', {
      type: 'list',
      filter: { rating: { min: 8 } },
    })
    expect(res.status).toBe(400)
  })

  it('rejects a status the enum does not have', async () => {
    const cookie = await signUp('fernando')

    const res = await post(cookie, '/api/home-widgets', {
      type: 'list',
      filter: { status: ['paused'] },
    })
    expect(res.status).toBe(400)
  })

  it('rejects without a session', async () => {
    const res = await app.request('/api/home-widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'list' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/home-widgets/{id}/entries', () => {
  it('resolves the whole library when the widget has no pile', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'tv', title: 'Severance' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    const widget = await createWidget(cookie, { type: 'list' })

    expect((await titlesIn(cookie, widget.id)).sort()).toEqual([
      'Arrival',
      'Severance',
    ])
  })

  it('applies the filter, which is the widget’s and not the pile’s', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      status: 'watching',
    })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })
    await createEntry(cookie, {
      mediaType: 'manga',
      title: 'Vinland Saga',
      status: 'watching',
    })

    const inProgress = await createWidget(cookie, {
      type: 'list',
      filter: { status: ['watching'] },
    })

    expect((await titlesIn(cookie, inProgress.id)).sort()).toEqual([
      'Severance',
      'Vinland Saga',
    ])
  })

  it('shows the same pile filtered differently in two widgets', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Tudo')
    const tv = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })
    const manga = await createEntry(cookie, {
      mediaType: 'manga',
      title: 'Vinland Saga',
    })
    await post(cookie, `/api/piles/${pile}/entries`, { entryId: tv })
    await post(cookie, `/api/piles/${pile}/entries`, { entryId: manga })

    const onlyTv = await createWidget(cookie, {
      type: 'grid',
      pileIds: [pile],
      filter: { mediaType: ['tv'] },
    })
    const onlyManga = await createWidget(cookie, {
      type: 'list',
      pileIds: [pile],
      filter: { mediaType: ['manga'] },
    })

    expect(await titlesIn(cookie, onlyTv.id)).toEqual(['Severance'])
    expect(await titlesIn(cookie, onlyManga.id)).toEqual(['Vinland Saga'])
  })

  it('unions two piles without repeating a work that is in both', async () => {
    const cookie = await signUp('fernando')
    const a = await createPile(cookie, 'A')
    const b = await createPile(cookie, 'B')
    const shared = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })
    const onlyB = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Arrival',
    })
    await post(cookie, `/api/piles/${a}/entries`, { entryId: shared })
    await post(cookie, `/api/piles/${b}/entries`, { entryId: shared })
    await post(cookie, `/api/piles/${b}/entries`, { entryId: onlyB })

    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [a, b],
    })

    expect((await titlesIn(cookie, widget.id)).sort()).toEqual([
      'Arrival',
      'Severance',
    ])
  })

  it('honours itemCount as a ceiling', async () => {
    const cookie = await signUp('fernando')
    for (const title of ['a', 'b', 'c', 'd']) {
      await createEntry(cookie, { mediaType: 'tv', title })
    }

    const widget = await createWidget(cookie, { type: 'list', itemCount: 2 })

    expect(await titlesIn(cookie, widget.id)).toHaveLength(2)
  })

  it('puts a manually ordered work ahead of the rest', async () => {
    const cookie = await signUp('fernando')
    const first = await createEntry(cookie, { mediaType: 'tv', title: 'first' })
    await createEntry(cookie, { mediaType: 'tv', title: 'second' })
    await createEntry(cookie, { mediaType: 'tv', title: 'third' })

    const widget = await createWidget(cookie, { type: 'list' })
    db.insert(widgetEntryOrder)
      .values({ widgetId: widget.id, entryId: first, position: 0 })
      .run()

    expect((await titlesIn(cookie, widget.id))[0]).toBe('first')
  })

  it('never leaks another user’s works', async () => {
    const cookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    db.insert(entries)
      .values({ userId: other.id, mediaType: 'manga', title: 'Vinland Saga' })
      .run()
    await createEntry(cookie, { mediaType: 'tv', title: 'Severance' })

    const widget = await createWidget(cookie, { type: 'list' })

    expect(await titlesIn(cookie, widget.id)).toEqual(['Severance'])
  })

  it('404s on a widget owned by someone else', async () => {
    const cookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherWidget = db
      .insert(homeWidgets)
      .values({ userId: other.id, type: 'list' })
      .returning({ id: homeWidgets.id })
      .get()

    const res = await app.request(
      `/api/home-widgets/${otherWidget.id}/entries`,
      { headers: { Cookie: cookie } },
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/home-widgets/{id}', () => {
  it('swaps the source piles wholesale', async () => {
    const cookie = await signUp('fernando')
    const a = await createPile(cookie, 'A')
    const b = await createPile(cookie, 'B')
    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [a],
    })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      pileIds: [b],
    })

    expect(res.status).toBe(200)
    expect((await json<{ pileIds: number[] }>(res)).pileIds).toEqual([b])
  })

  it('drops every source pile, falling back to the whole library', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'A')
    const inPile = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })
    await post(cookie, `/api/piles/${pile}/entries`, { entryId: inPile })

    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [pile],
    })
    expect(await titlesIn(cookie, widget.id)).toEqual(['Severance'])

    await patch(cookie, `/api/home-widgets/${widget.id}`, { pileIds: [] })

    expect((await titlesIn(cookie, widget.id)).sort()).toEqual([
      'Arrival',
      'Severance',
    ])
  })

  it('replaces the filter rather than merging it', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      filter: { status: ['watching'], mediaType: ['tv'] },
    })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      filter: { status: ['completed'] },
    })

    expect(await json(res)).toMatchObject({
      filter: { status: ['completed'] },
    })
  })

  it('422s on a pile owned by someone else, changing nothing', async () => {
    const cookie = await signUp('fernando')
    const mine = await createPile(cookie, 'A')
    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [mine],
    })
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherPile = db
      .insert(piles)
      .values({ userId: other.id, name: 'Anime do Ano' })
      .returning({ id: piles.id })
      .get()

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      pileIds: [otherPile.id],
    })

    expect(res.status).toBe(422)
    expect(pileIdsOf(widget.id)).toEqual([mine])
  })

  it('leaves the layout alone when only the filter changes', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      x: 3,
      y: 2,
      w: 7,
      h: 6,
    })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      filter: { status: ['watching'] },
    })

    // `.partial()` não desfaz `.default()`: sem schemas separados pra create e
    // patch, isto grava w:4/h:4 por cima e mexer no filtro apaga o tamanho
    expect(await json(res)).toMatchObject({ x: 3, y: 2, w: 7, h: 6 })
  })

  it('leaves the filter alone when only the layout changes', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      filter: { status: ['watching'] },
      itemCount: 5,
    })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, { w: 9 })

    expect(await json(res)).toMatchObject({
      filter: { status: ['watching'] },
      itemCount: 5,
      w: 9,
    })
  })

  it('leaves the source piles alone when only the filter changes', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'A')
    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [pile],
    })

    await patch(cookie, `/api/home-widgets/${widget.id}`, {
      filter: { status: ['watching'] },
    })

    expect(pileIdsOf(widget.id)).toEqual([pile])
  })

  it('404s on an unknown widget', async () => {
    const cookie = await signUp('fernando')

    const res = await patch(cookie, '/api/home-widgets/999', { type: 'grid' })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/home-widgets/layout', () => {
  it('saves every widget position in one request', async () => {
    const cookie = await signUp('fernando')
    const a = await createWidget(cookie, { type: 'list' })
    const b = await createWidget(cookie, { type: 'grid' })

    const res = await patch(cookie, '/api/home-widgets/layout', {
      widgets: [
        { id: a.id, x: 0, y: 0, w: 8, h: 6 },
        { id: b.id, x: 8, y: 0, w: 4, h: 6 },
      ],
    })

    expect(res.status).toBe(200)
    const saved = await json<{ id: number; x: number; w: number }[]>(res)
    expect(saved.find(({ id }) => id === a.id)).toMatchObject({ x: 0, w: 8 })
    expect(saved.find(({ id }) => id === b.id)).toMatchObject({ x: 8, w: 4 })
  })

  it('refuses the whole batch when one widget is not the user’s', async () => {
    const cookie = await signUp('fernando')
    const mine = await createWidget(cookie, { type: 'list' })
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherWidget = db
      .insert(homeWidgets)
      .values({ userId: other.id, type: 'list' })
      .returning({ id: homeWidgets.id })
      .get()

    const res = await patch(cookie, '/api/home-widgets/layout', {
      widgets: [
        { id: mine.id, x: 5, y: 5, w: 5, h: 5 },
        { id: otherWidget.id, x: 0, y: 0, w: 1, h: 1 },
      ],
    })

    expect(res.status).toBe(404)
    const untouched = db
      .select()
      .from(homeWidgets)
      .all()
      .find(({ id }) => id === mine.id)
    expect(untouched).toMatchObject({ x: 0, w: 4 })
  })

  it('is not swallowed by the /{id} route', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, { type: 'list' })

    const res = await patch(cookie, '/api/home-widgets/layout', {
      widgets: [{ id: widget.id, x: 1, y: 2, w: 3, h: 4 }],
    })

    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/home-widgets/{id}', () => {
  it('removes the widget and its pile links, leaving the piles alone', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'A')
    const widget = await createWidget(cookie, {
      type: 'list',
      pileIds: [pile],
    })

    const res = await app.request(`/api/home-widgets/${widget.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(204)
    expect(db.select().from(widgetPiles).all()).toHaveLength(0)
    expect(db.select().from(piles).all()).toHaveLength(1)
  })

  it('404s on a widget owned by someone else', async () => {
    const cookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherWidget = db
      .insert(homeWidgets)
      .values({ userId: other.id, type: 'list' })
      .returning({ id: homeWidgets.id })
      .get()

    const res = await app.request(`/api/home-widgets/${otherWidget.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
    expect(db.select().from(homeWidgets).all()).toHaveLength(1)
  })
})

describe('GET /api/home-widgets', () => {
  it('lists only the current user’s layout', async () => {
    const cookie = await signUp('fernando')
    await createWidget(cookie, { type: 'list' })
    await createWidget(cookie, { type: 'stats' })

    const res = await app.request('/api/home-widgets', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await json<unknown[]>(res)).toHaveLength(2)
  })

  it('starts empty on a fresh install', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/home-widgets', {
      headers: { Cookie: cookie },
    })

    expect(await json(res)).toEqual([])
  })
})

describe('PATCH /api/home-widgets/{id}/entries/{entryId}', () => {
  /** Três obras, sem ordem manual: a leitura cai em `created_at` desc, então a
   * ordem visível é o inverso da criação. */
  async function threeEntries(cookie: string) {
    const a = await createEntry(cookie, { mediaType: 'tv', title: 'a' })
    const b = await createEntry(cookie, { mediaType: 'tv', title: 'b' })
    const c = await createEntry(cookie, { mediaType: 'tv', title: 'c' })
    return { a, b, c }
  }

  function move(
    cookie: string,
    widgetId: number,
    entryId: number,
    after: number | null,
  ) {
    return patch(cookie, `/api/home-widgets/${widgetId}/entries/${entryId}`, {
      after,
    })
  }

  it('moves an entry to where it was dropped, not to the top', async () => {
    const cookie = await signUp('fernando')
    const { a, c } = await threeEntries(cookie)
    const widget = await createWidget(cookie, { type: 'list' })

    // visível: c, b, a — manda `a` pra logo atrás de `c`, ou seja, o meio
    const res = await move(cookie, widget.id, a, c)

    expect(res.status).toBe(200)
    expect(await titlesIn(cookie, widget.id)).toEqual(['c', 'a', 'b'])
  })

  /**
   * O teste que tranca a decisão de 29/08/2026. `orderForWidget` põe todo item
   * posicionado à mão antes de todo item sem posição — então, sem congelar a
   * ordem visível inteira, mover `a` pro meio o jogaria pro TOPO.
   */
  it('freezes the whole visible order on the first drag', async () => {
    const cookie = await signUp('fernando')
    const { a, c } = await threeEntries(cookie)
    const widget = await createWidget(cookie, { type: 'list' })

    await move(cookie, widget.id, a, c)

    const gravadas = db
      .select({ entryId: widgetEntryOrder.entryId })
      .from(widgetEntryOrder)
      .where(eq(widgetEntryOrder.widgetId, widget.id))
      .all()

    // as três, não só a arrastada
    expect(gravadas).toHaveLength(3)
  })

  it('moves to the top with a null anchor', async () => {
    const cookie = await signUp('fernando')
    const { a } = await threeEntries(cookie)
    const widget = await createWidget(cookie, { type: 'list' })

    await move(cookie, widget.id, a, null)

    expect(await titlesIn(cookie, widget.id)).toEqual(['a', 'c', 'b'])
  })

  it('survives repeated moves without colliding positions', async () => {
    const cookie = await signUp('fernando')
    const { a, b, c } = await threeEntries(cookie)
    const widget = await createWidget(cookie, { type: 'list' })

    await move(cookie, widget.id, a, c)
    await move(cookie, widget.id, b, null)
    await move(cookie, widget.id, c, b)

    const order = await titlesIn(cookie, widget.id)
    expect(new Set(order).size).toBe(3)
    expect(order).toEqual(['b', 'c', 'a'])
  })

  it('422s when an entry is asked to sit behind itself', async () => {
    const cookie = await signUp('fernando')
    const { a } = await threeEntries(cookie)
    const widget = await createWidget(cookie, { type: 'list' })

    const res = await move(cookie, widget.id, a, a)

    expect(res.status).toBe(422)
  })

  it('404s on an entry the widget does not resolve', async () => {
    const cookie = await signUp('fernando')
    const { a } = await threeEntries(cookie)
    // widget restrito a filmes; as obras do helper são séries
    const widget = await createWidget(cookie, {
      type: 'list',
      filter: { mediaType: ['movie'] },
    })

    const res = await move(cookie, widget.id, a, null)

    expect(res.status).toBe(404)
  })

  it('401s without a session', async () => {
    const res = await app.request('/api/home-widgets/1/entries/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ after: null }),
    })

    expect(res.status).toBe(401)
  })
})

describe('widget title', () => {
  it('starts null, meaning "use the derived label"', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, { type: 'list' })

    const res = await app.request(`/api/home-widgets`, {
      headers: { Cookie: cookie },
    })
    const [first] = await json<{ title: string | null }[]>(res)

    expect(first?.title).toBeNull()
    expect(widget).toHaveProperty('title', null)
  })

  it('accepts a custom name on create and on patch', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      title: 'Tonight',
    })
    expect(widget).toHaveProperty('title', 'Tonight')

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      title: 'This weekend',
    })
    expect(await json<{ title: string }>(res)).toHaveProperty(
      'title',
      'This weekend',
    )
  })

  /** Espaço em branco não é nome: precisa voltar pro rótulo derivado, e não
   * deixar o cabeçalho vazio. */
  it.each([['   '], ['']])('normalises %j to null', async (entrada) => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, { type: 'list', title: 'x' })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      title: entrada,
    })

    expect(await json<{ title: string | null }>(res)).toHaveProperty(
      'title',
      null,
    )
  })

  it('trims the name it stores', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      title: '  Tonight  ',
    })

    expect(widget).toHaveProperty('title', 'Tonight')
  })

  /**
   * A armadilha que o `server/CLAUDE.md` registra: `.partial()` não desfaz
   * `.default()`. Um PATCH que só manda `title` não pode encostar no layout.
   */
  it('does not touch the layout when only the title changes', async () => {
    const cookie = await signUp('fernando')
    const widget = await createWidget(cookie, {
      type: 'list',
      x: 2,
      y: 3,
      w: 5,
      h: 7,
    })

    const res = await patch(cookie, `/api/home-widgets/${widget.id}`, {
      title: 'Tonight',
    })
    const after = await json<{ x: number; y: number; w: number; h: number }>(
      res,
    )

    expect(after).toMatchObject({ x: 2, y: 3, w: 5, h: 7 })
  })

  it('rejects a name longer than 60 characters', async () => {
    const cookie = await signUp('fernando')
    const res = await post(cookie, '/api/home-widgets', {
      type: 'list',
      title: 'a'.repeat(61),
    })

    // 400 e não 422: falha de SCHEMA é barrada pelo validador do
    // `zod-openapi`, antes do handler. O 422 desta feature é para corpo
    // válido que o domínio recusa — pile de outro usuário, por exemplo.
    expect(res.status).toBe(400)
  })
})

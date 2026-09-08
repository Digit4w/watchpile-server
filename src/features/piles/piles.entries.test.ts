import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
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

async function signUp(username: string): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function createPile(cookie: string, name: string): Promise<number> {
  const res = await app.request('/api/piles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name }),
  })
  return (await json<{ id: number }>(res)).id
}

async function createEntry(cookie: string, title: string): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ mediaType: 'tv', title }),
  })
  return (await json<{ id: number }>(res)).id
}

function add(cookie: string, pileId: number, entryId: number) {
  return app.request(`/api/piles/${pileId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ entryId }),
  })
}

function move(
  cookie: string,
  pileId: number,
  entryId: number,
  after: number | null,
) {
  return app.request(`/api/piles/${pileId}/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ after }),
  })
}

async function titlesIn(cookie: string, pileId: number): Promise<string[]> {
  const res = await app.request(`/api/piles/${pileId}/entries`, {
    headers: { Cookie: cookie },
  })
  const body = await json<{ title: string }[]>(res)
  return body.map(({ title }) => title)
}

/**
 * Recua o `updated_at` da pilha pra um ponto claramente no passado.
 *
 * O carimbo tem resolução de SEGUNDO, então duas escritas no mesmo segundo
 * ficam iguais e o teste não veria diferença nenhuma. Envelhecer a linha
 * responde a mesma pergunta que dormir 1,1s responderia, e o teste continua
 * instantâneo — o que importa é o carimbo ter andado, não quanto.
 */
function age(pileId: number): Date {
  const past = new Date(Date.now() - 60_000)
  db.update(piles).set({ updatedAt: past }).where(eq(piles.id, pileId)).run()
  return updatedAt(pileId) as Date
}

function updatedAt(pileId: number): Date | undefined {
  return db.select().from(piles).where(eq(piles.id, pileId)).get()?.updatedAt
}

beforeEach(() => {
  db.delete(pileEntries).run()
  db.delete(entries).run()
  db.delete(piles).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('POST /api/piles/{id}/entries', () => {
  it('appends entries to the end, in insertion order', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')

    for (const title of ['Severance', 'Andor', 'Shogun']) {
      const res = await add(cookie, pile, await createEntry(cookie, title))
      expect(res.status).toBe(201)
    }

    expect(await titlesIn(cookie, pile)).toEqual([
      'Severance',
      'Andor',
      'Shogun',
    ])
  })

  it('never exposes the fractional position', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    await add(cookie, pile, await createEntry(cookie, 'Severance'))

    const res = await app.request(`/api/piles/${pile}/entries`, {
      headers: { Cookie: cookie },
    })
    const [entry] = await json<Record<string, unknown>[]>(res)

    expect(entry).not.toHaveProperty('position')
    expect(entry).not.toHaveProperty('userId')
  })

  /**
   * A ordem padrão de `/piles` é "Recently updated", e conteúdo é o que uma
   * pilha tem. Sem isto ela receberia obra sem nunca subir na lista — o mesmo
   * argumento que o auto-remove já escrevia pro lado de quem sai, e que ficava
   * furado justamente no caminho mais usado.
   */
  it('bumps updated_at on the pile that received, and only on it', async () => {
    const cookie = await signUp('fernando')
    const recebeu = await createPile(cookie, 'Watching')
    const naoRecebeu = await createPile(cookie, 'Someday')

    const recebeuAntes = age(recebeu)
    const naoRecebeuAntes = age(naoRecebeu)

    await add(cookie, recebeu, await createEntry(cookie, 'Severance'))

    expect(updatedAt(recebeu)?.getTime()).toBeGreaterThan(
      recebeuAntes.getTime(),
    )
    expect(updatedAt(naoRecebeu)).toEqual(naoRecebeuAntes)
  })

  it('409s on an entry already in the pile', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const entry = await createEntry(cookie, 'Severance')

    expect((await add(cookie, pile, entry)).status).toBe(201)
    expect((await add(cookie, pile, entry)).status).toBe(409)
  })

  it('404s on a pile owned by someone else', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, 'Severance')
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

    expect((await add(cookie, otherPile.id, entry)).status).toBe(404)
  })

  it('404s on an entry owned by someone else', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const otherEntry = db
      .insert(entries)
      .values({ userId: other.id, mediaType: 'manga', title: 'Vinland Saga' })
      .returning({ id: entries.id })
      .get()

    expect((await add(cookie, pile, otherEntry.id)).status).toBe(404)
  })

  it('rejects without a session', async () => {
    const res = await app.request('/api/piles/1/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: 1 }),
    })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/piles/{id}/entries/{entryId}', () => {
  async function pileOfThree(cookie: string) {
    const pile = await createPile(cookie, 'Watching')
    const ids: Record<string, number> = {}
    for (const title of ['Severance', 'Andor', 'Shogun']) {
      ids[title] = await createEntry(cookie, title)
      await add(cookie, pile, ids[title] as number)
    }
    return { pile, ids }
  }

  it('moves an entry to the top with a null anchor', async () => {
    const cookie = await signUp('fernando')
    const { pile, ids } = await pileOfThree(cookie)

    const res = await move(cookie, pile, ids.Shogun as number, null)

    expect(res.status).toBe(200)
    expect((await json<{ title: string }[]>(res)).map((e) => e.title)).toEqual([
      'Shogun',
      'Severance',
      'Andor',
    ])
  })

  it('moves an entry behind another one', async () => {
    const cookie = await signUp('fernando')
    const { pile, ids } = await pileOfThree(cookie)

    await move(cookie, pile, ids.Shogun as number, ids.Severance as number)

    expect(await titlesIn(cookie, pile)).toEqual([
      'Severance',
      'Shogun',
      'Andor',
    ])
  })

  it('moves an entry to the end', async () => {
    const cookie = await signUp('fernando')
    const { pile, ids } = await pileOfThree(cookie)

    await move(cookie, pile, ids.Severance as number, ids.Shogun as number)

    expect(await titlesIn(cookie, pile)).toEqual([
      'Andor',
      'Shogun',
      'Severance',
    ])
  })

  it('survives repeated moves into the same gap', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const first = await createEntry(cookie, 'first')
    const last = await createEntry(cookie, 'last')
    await add(cookie, pile, first)
    await add(cookie, pile, last)

    // cada filler entra logo antes de `last`, então o vão bisetado converge
    // PRA CIMA — perto de 1 o double tem ~52 casas, e o rebalanceamento do
    // handler é obrigado a entrar antes das 80 voltas (brief, 3.14)
    let anchor = first
    const order: string[] = []
    for (let i = 0; i < 80; i++) {
      const id = await createEntry(cookie, `filler-${i}`)
      await add(cookie, pile, id)
      const res = await move(cookie, pile, id, anchor)
      expect(res.status).toBe(200)
      anchor = id
      order.push(`filler-${i}`)
    }

    expect(await titlesIn(cookie, pile)).toEqual(['first', ...order, 'last'])

    const positions = db
      .select({ position: pileEntries.position })
      .from(pileEntries)
      .where(eq(pileEntries.pileId, pile))
      .all()
      .map(({ position }) => position)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('422s when the anchor is the entry itself', async () => {
    const cookie = await signUp('fernando')
    const { pile, ids } = await pileOfThree(cookie)

    const res = await move(
      cookie,
      pile,
      ids.Andor as number,
      ids.Andor as number,
    )
    expect(res.status).toBe(422)
  })

  it('422s when the anchor is outside the pile', async () => {
    const cookie = await signUp('fernando')
    const { pile, ids } = await pileOfThree(cookie)
    const loose = await createEntry(cookie, 'Arrival')

    const res = await move(cookie, pile, ids.Andor as number, loose)
    expect(res.status).toBe(422)
  })

  it('404s on an entry that is not in the pile', async () => {
    const cookie = await signUp('fernando')
    const { pile } = await pileOfThree(cookie)
    const loose = await createEntry(cookie, 'Arrival')

    const res = await move(cookie, pile, loose, null)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/piles/{id}/entries/{entryId}', () => {
  it('removes the entry from the pile without deleting it', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, pile, entry)

    const res = await app.request(`/api/piles/${pile}/entries/${entry}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(204)
    expect(await titlesIn(cookie, pile)).toEqual([])

    const still = await app.request(`/api/entries/${entry}`, {
      headers: { Cookie: cookie },
    })
    expect(still.status).toBe(200)
  })

  it('bumps updated_at, and a refused removal does not', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, pile, entry)

    const remove = (id: number) =>
      app.request(`/api/piles/${pile}/entries/${id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })

    // A recusa vem primeiro: 404 não é mudança, e carimbar por ela deixaria a
    // pilha subir na lista por um pedido que não a tocou.
    const refusedBefore = age(pile)
    expect((await remove(999)).status).toBe(404)
    expect(updatedAt(pile)).toEqual(refusedBefore)

    const antes = age(pile)
    expect((await remove(entry)).status).toBe(204)
    expect(updatedAt(pile)?.getTime()).toBeGreaterThan(antes.getTime())
  })

  it('404s when the entry is not in the pile', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')

    const res = await app.request(`/api/piles/${pile}/entries/999`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/piles/{id}/entries', () => {
  it('drops the membership when the entry is deleted', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Watching')
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, pile, entry)

    await app.request(`/api/entries/${entry}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(await titlesIn(cookie, pile)).toEqual([])
  })

  it('404s on a pile owned by someone else', async () => {
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

    const res = await app.request(`/api/piles/${otherPile.id}/entries`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })
})

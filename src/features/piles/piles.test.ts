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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

async function createPile(cookie: string, name: string): Promise<number> {
  const res = await app.request('/api/piles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as { id: number }).id
}

async function createEntry(cookie: string, title: string): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ mediaType: 'tv', title }),
  })
  return ((await res.json()) as { id: number }).id
}

async function addToPile(cookie: string, pileId: number, entryId: number) {
  await app.request(`/api/piles/${pileId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ entryId }),
  })
}

type ListedPile = {
  id: number
  name: string
  description: string | null
  entryCount: number
  preview: { id: number; title: string }[]
}

async function listPiles(cookie: string, query = ''): Promise<ListedPile[]> {
  const res = await app.request(`/api/piles${query}`, {
    headers: { Cookie: cookie },
  })
  return (await res.json()) as ListedPile[]
}

beforeEach(() => {
  db.delete(piles).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('POST /api/piles', () => {
  it('creates a pile owned by the current user', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Favoritos' }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: expect.any(Number),
      name: 'Favoritos',
      description: null,
      // Recém-criada tem zero obra, e ainda assim traz os dois campos
      // derivados: a forma da resposta é uma só em toda rota de pilha, pra que
      // o cliente possa pôr esta pilha direto no cache da lista.
      entryCount: 0,
      preview: [],
      // Os três de customização nascem no estado neutro (brief, 3.17): sem
      // capa, sem regra de saída, não fixada. `hasCover` é booleano e não o
      // BLOB — a capa tem endereço próprio, e mandá-la em base64 aqui
      // multiplicaria a listagem por mil pra desenhar um quadrado de 150px.
      hasCover: false,
      removeWhenCompleted: false,
      pinnedAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('accepts a description, which the create popover does not send', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Favoritos', description: '  Os bons  ' }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()) as { description: string }).toMatchObject({
      description: 'Os bons',
    })
  })

  it('rejects without a session', async () => {
    const res = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Favoritos' }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects an empty name', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/piles', () => {
  it('only lists piles owned by the current user', async () => {
    const fernandoCookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()

    await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: fernandoCookie },
      body: JSON.stringify({ name: 'Favoritos' }),
    })
    db.insert(piles).values({ userId: other.id, name: 'Anime do Ano' }).run()

    const res = await app.request('/api/piles', {
      headers: { Cookie: fernandoCookie },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }[]
    expect(body).toHaveLength(1)
    expect(body[0]?.name).toBe('Favoritos')
  })
})

describe('GET /api/piles/:id', () => {
  it('returns 404 for a pile owned by someone else', async () => {
    const fernandoCookie = await signUp('fernando')
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

    const res = await app.request(`/api/piles/${otherPile.id}`, {
      headers: { Cookie: fernandoCookie },
    })

    expect(res.status).toBe(404)
  })

  it('returns 404 for a pile that does not exist', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/piles/999', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/piles/:id', () => {
  it('renames a pile', async () => {
    const cookie = await signUp('fernando')

    const created = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Favoritos' }),
    })
    const { id } = (await created.json()) as { id: number }

    const res = await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Continue Watching' }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()) as { name: string }).toMatchObject({
      name: 'Continue Watching',
    })
  })
})

describe('DELETE /api/piles/:id', () => {
  it('deletes a pile', async () => {
    const cookie = await signUp('fernando')

    const created = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Favoritos' }),
    })
    const { id } = (await created.json()) as { id: number }

    const res = await app.request(`/api/piles/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(204)

    const getRes = await app.request(`/api/piles/${id}`, {
      headers: { Cookie: cookie },
    })
    expect(getRes.status).toBe(404)
  })
})

describe('GET /api/piles — contagem e prévia do mosaico', () => {
  it('counts the entries in each pile and previews the first four', async () => {
    const cookie = await signUp('fernando')
    const pileId = await createPile(cookie, 'Currently watching')

    // Cinco obras numa pilha que mostra quatro: o corte tem que acontecer, e
    // tem que respeitar a ordem manual da pilha, não a de criação da obra.
    for (const title of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
      await addToPile(cookie, pileId, await createEntry(cookie, title))
    }

    const [pile] = await listPiles(cookie)

    expect(pile?.entryCount).toBe(5)
    expect(pile?.preview.map(({ title }) => title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ])
  })

  it('keeps the empty pile in the list, with zero and no preview', async () => {
    const cookie = await signUp('fernando')
    await createPile(cookie, 'Empty pile')

    const [pile] = await listPiles(cookie)

    // O `LEFT JOIN` é o que segura isto: com `INNER`, a pilha recém-criada
    // sumiria da própria tela que serve pra enchê-la. E `count(entry_id)` em
    // vez de `count(*)` é o que a faz valer zero, não um.
    expect(pile?.name).toBe('Empty pile')
    expect(pile?.entryCount).toBe(0)
    expect(pile?.preview).toEqual([])
  })

  it("does not leak another user's entries into the count", async () => {
    const cookie = await signUp('fernando')
    const mine = await createPile(cookie, 'Mine')
    await addToPile(cookie, mine, await createEntry(cookie, 'Alpha'))

    // O segundo usuário nasce direto no banco: `/api/setup/account` é o wizard de
    // PRIMEIRO uso e só responde com o banco sem usuário nenhum.
    const stranger = db
      .insert(users)
      .values({ username: 'stranger', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const strangerPile = db
      .insert(piles)
      .values({ userId: stranger.id, name: 'Theirs' })
      .returning({ id: piles.id })
      .get()
    const strangerEntry = db
      .insert(entries)
      .values({ userId: stranger.id, mediaType: 'tv', title: 'Bravo' })
      .returning({ id: entries.id })
      .get()
    db.insert(pileEntries)
      .values({
        pileId: strangerPile.id,
        entryId: strangerEntry.id,
        position: 1,
      })
      .run()

    const listed = await listPiles(cookie)

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'Mine', entryCount: 1 })
  })
})

describe('GET /api/piles — busca e ordenação', () => {
  it('finds piles by a substring of the name, case-insensitively', async () => {
    const cookie = await signUp('fernando')
    await createPile(cookie, 'Comfort shows')
    await createPile(cookie, 'Anime films')

    const found = await listPiles(cookie, '?q=SHOW')

    expect(found.map(({ name }) => name)).toEqual(['Comfort shows'])
  })

  it('treats the LIKE wildcards as literal text', async () => {
    const cookie = await signUp('fernando')
    await createPile(cookie, 'Comfort shows')
    await createPile(cookie, '100% completion')

    // Sem o `ESCAPE`, `%` casaria com tudo e a busca devolveria as duas.
    const found = await listPiles(cookie, '?q=100%25')

    expect(found.map(({ name }) => name)).toEqual(['100% completion'])
  })

  it('sorts by name, ignoring case', async () => {
    const cookie = await signUp('fernando')
    await createPile(cookie, 'zelda')
    await createPile(cookie, 'Anime films')

    const sorted = await listPiles(cookie, '?sort=name')

    expect(sorted.map(({ name }) => name)).toEqual(['Anime films', 'zelda'])
  })

  it('sorts by size, biggest pile first', async () => {
    const cookie = await signUp('fernando')
    const small = await createPile(cookie, 'Small')
    const big = await createPile(cookie, 'Big')
    await addToPile(cookie, small, await createEntry(cookie, 'Alpha'))
    await addToPile(cookie, big, await createEntry(cookie, 'Bravo'))
    await addToPile(cookie, big, await createEntry(cookie, 'Charlie'))

    const sorted = await listPiles(cookie, '?sort=size')

    expect(sorted.map(({ name }) => name)).toEqual(['Big', 'Small'])
  })

  it('rejects a sort key it does not know', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/piles?sort=rating', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/piles/:id — parcial de verdade', () => {
  it('changes the description without touching the name', async () => {
    const cookie = await signUp('fernando')
    const id = await createPile(cookie, 'Favoritos')

    const res = await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Os que eu revejo' }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()) as ListedPile).toMatchObject({
      name: 'Favoritos',
      description: 'Os que eu revejo',
    })
  })

  it('keeps the description when only the name is patched', async () => {
    const cookie = await signUp('fernando')
    const id = await createPile(cookie, 'Favoritos')
    await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Os que eu revejo' }),
    })

    const res = await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Continue Watching' }),
    })

    // O sintoma que este teste existe pra pegar: mexer num campo apaga stranger
    // que ninguém tocou (server/CLAUDE.md, "`.partial()` não desfaz
    // `.default()`").
    expect((await res.json()) as ListedPile).toMatchObject({
      name: 'Continue Watching',
      description: 'Os que eu revejo',
    })
  })

  it('clears the description when the sheet sends an empty field', async () => {
    const cookie = await signUp('fernando')
    const id = await createPile(cookie, 'Favoritos')
    await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Os que eu revejo' }),
    })

    const res = await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: '   ' }),
    })

    // Vazia e ausente são a mesma coisa: sem isto a lista desenharia uma linha
    // de descrição em branco onde não deveria haver linha nenhuma.
    expect((await res.json()) as ListedPile).toMatchObject({
      description: null,
    })
  })

  it('leaves updated_at alone when the body changes nothing', async () => {
    const cookie = await signUp('fernando')
    const id = await createPile(cookie, 'Favoritos')
    const before = await app.request(`/api/piles/${id}`, {
      headers: { Cookie: cookie },
    })
    const { updatedAt } = (await before.json()) as { updatedAt: string }

    const res = await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    })

    // A ordem padrão da tela é "Recently updated": um corpo vazio empurrando a
    // pilha pro topo seria a lista se reordenando por um pedido que não pediu
    // mudança nenhuma.
    expect(res.status).toBe(200)
    expect((await res.json()) as { updatedAt: string }).toMatchObject({
      updatedAt,
    })
  })
})

describe('DELETE /api/piles/:id — a obra sobrevive', () => {
  it('removes the pile without removing the entries in it', async () => {
    const cookie = await signUp('fernando')
    const id = await createPile(cookie, 'Favoritos')
    const entryId = await createEntry(cookie, 'Frieren')
    await addToPile(cookie, id, entryId)

    await app.request(`/api/piles/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    // É o modelo: a pilha é agrupamento opcional e a obra vive fora dela.
    // A confirmação da tela promete isso em voz alta, e aqui é onde a promessa
    // é verificada.
    const res = await app.request(`/api/entries/${entryId}`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
  })
})

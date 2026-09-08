import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { piles } from '../../db/schema/piles.js'
import { providers } from '../../db/schema/providers.js'
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

async function signIn(username: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

async function createEntry(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: number }> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { id: number }
}

async function createPile(
  cookie: string,
  name: string,
  removeWhenCompleted = false,
): Promise<number> {
  const res = await app.request('/api/piles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name }),
  })
  const { id } = (await res.json()) as { id: number }

  if (removeWhenCompleted) {
    await app.request(`/api/piles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ removeWhenCompleted: true }),
    })
  }

  return id
}

async function titlesIn(cookie: string, pileId: number): Promise<string[]> {
  const res = await app.request(`/api/piles/${pileId}/entries`, {
    headers: { Cookie: cookie },
  })
  return ((await res.json()) as { title: string }[]).map(({ title }) => title)
}

beforeEach(() => {
  db.delete(eventLog).run()
  // `pile_entries` sai por cascade das duas pontas
  db.delete(piles).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('POST /api/entries', () => {
  it('creates an entry owned by the current user', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'tv', title: 'Severance' }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: expect.any(Number),
      mediaType: 'tv',
      title: 'Severance',
      status: 'planned',
      rating: null,
      notes: null,
      progress: 0,
      total: null,
      // Digitada à mão não tem de onde tirar arte, e o nulo é o que faz a tela
      // desenhar o ladrilho em vez de pedir uma imagem que não existe.
      art: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('rejects without a session', async () => {
    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'tv', title: 'Severance' }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects an unknown media type', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'podcast', title: 'Severance' }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects an empty title', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mediaType: 'tv', title: '' }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects a rating with more than one decimal place', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Arrival',
        rating: 8.75,
      }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects a rating above the 0-10 scale', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Arrival',
        rating: 11,
      }),
    })

    expect(res.status).toBe(400)
  })

  it('ignores progress sent in the body', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'tv',
        title: 'Severance',
        progress: 12,
      }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ progress: 0 })
  })
})

/**
 * Adicionar da busca (brief, 3.10). É UM passo pra quem usa e DOIS no schema —
 * e os testes daqui são sobre a segunda linha existir, e existir junto.
 */
describe('POST /api/entries com procedência', () => {
  it('cria a obra E o vínculo, na mesma transação', async () => {
    const cookie = await signUp('alice')

    const created = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId: '550' },
    })

    const links = db
      .select()
      .from(externalIds)
      .where(eq(externalIds.entryId, created.id))
      .all()
    expect(links).toHaveLength(1)
    expect(links[0]?.externalId).toBe('550')
  })

  it('sem procedência continua criando só a obra', async () => {
    const cookie = await signUp('alice')

    const created = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Digitado à mão',
    })

    expect(
      db
        .select()
        .from(externalIds)
        .where(eq(externalIds.entryId, created.id))
        .all(),
    ).toEqual([])
  })

  it('a mesma obra duas vezes é 409, e devolve o id da que já existe', async () => {
    const cookie = await signUp('alice')
    const first = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId: '550' },
    })

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Fight Club',
        source: { provider: 'tmdb', externalId: '550' },
      }),
    })

    expect(res.status).toBe(409)
    // O id volta porque a tela precisa APONTAR pra obra, não só dizer não.
    expect(await res.json()).toMatchObject({ entryId: first.id })
  })

  it('a obra de OUTRO usuário não bloqueia a minha', async () => {
    // `external_ids` é dona por transitividade, e o único de banco é
    // `(obra, provedor)`: duas pessoas podem ter o mesmo filme. O segundo
    // usuário entra pelo banco porque `/setup/account` só serve pro primeiro.
    const cookie = await signUp('alice')
    const other = db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    const theirs = db
      .insert(entries)
      .values({ userId: other.id, mediaType: 'movie', title: 'Fight Club' })
      .returning()
      .get()
    db.insert(externalIds)
      .values({
        mediaType: 'movie',
        entryId: theirs.id,
        provider: 'tmdb',
        externalId: '550',
      })
      .run()

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Fight Club',
        source: { provider: 'tmdb', externalId: '550' },
      }),
    })

    expect(res.status).toBe(201)
  })

  it('provedor desconhecido é 400, e não deixa obra órfã pra trás', async () => {
    const cookie = await signUp('alice')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Fight Club',
        source: { provider: 'inexistente', externalId: '550' },
      }),
    })

    expect(res.status).toBe(400)
    // A recusa vem ANTES do insert: uma obra criada e um vínculo recusado
    // deixaria exatamente a obra sem procedência que a transação existe pra
    // impedir.
    expect(db.select().from(entries).all()).toEqual([])
  })
})

describe('POST /api/entries with piles', () => {
  it('appends the new title to the end of every chosen pile', async () => {
    const cookie = await signUp('alice')
    const first = await createPile(cookie, 'Sci-fi')
    const second = await createPile(cookie, 'Rewatch')
    const alreadyWas = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Arrival',
    })
    await app.request(`/api/piles/${first}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ entryId: alreadyWas.id }),
    })

    await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Dune',
      pileIds: [first, second],
    })

    // no fim, nunca no começo: a ordem manual é de quem já estava lá
    expect(await titlesIn(cookie, first)).toEqual(['Arrival', 'Dune'])
    expect(await titlesIn(cookie, second)).toEqual(['Dune'])
  })

  it('works on the hand-typed path, with no source', async () => {
    const cookie = await signUp('alice')
    const pile = await createPile(cookie, 'Backlog')

    await createEntry(cookie, {
      mediaType: 'book',
      title: 'Piranesi',
      pileIds: [pile],
    })

    expect(await titlesIn(cookie, pile)).toEqual(['Piranesi'])
  })

  it('takes the same pile twice as one membership', async () => {
    const cookie = await signUp('alice')
    const pile = await createPile(cookie, 'Sci-fi')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Dune',
        pileIds: [pile, pile],
      }),
    })

    expect(res.status).toBe(201)
    expect(await titlesIn(cookie, pile)).toEqual(['Dune'])
  })

  /**
   * O 400 vem ANTES da transação, então a obra não chega a existir: metade do
   * pedido cumprida seria pior que a recusa inteira, porque a tela não teria
   * como dizer qual metade passou.
   */
  it('400s on an unknown pile, and creates no title', async () => {
    const cookie = await signUp('alice')

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Dune',
        pileIds: [9999],
      }),
    })

    expect(res.status).toBe(400)
    expect(db.select().from(entries).all()).toEqual([])
  })

  it("refuses someone else's pile the same way, without saying it exists", async () => {
    // O segundo usuário entra pelo banco porque `/setup/account` só serve pro
    // primeiro — mesmo caminho do teste de obra de outro usuário, acima.
    const cookie = await signUp('alice')
    const other = db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    const theirs = db
      .insert(piles)
      .values({ userId: other.id, name: 'Sci-fi' })
      .returning()
      .get()

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Dune',
        pileIds: [theirs.id],
      }),
    })

    // A mesma mensagem que uma pilha inexistente recebe: separar as duas
    // deixaria descobrir o acervo alheio por tentativa.
    expect(res.status).toBe(400)
    expect((await res.json()) as { message: string }).toEqual({
      message: 'Unknown pile',
    })
    expect(db.select().from(entries).all()).toEqual([])
  })

  /**
   * Nascer concluída DENTRO de uma pilha que se esvazia sozinha não tira a
   * obra dela: quem pediu as duas coisas foi a mesma pessoa, no mesmo gesto, e
   * desfazer metade em silêncio seria ignorar a escolha mais recente. É a
   * mesma régua que o `PATCH` já segue — o gatilho do auto-remove é a ESCRITA
   * do status, e pôr numa pilha à mão é escolha explícita.
   */
  it('keeps a title created as completed inside an auto-clearing pile', async () => {
    const cookie = await signUp('alice')
    const queue = await createPile(cookie, 'Watch next', true)

    await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Dune',
      status: 'completed',
      pileIds: [queue],
    })

    expect(await titlesIn(cookie, queue)).toEqual(['Dune'])
  })
})

describe('GET /api/entries', () => {
  it('lists only entries owned by the current user', async () => {
    const owner = await signUp('fernando')
    await createEntry(owner, { mediaType: 'tv', title: 'Severance' })

    await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: owner },
    })

    const res = await app.request('/api/entries', { headers: { Cookie: '' } })
    expect(res.status).toBe(401)

    const back = await signIn('fernando')
    const mine = await app.request('/api/entries', {
      headers: { Cookie: back },
    })

    expect(mine.status).toBe(200)
    expect(await mine.json()).toHaveLength(1)
  })

  it('filters by media type and status', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      status: 'watching',
    })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    const byType = await app.request('/api/entries?mediaType=tv', {
      headers: { Cookie: cookie },
    })
    expect(await byType.json()).toMatchObject([{ title: 'Severance' }])

    const byStatus = await app.request('/api/entries?status=planned', {
      headers: { Cookie: cookie },
    })
    expect(await byStatus.json()).toMatchObject([{ title: 'Arrival' }])
  })

  it('rejects an unknown status filter', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries?status=paused', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(400)
  })

  it('searches the title by substring, ignoring case', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'anime', title: 'Attack on Titan' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    const res = await app.request('/api/entries?q=TITAN', {
      headers: { Cookie: cookie },
    })

    expect(await res.json()).toMatchObject([{ title: 'Attack on Titan' }])
  })

  it('treats the LIKE wildcards as literal characters', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'game', title: '100% Orange Juice' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    // Sem escape, '%' casaria com a biblioteca inteira
    const percent = await app.request('/api/entries?q=100%25', {
      headers: { Cookie: cookie },
    })
    expect(await percent.json()).toHaveLength(1)

    // e '_' com qualquer caractere na posição
    const underscore = await app.request('/api/entries?q=A_rival', {
      headers: { Cookie: cookie },
    })
    expect(await underscore.json()).toHaveLength(0)
  })

  it('treats a blank search as no search', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    const res = await app.request('/api/entries?q=%20%20', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toHaveLength(1)
  })

  it('sorts by title ignoring case', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'movie', title: 'Zodiac' })
    await createEntry(cookie, { mediaType: 'anime', title: 'attack on titan' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Arrival' })

    const res = await app.request('/api/entries?sort=title', {
      headers: { Cookie: cookie },
    })

    expect(await res.json()).toMatchObject([
      { title: 'Arrival' },
      { title: 'attack on titan' },
      { title: 'Zodiac' },
    ])
  })

  it('sorts by rating with unrated entries last', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'movie', title: 'Unrated' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Good', rating: 7 })
    await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Great',
      rating: 9.5,
    })

    const res = await app.request('/api/entries?sort=rating', {
      headers: { Cookie: cookie },
    })

    expect(await res.json()).toMatchObject([
      { title: 'Great' },
      { title: 'Good' },
      { title: 'Unrated' },
    ])
  })

  it('sorts by most recently added, newest first', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'movie', title: 'First' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Second' })

    const res = await app.request('/api/entries?sort=added', {
      headers: { Cookie: cookie },
    })

    // `created_at` tem resolução de segundo, então o desempate por `id` é o
    // que segura esta ordem — e é justamente o que se quer verificar
    expect(await res.json()).toMatchObject([
      { title: 'Second' },
      { title: 'First' },
    ])
  })

  it('rejects an unknown sort key', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries?sort=chronological', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/entries/{id}', () => {
  it('returns the entry', async () => {
    const cookie = await signUp('fernando')
    const created = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    const res = await app.request(`/api/entries/${created.id}`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ title: 'Severance' })
  })

  it('404s on an entry owned by someone else', async () => {
    const cookie = await signUp('fernando')
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

    const res = await app.request(`/api/entries/${otherEntry.id}`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })

  it('404s on an entry that does not exist', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries/999', {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/entries/{id}', () => {
  it('updates status, rating and notes', async () => {
    const cookie = await signUp('fernando')
    const created = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    const res = await app.request(`/api/entries/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        status: 'completed',
        rating: 9.5,
        notes: 'Second season stuck the landing',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'completed',
      rating: 9.5,
      notes: 'Second season stuck the landing',
    })
  })

  it('leaves progress untouched', async () => {
    const cookie = await signUp('fernando')
    const created = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    const res = await app.request(`/api/entries/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ progress: 12 }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ progress: 0 })
  })

  it('404s on an unknown entry', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Severance' }),
    })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/entries/{id}', () => {
  it('deletes the entry', async () => {
    const cookie = await signUp('fernando')
    const created = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    const res = await app.request(`/api/entries/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(204)

    const gone = await app.request(`/api/entries/${created.id}`, {
      headers: { Cookie: cookie },
    })
    expect(gone.status).toBe(404)
  })

  it('404s on an unknown entry', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries/999', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/entries', () => {
  it('recusa sem sessão', async () => {
    const res = await app.request('/api/entries', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('apaga a biblioteca inteira e devolve quantas saíram', async () => {
    const cookie = await signUp('fernando')
    await createEntry(cookie, { mediaType: 'tv', title: 'Severance' })
    await createEntry(cookie, { mediaType: 'movie', title: 'Perfect Blue' })

    const res = await app.request('/api/entries', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 2 })
    expect(
      await (
        await app.request('/api/entries', { headers: { Cookie: cookie } })
      ).json(),
    ).toEqual([])
  })

  it('devolve zero num acervo vazio, sem recusar', async () => {
    const cookie = await signUp('fernando')

    const res = await app.request('/api/entries', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 0 })
  })

  /**
   * O cascade é o que faz a rota levar mais do que o nome diz — e é ele que a
   * tela promete antes do clique. Aqui se prova que o progresso, o histórico e
   * o vínculo somem junto.
   */
  it('leva progresso, log e vínculo junto, por cascade', async () => {
    const cookie = await signUp('fernando')
    const created = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Perfect Blue',
      source: { provider: 'tmdb', externalId: '10494' },
    })
    await app.request(`/api/entries/${created.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ delta: 1 }),
    })

    expect(db.select().from(eventLog).all()).not.toHaveLength(0)
    expect(db.select().from(externalIds).all()).not.toHaveLength(0)

    await app.request('/api/entries', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(db.select().from(eventLog).all()).toHaveLength(0)
    expect(db.select().from(externalIds).all()).toHaveLength(0)
  })

  /**
   * **A PILHA fica, vazia.** Apagar as obras não apaga a coleção que as
   * continha — a régua de 31/08 (*tirar de um container não é apagar o
   * objeto*) valendo na direção contrária.
   */
  it('esvazia as pilhas sem apagá-las', async () => {
    const cookie = await signUp('fernando')
    const pileId = await createPile(cookie, 'Weekend')
    await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      pileIds: [pileId],
    })

    await app.request('/api/entries', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    const pile = await (
      await app.request(`/api/piles/${pileId}`, { headers: { Cookie: cookie } })
    ).json()
    expect(pile).toMatchObject({ id: pileId, name: 'Weekend' })
  })

  it('não toca na biblioteca de outra pessoa', async () => {
    const cookie = await signUp('fernando')
    db.insert(users)
      .values({ username: 'outra', passwordHash: 'x', isAdmin: false })
      .run()
    const outraId = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'outra'))
      .get()?.id as number
    db.insert(entries)
      .values({ userId: outraId, mediaType: 'movie', title: 'Segredo' })
      .run()
    await createEntry(cookie, { mediaType: 'tv', title: 'Severance' })

    const res = await app.request('/api/entries', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(await res.json()).toEqual({ deleted: 1 })
    expect(db.select().from(entries).all()).toHaveLength(1)
  })
})

describe('POST /api/entries/{id}/progress', () => {
  async function progress(
    cookie: string,
    id: number,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return app.request(`/api/entries/${id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    })
  }

  it('advances the counter and writes one line in the event log', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      total: 9,
    })

    const res = await progress(cookie, entry.id, { delta: 2 })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ progress: 2 })

    const logged = db
      .select()
      .from(eventLog)
      .where(eq(eventLog.entryId, entry.id))
      .all()
    expect(logged).toMatchObject([
      { type: 'progress_delta', delta: 2, origin: 'manual' },
    ])
  })

  it('corrects with a negative delta, leaving the earlier event alone', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Frieren',
    })

    await progress(cookie, entry.id, { delta: 3 })
    const res = await progress(cookie, entry.id, { delta: -1 })

    expect(await res.json()).toMatchObject({ progress: 2 })

    const logged = db
      .select()
      .from(eventLog)
      .where(eq(eventLog.entryId, entry.id))
      .all()
    expect(logged.map(({ delta }) => delta)).toEqual([3, -1])
  })

  it('accepts a retroactive occurredAt without touching createdAt', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Arrival',
      total: 1,
    })

    await progress(cookie, entry.id, {
      delta: 1,
      occurredAt: '2026-01-05T20:00:00.000Z',
    })

    const [logged] = db
      .select()
      .from(eventLog)
      .where(eq(eventLog.entryId, entry.id))
      .all()
    expect(logged?.occurredAt.toISOString()).toBe('2026-01-05T20:00:00.000Z')
    expect(logged?.createdAt.getUTCFullYear()).toBeGreaterThan(2025)
    expect(logged?.occurredAt).not.toEqual(logged?.createdAt)
  })

  it('422s below zero, writing nothing', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    const res = await progress(cookie, entry.id, { delta: -1 })

    expect(res.status).toBe(422)
    expect(db.select().from(eventLog).all()).toHaveLength(0)
  })

  it('422s past a known total, writing nothing', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      total: 9,
    })

    const res = await progress(cookie, entry.id, { delta: 10 })

    expect(res.status).toBe(422)
    expect(db.select().from(eventLog).all()).toHaveLength(0)
  })

  it('imposes no ceiling when the total is unknown', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'manga',
      title: 'Vinland Saga',
    })

    const res = await progress(cookie, entry.id, { delta: 210 })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ progress: 210 })
  })

  it('rejects a zero delta', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })

    expect((await progress(cookie, entry.id, { delta: 0 })).status).toBe(400)
  })

  it('404s on an entry owned by someone else', async () => {
    const cookie = await signUp('fernando')
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

    const res = await progress(cookie, otherEntry.id, { delta: 1 })

    expect(res.status).toBe(404)
    expect(db.select().from(eventLog).all()).toHaveLength(0)
  })

  it('rejects without a session', async () => {
    const res = await app.request('/api/entries/1/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: 1 }),
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/entries/{id}/piles', () => {
  async function createPile(cookie: string, name: string) {
    const res = await app.request('/api/piles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name }),
    })
    return (await res.json()) as { id: number; name: string }
  }

  async function addToPile(cookie: string, pileId: number, entryId: number) {
    return app.request(`/api/piles/${pileId}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ entryId }),
    })
  }

  it('lists the piles the entry belongs to, by name', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
    })
    const weekend = await createPile(cookie, 'Weekend queue')
    const watching = await createPile(cookie, 'Watching now')
    await createPile(cookie, 'Untouched')

    await addToPile(cookie, weekend.id, entry.id)
    await addToPile(cookie, watching.id, entry.id)

    const res = await app.request(`/api/entries/${entry.id}/piles`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as { name: string }[]

    expect(res.status).toBe(200)
    expect(body.map(({ name }) => name)).toEqual([
      'Watching now',
      'Weekend queue',
    ])
  })

  /**
   * Estar fora de pilha é normal no modelo (brief, 3.15) — a lista vazia é
   * resposta legítima, não 404.
   */
  it('returns an empty list for an entry in no pile', async () => {
    const cookie = await signUp('fernando')
    const entry = await createEntry(cookie, {
      mediaType: 'manga',
      title: 'Berserk',
    })

    const res = await app.request(`/api/entries/${entry.id}/piles`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("404s on another user's entry", async () => {
    // Segundo usuário entra pelo banco, não pelo wizard: `/api/setup/account` é a
    // rota de primeiro uso e só responde com o banco sem usuário nenhum.
    const cookie = await signUp('fernando')
    const other = db
      .insert(users)
      .values({ username: 'other', passwordHash: 'x', isAdmin: false })
      .returning({ id: users.id })
      .get()
    const ofSomeoneElse = db
      .insert(entries)
      .values({ userId: other.id, mediaType: 'movie', title: 'Dune' })
      .returning({ id: entries.id })
      .get()

    const res = await app.request(`/api/entries/${ofSomeoneElse.id}/piles`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })

  it('401s without a session', async () => {
    const res = await app.request('/api/entries/1/piles')

    expect(res.status).toBe(401)
  })
})

/**
 * O resumo do que o log sabe. **Só progresso entra**, e é honesto dizer: o
 * `event_log` tem tipos pra status, nota e notas, e nenhum é escrito hoje.
 */
describe('GET /api/entries/{id}/history', () => {
  it('resume o primeiro, o último e quantos foram', async () => {
    const cookie = await signUp('alice')
    const { id } = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Severance',
      total: 9,
    })

    for (const delta of [1, 2, 1]) {
      await app.request(`/api/entries/${id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ delta }),
      })
    }

    const res = await app.request(`/api/entries/${id}/history`, {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as {
      startedAt: string | null
      lastAt: string | null
      events: number
    }

    // TRÊS eventos, não quatro unidades: o resumo conta escritas, não progresso.
    expect(body.events).toBe(3)
    expect(body.startedAt).not.toBeNull()
    expect(body.lastAt).not.toBeNull()
  })

  it('obra sem nenhum evento responde vazio, não erro', async () => {
    const cookie = await signUp('alice')
    const { id } = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Arrival',
    })

    const res = await app.request(`/api/entries/${id}/history`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      startedAt: null,
      lastAt: null,
      events: 0,
    })
  })

  it("404s on someone else's title", async () => {
    const cookie = await signUp('alice')
    const other = db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    const theirs = db
      .insert(entries)
      .values({ userId: other.id, mediaType: 'movie', title: 'Dele' })
      .returning()
      .get()

    const res = await app.request(`/api/entries/${theirs.id}/history`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(404)
  })
})

describe('a obra que nasce com fonte aquece o cache de arte', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    db.update(providers).set({ credentialValues: {} }).run()
  })

  /**
   * O caminho mais usado dos dois: adicionar da busca. O que se afirma é o fio
   * — o handler dispara a busca da arte —, não o resultado dela, que
   * `art.warm.test.ts` já prova com o dublê inteiro.
   *
   * **E que a resposta não espera por ela:** o 201 sai antes, como sempre saiu.
   * É o que mantém de pé a decisão de que adicionar não depende da rede.
   */
  it('cria dispara a busca sem segurar o 201', async () => {
    db.update(providers)
      .set({ credentialValues: { api_key: 'chave-de-teste' } })
      .where(eq(providers.slug, 'tmdb'))
      .run()

    const cookie = await signUp('fernando')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const res = await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        mediaType: 'movie',
        title: 'Fight Club',
        source: { provider: 'tmdb', externalId: '550' },
      }),
    })

    expect(res.status).toBe(201)
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
  })
})

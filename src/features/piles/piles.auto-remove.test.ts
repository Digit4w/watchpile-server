import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
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

async function createPile(
  cookie: string,
  name: string,
  removeWhenCompleted = false,
): Promise<number> {
  const res = await app.request('/api/piles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name, removeWhenCompleted }),
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

function patchEntry(cookie: string, entryId: number, body: object) {
  return app.request(`/api/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

async function titlesIn(cookie: string, pileId: number): Promise<string[]> {
  const res = await app.request(`/api/piles/${pileId}/entries`, {
    headers: { Cookie: cookie },
  })
  return (await json<{ title: string }[]>(res)).map(({ title }) => title)
}

beforeEach(() => {
  db.delete(eventLog).run()
  db.delete(pileEntries).run()
  db.delete(entries).run()
  db.delete(piles).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('remove_when_completed', () => {
  it('drops the entry only from the piles that asked for it', async () => {
    const cookie = await signUp('fernando')
    const fila = await createPile(cookie, 'Watch next', true)
    const collection = await createPile(cookie, 'Favourites', false)
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, fila, entry)
    await add(cookie, collection, entry)

    await patchEntry(cookie, entry, { status: 'completed' })

    expect(await titlesIn(cookie, fila)).toEqual([])
    expect(await titlesIn(cookie, collection)).toEqual(['Severance'])
  })

  /**
   * A invariante mais cara do brief 3.17: a regra apaga ASSOCIAÇÃO, nunca a
   * obra. Se ela furar, o usuário perde progresso e histórico sem nenhum aviso
   * — e descobre semanas depois.
   */
  it('never touches the entry itself, only the membership', async () => {
    const cookie = await signUp('fernando')
    const fila = await createPile(cookie, 'Watch next', true)
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, fila, entry)
    await app.request(`/api/entries/${entry}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ delta: 5 }),
    })

    await patchEntry(cookie, entry, { status: 'completed' })

    const survivor = db
      .select()
      .from(entries)
      .where(eq(entries.id, entry))
      .get()
    expect(survivor).toMatchObject({ title: 'Severance', progress: 5 })
    expect(db.select().from(eventLog).all()).toHaveLength(1)
  })

  /**
   * Sair de uma pilha não é progresso (brief, 3.11). O log ganhou uma linha só
   * — a do `delta: 5` acima — e a conclusão não acrescenta nenhuma.
   */
  it('writes nothing to the event log', async () => {
    const cookie = await signUp('fernando')
    const fila = await createPile(cookie, 'Watch next', true)
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, fila, entry)

    await patchEntry(cookie, entry, { status: 'completed' })

    expect(db.select().from(eventLog).all()).toEqual([])
  })

  /**
   * O gatilho é a ESCRITA do status, não o estado. Pôr à mão uma obra já
   * concluída numa pilha que se esvazia é escolha explícita, e um PATCH de
   * nota depois não pode desfazê-la por efeito colateral.
   */
  it('keeps a completed entry that was added on purpose afterwards', async () => {
    const cookie = await signUp('fernando')
    const fila = await createPile(cookie, 'Watch next', true)
    const entry = await createEntry(cookie, 'Severance')
    await patchEntry(cookie, entry, { status: 'completed' })
    await add(cookie, fila, entry)

    await patchEntry(cookie, entry, { rating: 9 })

    expect(await titlesIn(cookie, fila)).toEqual(['Severance'])
  })

  it('leaves other users piles alone', async () => {
    const mine = await signUp('fernando')
    const fila = await createPile(mine, 'Watch next', true)
    const entry = await createEntry(mine, 'Severance')
    await add(mine, fila, entry)

    // Marcar como concluída não pode alcançar pilha de terceiro nem por acaso:
    // o filtro por dono é a única coisa entre a regra e a coleção de outro.
    await patchEntry(mine, entry, { status: 'completed' })

    const rows = db.select().from(pileEntries).all()
    expect(rows).toEqual([])
  })

  /**
   * A ordem padrão de `/piles` é "Recently updated": a pilha que se esvaziou
   * mudou de conteúdo e precisa subir, e a que não perdeu nada não pode subir
   * junto — reordenar a tela por um evento que não a tocou é a "lista que se
   * reordena sob a mão" pelo lado do servidor.
   *
   * A espera de 1,1s é o preço de `unixepoch()`, que tem granularidade de um
   * segundo. É a única espera da suíte, e cobre os dois lados de uma vez em
   * vez de dobrar o custo em dois testes.
   */
  it('bumps updated_at on the pile that lost a title, and only on it', async () => {
    const cookie = await signUp('fernando')
    const perdeu = await createPile(cookie, 'Watch next', true)
    const naoPerdeu = await createPile(cookie, 'Someday', true)
    const entry = await createEntry(cookie, 'Severance')
    await add(cookie, perdeu, entry)

    const at = (id: number) =>
      db.select().from(piles).where(eq(piles.id, id)).get()?.updatedAt
    const perdeuAntes = at(perdeu)
    const naoPerdeuAntes = at(naoPerdeu)

    await new Promise((resolve) => setTimeout(resolve, 1100))
    await patchEntry(cookie, entry, { status: 'completed' })

    expect(at(perdeu)?.getTime()).toBeGreaterThan(perdeuAntes?.getTime() ?? 0)
    expect(at(naoPerdeu)).toEqual(naoPerdeuAntes)
  })
})

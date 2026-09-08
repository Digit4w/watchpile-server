import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { importJobs } from '../../db/schema/import-jobs.js'
import { notifications } from '../../db/schema/notifications.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import * as jobs from '../import/import.jobs.js'

/**
 * O contrato de `/api/export`, e **o teste que importa é um CICLO**.
 *
 * Exportar, importar de volta num acervo vazio, conferir que a biblioteca é a
 * mesma. Um teste que só comparasse a string emitida com uma string escrita
 * aqui congelaria a nossa opinião sobre o formato — e ela pode estar errada dos
 * dois lados ao mesmo tempo, que é justamente o que o ciclo não deixa
 * acontecer.
 */

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUp(username = 'fernando'): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

function exportCsv(cookie?: string) {
  return app.request(
    '/api/export/entries.csv',
    cookie ? { headers: { cookie } } : undefined,
  )
}

function addEntry(cookie: string, body: unknown) {
  return app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

async function addEntryId(cookie: string, body: unknown): Promise<number> {
  const created = (await (await addEntry(cookie, body)).json()) as {
    id: number
  }
  return created.id
}

/**
 * Progresso não se cria junto com a obra: ele é contador mais log (brief,
 * 3.11), e quem o move é a rota própria. O export lê o contador.
 */
function addProgress(cookie: string, id: number, delta: number) {
  return app.request(`/api/entries/${id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ delta }),
  })
}

async function waitForImport(): Promise<void> {
  for (let i = 0; i < 50 && jobs.running(); i += 1) {
    await new Promise((r) => setImmediate(r))
  }
}

/** O que o ciclo tem que preservar, por obra. */
type Comparable = {
  mediaType: string
  title: string
  status: string
  progress: number
  total: number | null
  links: string[]
}

async function libraryOf(cookie: string): Promise<Comparable[]> {
  const rows = (await (
    await app.request('/api/entries?sort=title', { headers: { cookie } })
  ).json()) as Array<{
    id: number
    mediaType: string
    title: string
    status: string
    progress: number
    total: number | null
  }>

  return rows.map((row) => ({
    mediaType: row.mediaType,
    title: row.title,
    status: row.status,
    progress: row.progress,
    total: row.total,
    links: db
      .select()
      .from(externalIds)
      .where(eq(externalIds.entryId, row.id))
      .all()
      .map((link) => `${link.provider}/${link.mediaType}/${link.externalId}`)
      .sort(),
  }))
}

beforeEach(() => {
  db.delete(importJobs).run()
  db.delete(notifications).run()
  db.delete(eventLog).run()
  db.delete(externalIds).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('GET /api/export/entries.csv', () => {
  it('recusa sem sessão', async () => {
    expect((await exportCsv()).status).toBe(401)
  })

  it('serve um anexo com cabeçalho, mesmo sem obra nenhuma', async () => {
    const cookie = await signUp()

    const res = await exportCsv(cookie)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    // Cabeçalho e nada mais: um acervo vazio exporta um arquivo importável.
    expect(await res.text()).toBe(
      'media_type,title,status,progress,total,source,external_id,updated_at\r\n',
    )
  })

  /**
   * A biblioteca de outra pessoa não sai daqui, e a checagem não é de zelo: o
   * `user_id` vem da sessão, então o furo só existiria se alguém trocasse essa
   * origem por um parâmetro.
   */
  it('exporta só a biblioteca de quem pediu', async () => {
    const cookie = await signUp()
    await addEntry(cookie, {
      mediaType: 'anime',
      title: 'Frieren',
      status: 'watching',
    })

    db.insert(users)
      .values({
        username: 'outra',
        passwordHash: 'x',
        isAdmin: false,
      })
      .run()
    const outraId = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'outra'))
      .get()?.id as number
    db.insert(entries)
      .values({
        userId: outraId,
        mediaType: 'movie',
        title: 'Segredo',
        status: 'completed',
      })
      .run()

    const csv = await (await exportCsv(cookie)).text()

    expect(csv).toContain('Frieren')
    expect(csv).not.toContain('Segredo')
  })

  it('escapa vírgula e aspas do título, e o parser as lê de volta', async () => {
    const cookie = await signUp()
    await addEntry(cookie, {
      mediaType: 'anime',
      title: 'Kimi to, Nami ni "Noretara"',
      status: 'completed',
    })

    const csv = await (await exportCsv(cookie)).text()

    expect(csv).toContain('"Kimi to, Nami ni ""Noretara"""')
  })

  /**
   * `total` nulo é DESCONHECIDO — mangá em publicação não tem último capítulo
   * —, e célula vazia é como o importador lê isso. Um `0` aqui inventaria um
   * total de zero, que a volta gravaria como fato.
   */
  it('deixa o total vazio quando ele é desconhecido', async () => {
    const cookie = await signUp()
    const id = await addEntryId(cookie, {
      mediaType: 'manga',
      title: 'Berserk',
      status: 'on-hold',
    })
    await addProgress(cookie, id, 364)

    const linha = (await (await exportCsv(cookie)).text()).split('\r\n')[1]

    // As duas células vazias do meio são `total`; as duas seguintes, o vínculo
    // ausente. A última é a data, que muda a cada execução.
    expect(linha).toMatch(/^manga,Berserk,on-hold,364,,,,\d{4}-/)
  })
})

describe('o ciclo', () => {
  it('exporta e importa de volta sem mudar nada', async () => {
    const cookie = await signUp()

    await addEntry(cookie, {
      mediaType: 'anime',
      title: 'Frieren, Beyond Journey’s End',
      status: 'watching',
      progress: 4,
      total: 28,
      source: { provider: 'kitsu', externalId: '46102' },
    })
    await addEntry(cookie, {
      mediaType: 'manga',
      title: 'Berserk',
      status: 'on-hold',
      progress: 364,
    })
    await addEntry(cookie, {
      mediaType: 'movie',
      title: 'Perfect Blue',
      status: 'completed',
      source: { provider: 'tmdb', externalId: '10494' },
    })

    const antes = await libraryOf(cookie)
    const csv = await (await exportCsv(cookie)).text()

    // O acervo some inteiro: o que a volta reconstruir veio do arquivo, não de
    // uma linha que sobrou.
    db.delete(entries).run()
    expect(await libraryOf(cookie)).toEqual([])

    const res = await app.request('/api/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie },
      body: csv,
    })
    expect(res.status).toBe(202)
    await waitForImport()

    expect(await libraryOf(cookie)).toEqual(antes)
  })

  /**
   * O arquivo é o mesmo entre dois exports do mesmo acervo, e é isso que
   * permite comparar dois backups com `diff` em vez de lê-los.
   */
  it('emite o mesmo arquivo duas vezes para o mesmo acervo', async () => {
    const cookie = await signUp()
    await addEntry(cookie, {
      mediaType: 'anime',
      title: 'Frieren',
      status: 'watching',
    })
    await addEntry(cookie, {
      mediaType: 'movie',
      title: 'Perfect Blue',
      status: 'completed',
    })

    expect(await (await exportCsv(cookie)).text()).toBe(
      await (await exportCsv(cookie)).text(),
    )
  })
})

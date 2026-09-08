import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { artCache } from '../../db/schema/art-cache.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'
import { providerCache, providers } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { env } from '../../env.js'
import { resetLimiter } from '../providers/providers.limiter.js'

/** O detalhe do TMDB, com o campo que o `field_map` semeado lê. */
const DETAIL = JSON.stringify({ id: 550, poster_path: '/pB8B.jpg' })

const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08])

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
    body: JSON.stringify({ username: 'admin', password: 'password123' }),
  })
  return cookieFrom(res)
}

function giveKey(): void {
  db.update(providers)
    .set({ credentialValues: { api_key: 'chave-de-teste' } })
    .where(eq(providers.slug, 'tmdb'))
    .run()
}

/**
 * Uma obra vinda do provedor. `POST /api/entries` com `source` escreve as duas
 * linhas na mesma transação, então é o caminho real e não uma montagem.
 */
async function entryWithSource(
  cookie: string,
  externalId = '550',
): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId },
    }),
  })
  return ((await res.json()) as { id: number }).id
}

async function entryWithoutSource(cookie: string): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ mediaType: 'movie', title: 'Digitada à mão' }),
  })
  return ((await res.json()) as { id: number }).id
}

/**
 * Duas respostas em sequência: o detalhe (JSON) e a imagem (bytes). É a ordem
 * real das duas idas à rede que uma falta de cache provoca.
 */
function respondDetailAndImage(contentType = 'image/jpeg') {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(DETAIL, { status: 200 }))
    .mockResolvedValueOnce(
      new Response(new Uint8Array(PIXEL), {
        status: 200,
        headers: { 'content-type': contentType },
      }),
    )
}

function requestArt(cookie: string, entryId: number, headers = {}) {
  return app.request(`/api/entries/${entryId}/art`, {
    headers: { Cookie: cookie, ...headers },
  })
}

beforeEach(() => {
  db.delete(artCache).run()
  db.delete(externalIds).run()
  db.delete(entries).run()
  db.delete(providerCache).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
  db.update(providers)
    .set({ credentialValues: {}, optionValues: {} })
    .where(eq(providers.slug, 'tmdb'))
    .run()
  rmSync(env.WATCHPILE_ART_CACHE_PATH, { recursive: true, force: true })
  resetLimiter()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/entries/{id}/art', () => {
  it('fetches from the provider on the first request, and serves it', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respondDetailAndImage()
    const entry = await entryWithSource(cookie)

    const res = await requestArt(cookie, entry)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PIXEL)

    // Duas idas: o detalhe, que diz onde o pôster está, e o pôster.
    expect(call).toHaveBeenCalledTimes(2)
    expect(String(call.mock.calls[1]?.[0])).toContain('/pB8B.jpg')
  })

  /**
   * O ponto do ciclo: a segunda visita não toca a rede. É o que sustenta a
   * promessa honesta — "a arte que você já viu abre offline".
   */
  it('serves the second request from disk, without touching the network', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = respondDetailAndImage()
    const entry = await entryWithSource(cookie)

    expect((await requestArt(cookie, entry)).status).toBe(200)
    call.mockClear()

    const second = await requestArt(cookie, entry)

    expect(second.status).toBe(200)
    expect(Buffer.from(await second.arrayBuffer())).toEqual(PIXEL)
    expect(call).not.toHaveBeenCalled()
  })

  it('indexes what it wrote, so the ceiling has something to count', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respondDetailAndImage()
    const entry = await entryWithSource(cookie)
    await requestArt(cookie, entry)

    const row = db.select().from(artCache).get()

    expect(row).toMatchObject({
      provider: 'tmdb',
      externalId: '550',
      contentType: 'image/jpeg',
      bytes: PIXEL.byteLength,
    })
    expect(existsSync(`${env.WATCHPILE_ART_CACHE_PATH}/${row?.fileName}`)).toBe(
      true,
    )
  })

  it('answers 304 to a request that already has it', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respondDetailAndImage()
    const entry = await entryWithSource(cookie)

    const first = await requestArt(cookie, entry)
    const etag = first.headers.get('etag') as string

    const second = await requestArt(cookie, entry, { 'If-None-Match': etag })

    expect(second.status).toBe(304)
  })

  /**
   * Obra digitada à mão **nunca ganha arte** enquanto não houver como vinculá-la
   * a um provedor (brief, 3.10) — e é o segundo motivo pra aquela pendência.
   */
  it('404s on a title with no provider link, without calling out', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const call = vi.spyOn(globalThis, 'fetch')
    const entry = await entryWithoutSource(cookie)

    expect((await requestArt(cookie, entry)).status).toBe(404)
    expect(call).not.toHaveBeenCalled()
  })

  it("404s on someone else's title", async () => {
    const cookie = await signUpAdmin()
    giveKey()
    const entry = await entryWithSource(cookie)

    const other = db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'x', isAdmin: false })
      .returning()
      .get()
    db.update(entries)
      .set({ userId: other.id })
      .where(eq(entries.id, entry))
      .run()

    expect((await requestArt(cookie, entry)).status).toBe(404)
  })

  /**
   * Obra que existe no provedor e não tem pôster é caso comum em catálogo
   * grande, e não é erro de ninguém — a tela cai no ladrilho com a inicial.
   */
  it('404s when the provider has no poster for it', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 550, poster_path: null }), {
        status: 200,
      }),
    )
    const entry = await entryWithSource(cookie)

    expect((await requestArt(cookie, entry)).status).toBe(404)
    expect(db.select().from(artCache).all()).toEqual([])
  })

  /**
   * Página de erro em HTML servida como arte encheria o cache de lixo, e o
   * navegador desenharia o ícone de imagem quebrada — que é pior que o
   * ladrilho, porque parece defeito nosso.
   */
  it('refuses a response that is not an image, and caches nothing', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respondDetailAndImage('text/html')
    const entry = await entryWithSource(cookie)

    expect((await requestArt(cookie, entry)).status).toBe(404)
    expect(db.select().from(artCache).all()).toEqual([])
  })

  it('rejects without a session', async () => {
    const cookie = await signUpAdmin()
    giveKey()
    respondDetailAndImage()
    const entry = await entryWithSource(cookie)

    expect((await requestArt('', entry)).status).toBe(401)
  })
})

describe('the art field on an entry', () => {
  it('carries the address when there is a source, and null when there is not', async () => {
    const cookie = await signUpAdmin()
    const withSource = await entryWithSource(cookie)
    const withoutSource = await entryWithoutSource(cookie)

    const res = await app.request('/api/entries', {
      headers: { Cookie: cookie },
    })
    const body = (await res.json()) as { id: number; art: string | null }[]

    expect(body.find(({ id }) => id === withSource)?.art).toBe(
      `/api/entries/${withSource}/art`,
    )
    expect(body.find(({ id }) => id === withoutSource)?.art).toBeNull()
  })

  /**
   * Uma consulta pra lista inteira, nunca uma por linha: a biblioteca devolve
   * dezenas de obras, e o N+1 aqui rodaria em toda abertura de tela.
   */
  it('resolves the whole list without asking once per row', async () => {
    const cookie = await signUpAdmin()
    for (const id of ['550', '551', '552']) {
      await entryWithSource(cookie, id)
    }

    const spy = vi.spyOn(db, 'selectDistinct')
    await app.request('/api/entries', { headers: { Cookie: cookie } })

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

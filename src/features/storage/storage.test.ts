import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { artCache } from '../../db/schema/art-cache.js'
import { entries } from '../../db/schema/entries.js'
import { providerCache } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { writeCache } from '../providers/providers.cache.js'

/**
 * O contrato de `/api/storage`.
 *
 * O que se prova aqui é o que a seção mostra e o que ela promete: dois caches
 * com formas diferentes, cada um limpo por conta própria, e a coisa toda
 * fechada para quem não é admin.
 */

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
    body: JSON.stringify({ username: 'fernando', password: 'password123' }),
  })
  return cookieFrom(res)
}

async function signUpMember(): Promise<string> {
  db.insert(users)
    .values({
      username: 'membro',
      passwordHash: hashPassword('password123'),
      isAdmin: false,
    })
    .run()

  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'membro', password: 'password123' }),
  })
  return cookieFrom(res)
}

const get = (cookie?: string) =>
  app.request('/api/storage', cookie ? { headers: { cookie } } : undefined)

const clear = (which: string, cookie?: string) =>
  app.request(`/api/storage/${which}`, {
    method: 'DELETE',
    ...(cookie ? { headers: { cookie } } : {}),
  })

/** Uma linha de arte no índice, sem arquivo — o índice é o que a conta lê. */
function indexArt(externalId: string, bytes: number) {
  db.insert(artCache)
    .values({
      provider: 'tmdb',
      externalId,
      mediaType: 'movie',
      fileName: `${externalId}.jpg`,
      contentType: 'image/jpeg',
      bytes,
    })
    .run()
}

beforeEach(() => {
  db.delete(artCache).run()
  db.delete(providerCache).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('a guarda', () => {
  it('recusa as três rotas sem sessão', async () => {
    expect((await get()).status).toBe(401)
    expect((await clear('provider-cache')).status).toBe(401)
    expect((await clear('art-cache')).status).toBe(401)
  })

  /**
   * 403 e não 404: quem não é admin entrou certo, e mandá-lo pro login diria o
   * contrário. É a distinção que `adminMiddleware` existe pra manter.
   */
  it('recusa com 403 para quem não é admin', async () => {
    await signUpAdmin()
    const cookie = await signUpMember()

    expect((await get(cookie)).status).toBe(403)
    expect((await clear('art-cache', cookie)).status).toBe(403)
  })
})

describe('GET /api/storage', () => {
  it('conta as duas caches separadamente', async () => {
    const cookie = await signUpAdmin()
    writeCache('tmdb', '/search/movie?query=blue', '{"results":[]}')
    indexArt('10494', 40_000)
    indexArt('550', 60_000)

    const body = (await (await get(cookie)).json()) as {
      providerCache: { responses: number; bytes: number }
      artCache: { files: number; bytes: number; limitBytes: number }
    }

    expect(body.providerCache.responses).toBe(1)
    expect(body.providerCache.bytes).toBeGreaterThan(0)
    expect(body.artCache).toMatchObject({ files: 2, bytes: 100_000 })
    expect(body.artCache.limitBytes).toBeGreaterThan(0)
  })

  it('responde zero num servidor recém-instalado', async () => {
    const cookie = await signUpAdmin()

    expect(await (await get(cookie)).json()).toMatchObject({
      providerCache: { responses: 0, bytes: 0 },
      artCache: { files: 0, bytes: 0 },
    })
  })

  /**
   * `length()` conta CARACTERES em texto no SQLite; o tamanho tem que sair de
   * `cast(... as blob)`, senão a sinopse acentuada aparece menor do que é.
   */
  it('mede o corpo em bytes, não em caracteres', async () => {
    const cookie = await signUpAdmin()
    // Cinco caracteres, dez bytes em UTF-8.
    writeCache('tmdb', '/x', 'ãããã ')

    const body = (await (await get(cookie)).json()) as {
      providerCache: { bytes: number }
    }
    expect(body.providerCache.bytes).toBe(9)
  })
})

describe('DELETE /api/storage/provider-cache', () => {
  it('esvazia e devolve o que havia', async () => {
    const cookie = await signUpAdmin()
    writeCache('tmdb', '/search/movie?query=blue', '{"results":[]}')
    indexArt('10494', 40_000)

    const res = await clear('provider-cache', cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cleared: { responses: 1 } })
    // O outro cache não é tocado: limpar um não é limpar o outro.
    expect(db.select().from(providerCache).all()).toHaveLength(0)
    expect(db.select().from(artCache).all()).toHaveLength(1)
  })
})

describe('DELETE /api/storage/art-cache', () => {
  it('esvazia o índice e devolve o que havia', async () => {
    const cookie = await signUpAdmin()
    writeCache('tmdb', '/search/movie?query=blue', '{"results":[]}')
    indexArt('10494', 40_000)
    indexArt('550', 60_000)

    const res = await clear('art-cache', cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      cleared: { files: 2, bytes: 100_000 },
    })
    expect(db.select().from(artCache).all()).toHaveLength(0)
    expect(db.select().from(providerCache).all()).toHaveLength(1)
  })
})

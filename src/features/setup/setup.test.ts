import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { mediaTypeNames, mediaTypes } from '../../db/schema/media-types.js'
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

async function createAdmin(): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'fernando', password: 'password123' }),
  })
  return cookieFrom(res)
}

function configureInstance(cookie: string, body: unknown) {
  return app.request('/api/setup/instance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
}

function slugs(): string[] {
  return db
    .select({ slug: mediaTypes.slug })
    .from(mediaTypes)
    .all()
    .map((row) => row.slug)
    .sort()
}

/**
 * **Esta é a única suíte que APAGA tipo semeado**, porque é o que a rota faz. As
 * outras podem tratar os seis como estado base da instalação (`media-types.test`
 * apaga só o que ela mesma criou); aqui isso não vale, e sem restaurar os seis o
 * segundo teste já rodaria contra o que o primeiro deixou.
 *
 * O retrato é tirado ANTES do primeiro teste e vem do banco migrado — não é uma
 * terceira cópia à mão dos seis, que é justamente o que `media-types.templates`
 * existe pra evitar.
 */
const SEEDED_TYPES = db.select().from(mediaTypes).all()
const SEEDED_NAMES = db.select().from(mediaTypeNames).all()

/**
 * **A linha de `settings` é ZERADA, nunca apagada** — e isto custou tempo.
 *
 * `getSessionSecret` cria a linha preguiçosamente e guarda o segredo numa
 * variável de módulo. Apagar a linha (que é o que as outras suítes fazem, sem
 * consequência, porque nenhuma delas escreve em `settings`) não faz a criação
 * rodar de novo: o cache responde, a linha não volta, e o `UPDATE` do handler
 * passa a acertar zero linha **em silêncio**. O sintoma foi a rota responder 204
 * com o banco intacto.
 */
beforeEach(() => {
  db.delete(sessions).run()
  db.delete(users).run()
  db.update(settings)
    .set({ instanceSetupAt: null, instanceLanguage: 'en' })
    .run()
  db.delete(mediaTypes).run()
  db.insert(mediaTypes).values(SEEDED_TYPES).run()
  db.insert(mediaTypeNames).values(SEEDED_NAMES).run()
})

describe('GET /api/setup/status', () => {
  it('asks for the account while there is no user', async () => {
    const res = await app.request('/api/setup/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pending: 'account' })
  })

  it('asks for the instance once the admin exists', async () => {
    await createAdmin()

    const res = await app.request('/api/setup/status')
    expect(await res.json()).toEqual({ pending: 'instance' })
  })

  it('reports nothing pending once the instance is configured', async () => {
    const cookie = await createAdmin()
    await configureInstance(cookie, { language: 'en', keep: ['movie', 'tv'] })

    const res = await app.request('/api/setup/status')
    expect(await res.json()).toEqual({ pending: null })
  })
})

describe('POST /api/setup/account', () => {
  it('creates the first admin and opens the session', async () => {
    const res = await app.request('/api/setup/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fernando', password: 'password123' }),
    })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: expect.any(Number),
      username: 'fernando',
      isAdmin: true,
    })
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('refuses once a user already exists', async () => {
    await createAdmin()

    const res = await app.request('/api/setup/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'other', password: 'password123' }),
    })

    expect(res.status).toBe(409)
  })
})

describe('POST /api/setup/instance', () => {
  it('keeps what was picked and deletes the rest', async () => {
    const cookie = await createAdmin()
    expect(slugs()).toEqual(['anime', 'book', 'game', 'manga', 'movie', 'tv'])

    const res = await configureInstance(cookie, {
      language: 'pt-BR',
      keep: ['movie', 'tv', 'anime'],
    })

    expect(res.status).toBe(204)
    expect(slugs()).toEqual(['anime', 'movie', 'tv'])
  })

  it('writes the base language', async () => {
    const cookie = await createAdmin()
    await configureInstance(cookie, { language: 'pt-BR', keep: ['book'] })

    const row = db.select().from(settings).get()
    expect(row?.instanceLanguage).toBe('pt-BR')
    expect(row?.instanceSetupAt).toBeInstanceOf(Date)
  })

  it('refuses an empty selection — the wizard needs at least one type', async () => {
    const cookie = await createAdmin()

    const res = await configureInstance(cookie, { language: 'en', keep: [] })

    expect(res.status).toBe(400)
    expect(slugs()).toHaveLength(6)
  })

  /**
   * O slug desconhecido é recusado ANTES de a transação abrir, e o teste
   * confere as duas metades: o status e o fato de nada ter sido apagado. Sem a
   * segunda asserção, uma implementação que apagasse e só então validasse
   * passaria.
   */
  it('refuses an unknown slug without touching anything', async () => {
    const cookie = await createAdmin()

    const res = await configureInstance(cookie, {
      language: 'en',
      keep: ['movie', 'podcast'],
    })

    expect(res.status).toBe(400)
    expect(slugs()).toHaveLength(6)
  })

  it('refuses a language that is not a locale', async () => {
    const cookie = await createAdmin()

    const res = await configureInstance(cookie, {
      language: 'portuguese',
      keep: ['movie'],
    })

    expect(res.status).toBe(400)
  })

  it('refuses to run twice', async () => {
    const cookie = await createAdmin()
    await configureInstance(cookie, { language: 'en', keep: ['movie', 'tv'] })

    const res = await configureInstance(cookie, {
      language: 'en',
      keep: ['book'],
    })

    expect(res.status).toBe(409)
    expect(slugs()).toEqual(['movie', 'tv'])
  })

  it('refuses without a session', async () => {
    await createAdmin()

    const res = await app.request('/api/setup/instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en', keep: ['movie'] }),
    })

    expect(res.status).toBe(401)
  })

  /**
   * Com sessão e sem cargo é **403, e nunca 401** — a distinção é exatamente o
   * trabalho do `adminMiddleware`: mandar essa pessoa pro login diria que ela
   * entrou errado, quando ela entrou certo.
   *
   * Rebaixar a própria conta em vez de forjar uma sessão de outra: o cookie é
   * ASSINADO, então um token cru na mão não passa por `getSignedCookie` — e o
   * teste mediria 401 achando que mediu 403. A sessão é resolvida a cada
   * requisição, então o rebaixamento vale já na seguinte.
   */
  it('refuses a signed-in non-admin with 403, not 401', async () => {
    const cookie = await createAdmin()
    db.update(users).set({ isAdmin: false }).run()

    const res = await configureInstance(cookie, {
      language: 'en',
      keep: ['movie'],
    })

    expect(res.status).toBe(403)
    expect(slugs()).toHaveLength(6)
  })
})

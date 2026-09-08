import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import { sessions } from '../../db/schema/sessions.js'
import { settings } from '../../db/schema/settings.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { COVER_MAX_BYTES } from './piles.cover.routes.js'

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

async function createPile(cookie: string, name: string): Promise<number> {
  const res = await app.request('/api/piles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as { id: number }).id
}

const IMAGE = Buffer.from('RIFF....WEBPVP8 fake bytes for the test')

function upload(
  cookie: string,
  pileId: number,
  body: BodyInit,
  type = 'image/webp',
) {
  return app.request(`/api/piles/${pileId}/cover`, {
    method: 'PUT',
    headers: { 'Content-Type': type, Cookie: cookie },
    body,
  })
}

beforeEach(() => {
  db.delete(pileEntries).run()
  db.delete(entries).run()
  db.delete(piles).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('PUT /api/piles/{id}/cover', () => {
  it('stores the image and flips hasCover, without ever returning the bytes', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const res = await upload(cookie, pile, IMAGE)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ id: pile, hasCover: true })
    // A invariante que o vazamento de 31/08/2026 ensinou: o BLOB não viaja em
    // JSON, em rota nenhuma — nem na que acabou de gravá-lo.
    expect(body).not.toHaveProperty('cover')
    expect(body).not.toHaveProperty('coverType')
  })

  it('keeps the response shape of every other pile route', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const body = await (await upload(cookie, pile, IMAGE)).json()

    // O cliente põe esta resposta direto no cache da lista; uma forma diferente
    // por rota o obrigaria a remendar o buraco em cada uma.
    expect(body).toMatchObject({ entryCount: 0, preview: [] })
  })

  it('refuses a type that is not an accepted image', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    // SVG é documento executável, não imagem — e é exatamente o que uma lista
    // de bloqueio deixaria passar.
    const res = await upload(cookie, pile, '<svg/>', 'image/svg+xml')

    expect(res.status).toBe(415)
  })

  it('accepts the type with a stray parameter after it', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const res = await upload(cookie, pile, IMAGE, 'image/webp; charset=binary')

    expect(res.status).toBe(200)
  })

  it('refuses an image above the limit', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const res = await upload(cookie, pile, Buffer.alloc(COVER_MAX_BYTES + 1))

    expect(res.status).toBe(413)
  })

  it('refuses an empty body — removing has its own verb', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const res = await upload(cookie, pile, Buffer.alloc(0))

    expect(res.status).toBe(415)
    const pileBody = await (
      await app.request(`/api/piles/${pile}`, { headers: { Cookie: cookie } })
    ).json()
    expect(pileBody).toMatchObject({ hasCover: false })
  })

  it('replaces the previous cover instead of piling up', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')
    await upload(cookie, pile, IMAGE)

    const second = Buffer.from('a completely different image')
    await upload(cookie, pile, second, 'image/png')

    const res = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookie },
    })
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(second)
  })
})

describe('GET /api/piles/{id}/cover', () => {
  it('serves the exact bytes with the stored type', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')
    await upload(cookie, pile, IMAGE)

    const res = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    // Byte a byte: `Buffer` é uma vista sobre um pool maior, e mandar o
    // `ArrayBuffer` inteiro em vez da fatia vazaria bytes de outras alocações.
    expect(Buffer.from(await res.arrayBuffer())).toEqual(IMAGE)
  })

  it('answers 304 when the cached copy is still current', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')
    await upload(cookie, pile, IMAGE)

    const first = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookie },
    })
    const etag = first.headers.get('etag') ?? ''

    const second = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookie, 'If-None-Match': etag },
    })

    expect(etag).not.toBe('')
    expect(second.status).toBe(304)
  })

  it('gives a pile without a cover the same 404 as a pile that does not exist', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const semCapa = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookie },
    })
    const inexistente = await app.request('/api/piles/9999/cover', {
      headers: { Cookie: cookie },
    })

    // Respostas iguais de propósito: separá-las contaria a quem tem sessão
    // quais ids existem na conta de outra pessoa.
    expect(semCapa.status).toBe(404)
    expect(inexistente.status).toBe(404)
  })

  /**
   * A guarda que separa contas na mesma instalação. A capa é o pior lugar pra
   * ela falhar: é o único endpoint que devolve bytes crus, então um vazamento
   * aqui não é um id que escapou — é a imagem inteira.
   *
   * O segundo usuário nasce direto no banco porque `/api/auth/register` ainda
   * não existe (server/CLAUDE.md, "Auth") — é o mesmo caminho que
   * `piles.test.ts` já usa.
   */
  it('never serves another user cover', async () => {
    const owner = await signUp('fernando')
    const pile = await createPile(owner, 'Winter watchlist')
    await upload(owner, pile, IMAGE)

    /**
     * Login de verdade, e não uma linha forjada em `sessions`: o cookie é
     * ASSINADO (`auth.session.ts`), então uma sessão inserida à mão nunca
     * passaria pela verificação — e um teste que contorna a autenticação
     * deixa de provar que a autorização funciona.
     */
    db.insert(users)
      .values({
        username: 'convidado',
        passwordHash: hashPassword('password123'),
        isAdmin: false,
      })
      .run()
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'convidado', password: 'password123' }),
    })

    const res = await app.request(`/api/piles/${pile}/cover`, {
      headers: { Cookie: cookieFrom(login) },
    })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/piles/{id}/cover', () => {
  it('clears both columns and falls back to the mosaic', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')
    await upload(cookie, pile, IMAGE)

    const res = await app.request(`/api/piles/${pile}/cover`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hasCover: false })
    // Os dois campos caem juntos: um `coverType` órfão faria `GET` responder
    // de um jeito e `hasCover` dizer outro.
    const row = db.select().from(piles).all()[0]
    expect(row?.cover).toBeNull()
    expect(row?.coverType).toBeNull()
  })

  it('is not an error on a pile that has no cover', async () => {
    const cookie = await signUp('fernando')
    const pile = await createPile(cookie, 'Winter watchlist')

    const res = await app.request(`/api/piles/${pile}/cover`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })

    // O resultado pedido — "esta pilha não tem capa" — já é verdade.
    expect(res.status).toBe(200)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import { REDACTED, registerSecret } from '../../lib/log-redact.js'
import { logger } from '../../lib/logger.js'
import { hashPassword } from '../auth/auth.crypto.js'

/**
 * O contrato de `/api/logs`, contra o logger DE VERDADE: as linhas que se leem
 * aqui foram escritas pelo mesmo `logger` que o servidor usa, no arquivo que
 * `vitest.config.ts` aponta. Um dublê de arquivo provaria a leitura e deixaria
 * de fora justamente a costura com a escrita.
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

const get = (path: string, cookie?: string) =>
  app.request(`/api/logs${path}`, cookie ? { headers: { cookie } } : undefined)

type Page = {
  lines: { msg: string; level: number; fields: Record<string, unknown> }[]
  hasOlder: boolean
  usage: { files: number; bytes: number; limitBytes: number }
}

beforeEach(() => {
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('a guarda', () => {
  it('recusa as duas rotas sem sessão', async () => {
    expect((await get('')).status).toBe(401)
    expect((await get('/download')).status).toBe(401)
  })

  it('recusa com 403 para quem não é admin', async () => {
    await signUpAdmin()
    const cookie = await signUpMember()

    expect((await get('', cookie)).status).toBe(403)
    expect((await get('/download', cookie)).status).toBe(403)
  })
})

describe('GET /api/logs', () => {
  it('lê o que o logger escreveu, com o filtro de gravidade', async () => {
    const cookie = await signUpAdmin()
    const marker = `marker-${Date.now()}`
    logger.info({ marker }, 'plain info')
    logger.warn({ marker }, 'provider search unreachable')

    const all = (await (await get('', cookie)).json()) as Page
    const warn = (await (await get('?level=warn', cookie)).json()) as Page

    const mine = (page: Page) =>
      page.lines.filter((l) => l.fields.marker === marker).map((l) => l.msg)

    expect(mine(all)).toEqual(['plain info', 'provider search unreachable'])
    expect(mine(warn)).toEqual(['provider search unreachable'])
    expect(all.usage.files).toBeGreaterThan(0)
    expect(all.usage.limitBytes).toBeGreaterThan(0)
  })

  it('não devolve o cookie de sessão de quem pediu', async () => {
    const cookie = await signUpAdmin()
    // Força uma linha de requisição no arquivo: 4xx sobe pra `info`.
    await app.request('/api/entries/999999', { headers: { cookie } })

    const text = await (await get('', cookie)).text()

    expect(text).not.toContain(cookie.split('=')[1] ?? 'unreachable')
  })

  it('recusa um nível que não existe', async () => {
    const cookie = await signUpAdmin()
    expect((await get('?level=debug', cookie)).status).toBe(400)
  })
})

describe('GET /api/logs/download', () => {
  it('entrega o arquivo nomeado pelo servidor, redigido', async () => {
    const cookie = await signUpAdmin()
    registerSecret('download-secret-0001')
    logger.warn('refused with download-secret-0001')

    const res = await get('/download', cookie)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="watchpile-log-\d{4}-\d{2}-\d{2}\.jsonl"$/,
    )
    expect(body).not.toContain('download-secret-0001')
    expect(body).toContain(REDACTED)
  })
})

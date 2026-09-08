import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { notifications } from '../../db/schema/notifications.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import { dedupeKey } from './notifications.kinds.js'
import * as store from './notifications.store.js'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

/** O admin da instalação. `/api/setup/account` é o wizard de PRIMEIRO uso. */
async function signUpAdmin(username: string): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

/**
 * Um segundo usuário, que **não** é admin.
 *
 * Ele nasce direto no banco porque `/api/setup/account` só responde com o banco
 * sem usuário nenhum, e **não existe rota de registro**: `settings.registration_open`
 * está na tabela desde a primeira migration e nenhuma rota a lê. Depois de
 * inserido, o login é o de verdade — é ele que assina o cookie.
 */
async function signUpMember(username: string): Promise<string> {
  db.insert(users)
    .values({
      username,
      passwordHash: hashPassword('password123'),
      isAdmin: false,
    })
    .run()

  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

function idOf(username: string): number {
  const row = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get()
  if (!row) {
    throw new Error(`no user ${username}`)
  }
  return row.id
}

function list(cookie?: string, query = '') {
  return app.request(
    `/api/notifications${query}`,
    cookie ? { headers: { Cookie: cookie } } : undefined,
  )
}

function unread(cookie: string) {
  return app.request('/api/notifications/unread-count', {
    headers: { Cookie: cookie },
  })
}

function markRead(cookie: string, ids: number[]) {
  return app.request('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ids }),
  })
}

function dismiss(cookie: string, id: number) {
  return app.request(`/api/notifications/${id}/dismiss`, {
    method: 'POST',
    headers: { Cookie: cookie },
  })
}

/**
 * As migrations semeiam seis provedores, e a leitura de admin reconcilia as
 * condições de instância antes de responder — então um `GET` de admin emitiria
 * avisos de verdade no meio destes testes.
 *
 * Desligar o vínculo tipo↔provedor cala o reconciliador **pela regra dele
 * mesmo**: provedor que não serve tipo nenhum é *ocioso, não quebrado* (brief,
 * 3.10). O bloco `reconciliação` abaixo religa o vínculo pra exercitá-lo.
 *
 * O banco é `:memory:` e o vitest isola por arquivo, então isto não vaza.
 */
beforeEach(() => {
  db.delete(notifications).run()
  db.delete(mediaTypeProviders).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('GET /api/notifications', () => {
  it('refuses without a session', async () => {
    expect((await list()).status).toBe(401)
  })

  it('starts empty', async () => {
    const cookie = await signUpAdmin('fernando')

    const res = await list(cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notifications: [], nextCursor: null })
  })

  it('returns kind and params, never a sentence', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: { provider: 'IGDB', providerSlug: 'igdb' },
    })

    const body = await (await list(cookie)).json()

    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0]).toMatchObject({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: { provider: 'IGDB', providerSlug: 'igdb' },
      read: false,
      dismissed: false,
    })
    // Nenhum campo de frase: a copy é do cliente (brief, 3.8).
    expect(body.notifications[0]).not.toHaveProperty('title')
    expect(body.notifications[0]).not.toHaveProperty('body')
  })

  it('keeps numbers as numbers, so the client can format them', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'art-cache-full',
      params: { limitBytes: 524_288_000 },
    })

    const body = await (await list(cookie)).json()

    expect(body.notifications[0].params.limitBytes).toBe(524_288_000)
  })

  it('newest first', async () => {
    const cookie = await signUpAdmin('fernando')
    for (const slug of ['tmdb', 'igdb', 'kitsu']) {
      store.emit({
        audience: 'instance',
        severity: 'warning',
        kind: 'provider-missing-key',
        params: { providerSlug: slug },
        dedupeKey: dedupeKey('instance', 'art-cache-full', slug),
      })
    }

    const body = await (await list(cookie)).json()

    expect(
      body.notifications.map(
        (n: { params: { providerSlug: string } }) => n.params.providerSlug,
      ),
    ).toEqual(['kitsu', 'igdb', 'tmdb'])
  })
})

describe('audiência', () => {
  it('hides instance notifications from non-admins', async () => {
    await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })

    const body = await (await list(member)).json()

    expect(body.notifications).toEqual([])
  })

  it('shows them to the admin', async () => {
    const admin = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })

    const body = await (await list(admin)).json()

    expect(body.notifications).toHaveLength(1)
  })

  it('never leaks one user notification to another', async () => {
    const admin = await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    store.emit({
      audience: 'user',
      userId: idOf('outra'),
      severity: 'info',
      kind: 'art-cache-full',
      params: {},
    })

    // Nem o admin vê o que é de outra pessoa: `is_admin` abre a audiência de
    // INSTÂNCIA, não a caixa dos outros.
    expect((await (await list(admin)).json()).notifications).toEqual([])
    expect((await (await list(member)).json()).notifications).toHaveLength(1)
  })

  it('filters by audience without turning it into a permission error', async () => {
    await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })

    // Pra quem não é admin aquelas linhas não existem, então o filtro é um AND
    // sobre o que ela já podia ver — 200 com lista vazia, nunca 403. Um 403
    // contaria que há coisa ali.
    const res = await list(member, '?audience=instance')

    expect(res.status).toBe(200)
    expect((await res.json()).notifications).toEqual([])
  })
})

/**
 * Estes usam a chave do grupo `art-cache-full` de propósito: **o reconciliador
 * é dono do PREFIXO inteiro** (`instance:provider-`), então uma linha emitida à
 * mão ali seria dispensada por ele no primeiro `GET` de admin — que é
 * exatamente o comportamento que se quer, e o motivo de o teste genérico não
 * morar no namespace de um reconciliador.
 */
describe('dedupe', () => {
  it('emits once per condition, not once per boot', async () => {
    const cookie = await signUpAdmin('fernando')
    const key = dedupeKey('instance', 'art-cache-full', 'igdb')

    for (let i = 0; i < 5; i++) {
      store.emit({
        audience: 'instance',
        severity: 'warning',
        kind: 'provider-missing-key',
        params: { providerSlug: 'igdb' },
        dedupeKey: key,
      })
    }

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })

  it('lets the condition come back after being dismissed', async () => {
    const cookie = await signUpAdmin('fernando')
    const key = dedupeKey('instance', 'art-cache-full', 'igdb')
    const emit = () =>
      store.emit({
        audience: 'instance',
        severity: 'warning',
        kind: 'provider-missing-key',
        params: {},
        dedupeKey: key,
      })

    emit()
    const first = (await (await list(cookie)).json()).notifications[0]
    await dismiss(cookie, first.id)
    emit()

    // Duas linhas no histórico, uma só no painel: o fato aconteceu duas vezes.
    expect(
      (await (await list(cookie, '?include=all')).json()).notifications,
    ).toHaveLength(2)
    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })

  it('never dedupes a pure event', async () => {
    const cookie = await signUpAdmin('fernando')

    for (let i = 0; i < 3; i++) {
      store.emit({
        audience: 'user',
        userId: idOf('fernando'),
        severity: 'info',
        kind: 'art-cache-full',
        params: {},
      })
    }

    expect((await (await list(cookie)).json()).notifications).toHaveLength(3)
  })
})

describe('lido e dispensado são dois estados', () => {
  it('counts unread and reports the worst severity', async () => {
    const cookie = await signUpAdmin('fernando')
    for (const severity of ['info', 'warning', 'info'] as const) {
      store.emit({
        audience: 'instance',
        severity,
        kind: 'provider-missing-key',
        params: {},
      })
    }

    expect(await (await unread(cookie)).json()).toEqual({
      count: 3,
      severity: 'warning',
    })
  })

  it('reports no severity when nothing is unread', async () => {
    const cookie = await signUpAdmin('fernando')

    expect(await (await unread(cookie)).json()).toEqual({
      count: 0,
      severity: null,
    })
  })

  it('marks only the ids it was given', async () => {
    const cookie = await signUpAdmin('fernando')
    for (const slug of ['a', 'b', 'c']) {
      store.emit({
        audience: 'instance',
        severity: 'info',
        kind: 'provider-missing-key',
        params: { providerSlug: slug },
        dedupeKey: dedupeKey('instance', 'art-cache-full', slug),
      })
    }
    const all = (await (await list(cookie)).json()).notifications

    const res = await markRead(cookie, [all[0].id, all[1].id])

    expect(await res.json()).toEqual({ count: 1, severity: 'info' })
  })

  it('cannot mark someone else notification as read', async () => {
    await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })
    const hidden = db.select().from(notifications).all()[0]
    if (!hidden) {
      throw new Error('nada emitido')
    }

    await markRead(member, [hidden.id])

    expect(db.select().from(notifications).all()[0]?.readAt).toBeNull()
  })

  it('dismissing keeps the row in the history', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })
    const one = (await (await list(cookie)).json()).notifications[0]

    expect((await dismiss(cookie, one.id)).status).toBe(200)

    expect((await (await list(cookie)).json()).notifications).toEqual([])
    const history = (await (await list(cookie, '?include=all')).json())
      .notifications
    expect(history).toHaveLength(1)
    expect(history[0].dismissed).toBe(true)
  })

  it('dismissing does not mark as read', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })
    const one = (await (await list(cookie)).json()).notifications[0]

    await dismiss(cookie, one.id)

    // Dispensado sai do painel, e por isso sai do contador — mas o motivo é a
    // dispensa, não a leitura: a linha continua `read: false` no histórico.
    expect(await (await unread(cookie)).json()).toEqual({
      count: 0,
      severity: null,
    })
    const history = (await (await list(cookie, '?include=all')).json())
      .notifications
    expect(history[0].read).toBe(false)
  })

  it('answers 404 for a notification this user cannot see', async () => {
    await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })
    const row = db.select().from(notifications).all()[0]
    if (!row) {
      throw new Error('nada emitido')
    }

    expect((await dismiss(member, row.id)).status).toBe(404)
  })

  it('answers 404 when dismissing twice', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: {},
    })
    const one = (await (await list(cookie)).json()).notifications[0]

    await dismiss(cookie, one.id)

    expect((await dismiss(cookie, one.id)).status).toBe(404)
  })
})

describe('condição resolvida se dispensa sozinha', () => {
  it('dismisses what is no longer true, and keeps what still is', async () => {
    const cookie = await signUpAdmin('fernando')
    for (const slug of ['igdb', 'tmdb']) {
      store.emit({
        audience: 'instance',
        severity: 'warning',
        kind: 'provider-missing-key',
        params: { providerSlug: slug },
        dedupeKey: dedupeKey('instance', 'art-cache-full', slug),
      })
    }

    store.dismissResolved('instance:art-cache-full:', [
      dedupeKey('instance', 'art-cache-full', 'tmdb'),
    ])

    const open = (await (await list(cookie)).json()).notifications
    expect(open).toHaveLength(1)
    expect(open[0].params.providerSlug).toBe('tmdb')
    // E o resolvido continua no histórico: o evento aconteceu.
    expect(
      (await (await list(cookie, '?include=all')).json()).notifications,
    ).toHaveLength(2)
  })

  it('never touches a group it does not own', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'art-cache-full',
      params: {},
      dedupeKey: dedupeKey('instance', 'art-cache-full'),
    })

    // Um reconciliador de provedor rodando sem nenhuma condição verdadeira não
    // pode dispensar o aviso do cache só por não saber dele.
    store.dismissResolved('instance:provider-', [])

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })
})

describe('paginação', () => {
  it('pages with a cursor and stops', async () => {
    const cookie = await signUpAdmin('fernando')
    for (let i = 0; i < 5; i++) {
      store.emit({
        audience: 'instance',
        severity: 'info',
        kind: 'provider-missing-key',
        params: { n: i },
      })
    }

    const first = await (await list(cookie, '?limit=2')).json()
    expect(first.notifications).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await (
      await list(cookie, `?limit=2&cursor=${first.nextCursor}`)
    ).json()
    expect(second.notifications).toHaveLength(2)

    const third = await (
      await list(cookie, `?limit=2&cursor=${second.nextCursor}`)
    ).json()
    expect(third.notifications).toHaveLength(1)
    expect(third.nextCursor).toBeNull()
  })
})

describe('params ilegível', () => {
  it('degrades to an empty object instead of a 500', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'info',
      kind: 'provider-missing-key',
      params: {},
    })
    db.update(notifications).set({ params: 'não é json' }).run()

    const res = await list(cookie)

    expect(res.status).toBe(200)
    expect((await res.json()).notifications[0].params).toEqual({})
  })
})

describe('reconciliação de condições de instância', () => {
  /** Religa um provedor a um tipo — é o que o torna "em uso". */
  function serve(providerSlug: string, mediaTypeSlug: string) {
    db.insert(mediaTypeProviders).values({ providerSlug, mediaTypeSlug }).run()
  }

  it('emits a warning for a provider in use with no key', async () => {
    const cookie = await signUpAdmin('fernando')
    serve('igdb', 'game')

    const body = await (await list(cookie)).json()

    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0]).toMatchObject({
      audience: 'instance',
      severity: 'warning',
      kind: 'provider-missing-key',
      params: { providerSlug: 'igdb' },
    })
  })

  /**
   * É este recorte que torna o sinal possível: toda instalação semeia provedor
   * que o dono não usa, e um aviso que nunca apaga ensina a ser ignorado.
   */
  it('says nothing about a provider that serves no type', async () => {
    const cookie = await signUpAdmin('fernando')

    expect((await (await list(cookie)).json()).notifications).toEqual([])
  })

  it('emits once, no matter how many times the app is read', async () => {
    const cookie = await signUpAdmin('fernando')
    serve('igdb', 'game')

    for (let i = 0; i < 4; i++) {
      await list(cookie)
    }

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })

  it('dismisses the condition by itself once it is resolved', async () => {
    const cookie = await signUpAdmin('fernando')
    serve('igdb', 'game')
    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)

    // O provedor deixa de servir tipo nenhum: a condição some, e some sozinha.
    db.delete(mediaTypeProviders).run()

    expect((await (await list(cookie)).json()).notifications).toEqual([])
    // E fica no histórico, porque o evento aconteceu.
    const history = (await (await list(cookie, '?include=all')).json())
      .notifications
    expect(history).toHaveLength(1)
    expect(history[0].dismissed).toBe(true)
  })

  it('brings the condition back when it becomes true again', async () => {
    const cookie = await signUpAdmin('fernando')
    serve('igdb', 'game')
    await list(cookie)
    db.delete(mediaTypeProviders).run()
    await list(cookie)

    serve('igdb', 'game')

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
    expect(
      (await (await list(cookie, '?include=all')).json()).notifications,
    ).toHaveLength(2)
  })

  /**
   * O reconciliador conhece um grupo só. Sem o prefixo ele dispensaria o aviso
   * do cache de arte só por não saber dele.
   */
  it('never dismisses a notification from another group', async () => {
    const cookie = await signUpAdmin('fernando')
    store.emit({
      audience: 'instance',
      severity: 'warning',
      kind: 'art-cache-full',
      params: {},
      dedupeKey: dedupeKey('instance', 'art-cache-full'),
    })

    await list(cookie)

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })

  /** Reconciliar pra quem não vê notificação de instância seria trabalho pra ninguém. */
  it('does not reconcile for a non-admin', async () => {
    await signUpAdmin('fernando')
    const member = await signUpMember('outra')
    serve('igdb', 'game')

    await list(member)

    expect(db.select().from(notifications).all()).toEqual([])
  })

  /** O sino fica na tela o tempo todo; o painel abre de vez em quando. */
  it('also reconciles when only the bell counter is asked for', async () => {
    const cookie = await signUpAdmin('fernando')
    serve('igdb', 'game')

    const counter = await (await unread(cookie)).json()

    expect(counter).toEqual({ count: 1, severity: 'warning' })
  })
})

describe('o fato que acontece uma vez na vida da instalação', () => {
  const key = dedupeKey('instance', 'art-cache-full')

  function emitOnce() {
    store.emitOnce({
      audience: 'instance',
      severity: 'warning',
      kind: 'art-cache-full',
      params: { limitBytes: 268_435_456 },
      dedupeKey: key,
    })
  }

  it('emits the first time and never again', async () => {
    const cookie = await signUpAdmin('fernando')

    for (let i = 0; i < 5; i++) {
      emitOnce()
    }

    expect((await (await list(cookie)).json()).notifications).toHaveLength(1)
  })

  /**
   * É o que separa este aviso das condições de provedor: aquelas voltam a ser
   * verdade e voltam a avisar; esta não zera nunca, porque o cache fica cheio
   * pra sempre. Um aviso que voltasse depois de cada dispensa seria sinal que a
   * pessoa não consegue apagar (brief, 3.9).
   */
  it('stays dismissed, unlike a condition', async () => {
    const cookie = await signUpAdmin('fernando')
    emitOnce()
    const one = (await (await list(cookie)).json()).notifications[0]
    await dismiss(cookie, one.id)

    emitOnce()

    expect((await (await list(cookie)).json()).notifications).toEqual([])
    expect(
      (await (await list(cookie, '?include=all')).json()).notifications,
    ).toHaveLength(1)
  })
})

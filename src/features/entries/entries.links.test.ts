import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { artCache } from '../../db/schema/art-cache.js'
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

/**
 * A obra de OUTRA pessoa, criada direto no banco.
 *
 * `/api/setup/account` só serve pro primeiro usuário e não há rota de registro,
 * então o segundo entra por aqui — mesmo caminho que `entries.test.ts` usa. E
 * a asserção fica invertida de propósito: quem AGE é sempre a sessão real, e o
 * alvo é que é alheio.
 */
function entryOfSomeoneElse(mediaType: string, title: string): number {
  const other = db
    .insert(users)
    .values({
      username: `other-${Date.now()}-${Math.random()}`,
      passwordHash: 'x',
      isAdmin: false,
    })
    .returning()
    .get()
  return db
    .insert(entries)
    .values({ userId: other.id, mediaType, title })
    .returning()
    .get().id
}

async function createEntry(
  cookie: string,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  const { id } = (await res.json()) as { id: number }
  return id
}

type Link = {
  provider: { slug: string; name: string }
  externalId: string
  effective: boolean
  chosen: boolean
}

async function listLinks(cookie: string, id: number) {
  const res = await app.request(`/api/entries/${id}/links`, {
    headers: { Cookie: cookie },
  })
  return { status: res.status, body: (await res.json()) as Link[] }
}

async function link(cookie: string, id: number, body: Record<string, unknown>) {
  const res = await app.request(`/api/entries/${id}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function promote(cookie: string, id: number, provider: string) {
  const res = await app.request(
    `/api/entries/${id}/links/${provider}/primary`,
    {
      method: 'PUT',
      headers: { Cookie: cookie },
    },
  )
  return { status: res.status, body: (await res.json()) as Link[] }
}

async function unlink(cookie: string, id: number, provider: string) {
  const res = await app.request(`/api/entries/${id}/links/${provider}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  })
  return res.status
}

afterEach(() => {
  vi.restoreAllMocks()
  db.update(providers).set({ credentialValues: {} }).run()
})

beforeEach(() => {
  db.delete(artCache).run()
  db.delete(eventLog).run()
  db.delete(piles).run()
  // `external_ids` sai por cascade de `entries`, mas some antes por clareza:
  // é a tabela que este arquivo inteiro observa.
  db.delete(externalIds).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
  db.delete(settings).run()
})

describe('GET /api/entries/{id}/links', () => {
  it('a obra digitada à mão não tem vínculo nenhum', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Solaris',
    })

    const { status, body } = await listLinks(cookie, id)

    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  it('devolve o NOME do provedor, não só o slug', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId: '550' },
    })

    const { body } = await listLinks(cookie, id)

    // Slug é chave, não rótulo: sem o nome a caixa escreveria `tmdb`.
    expect(body).toEqual([
      {
        provider: { slug: 'tmdb', name: 'TMDB' },
        externalId: '550',
        effective: true,
        // Falar daqui por ser o único não é ter sido ESCOLHIDO.
        chosen: false,
      },
    ])
  })

  it('obra de outra pessoa é 404', async () => {
    const cookie = await signUp('fernando')
    const ofSomeoneElse = entryOfSomeoneElse('movie', 'Solaris')

    expect((await listLinks(cookie, ofSomeoneElse)).status).toBe(404)
  })
})

describe('POST /api/entries/{id}/links', () => {
  it('vincula uma obra que já existe, e ela passa a falar dali', async () => {
    const cookie = await signUp('fernando')
    // O caso que o brief cita: a obra digitada à mão antes de haver provedor.
    const id = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
    })

    const { status, body } = await link(cookie, id, {
      provider: 'tmdb',
      externalId: '550',
    })

    expect(status).toBe(201)
    expect(body).toEqual({
      provider: { slug: 'tmdb', name: 'TMDB' },
      externalId: '550',
      effective: true,
      chosen: false,
    })
    expect((await listLinks(cookie, id)).body).toHaveLength(1)
  })

  it('provedor desconhecido é 400, não 500 na chave estrangeira', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, { mediaType: 'movie', title: 'X' })

    const { status } = await link(cookie, id, {
      provider: 'nao-existe',
      externalId: '1',
    })

    expect(status).toBe(400)
  })

  it('recusa provedor que não serve o TIPO desta obra', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'manga',
      title: 'Berserk',
    })

    // O TMDB existe e serve filme e série — nunca mangá. Um vínculo assim
    // nasceria ilegível: o detalhe pediria o id ao endpoint errado.
    const { status } = await link(cookie, id, {
      provider: 'tmdb',
      externalId: '550',
    })

    expect(status).toBe(400)
    expect(
      db.select().from(externalIds).where(eq(externalIds.entryId, id)).all(),
    ).toHaveLength(0)
  })

  it('recusa o SEGUNDO vínculo com o mesmo provedor', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId: '550' },
    })

    const { status, body } = await link(cookie, id, {
      provider: 'tmdb',
      externalId: '551',
    })

    expect(status).toBe(409)
    // Sem `entryId`: é ESTA obra que já tem o vínculo, e a tela não tem pra
    // onde apontar. Trocar de id é desvincular e vincular de novo.
    expect(body).not.toHaveProperty('entryId')
  })

  it('recusa o id externo que já é de OUTRA obra, e diz qual', async () => {
    const cookie = await signUp('fernando')
    const existing = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
      source: { provider: 'tmdb', externalId: '550' },
    })
    const duplicate = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Clube da Luta',
    })

    const { status, body } = await link(cookie, duplicate, {
      provider: 'tmdb',
      externalId: '550',
    })

    expect(status).toBe(409)
    // O `entryId` volta pra que a tela aponte pra obra que já tem o vínculo,
    // em vez de só dizer não — o app não tem toast.
    expect(body).toMatchObject({ entryId: existing })
  })

  it('o mesmo id externo em obras de PESSOAS diferentes é legítimo', async () => {
    const cookie = await signUp('fernando')
    const ofSomeoneElse = entryOfSomeoneElse('movie', 'Fight Club')
    db.insert(externalIds)
      .values({
        mediaType: 'movie',
        entryId: ofSomeoneElse,
        provider: 'tmdb',
        externalId: '550',
      })
      .run()

    const mine = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
    })

    // O único é (obra, provedor), e não (usuário, provedor, id): duas pessoas
    // têm o mesmo filme, e a biblioteca de uma não recusa a da outra.
    expect(
      (await link(cookie, mine, { provider: 'tmdb', externalId: '550' }))
        .status,
    ).toBe(201)
  })

  it('obra de outra pessoa é 404', async () => {
    const cookie = await signUp('fernando')
    const ofSomeoneElse = entryOfSomeoneElse('movie', 'Solaris')

    expect(
      (
        await link(cookie, ofSomeoneElse, {
          provider: 'tmdb',
          externalId: '550',
        })
      ).status,
    ).toBe(404)
    expect(
      db
        .select()
        .from(externalIds)
        .where(eq(externalIds.entryId, ofSomeoneElse))
        .all(),
    ).toHaveLength(0)
  })
})

/**
 * De qual vínculo a obra fala, com mais de um.
 *
 * ── Este bloco mudou de tese em 02/09/2026 ─────────────────────────────────
 * Ele nasceu afirmando que **o padrão do tipo ganha**, que era a cadeia de
 * três degraus. O dono do projeto tirou o padrão da escolha da obra, e a
 * afirmação virou a oposta: criar vínculo NÃO promove, e quem troca a fonte é
 * um ato explícito. Ver `entries.source.ts` pros três motivos.
 */
describe('o vínculo EFETIVO, com mais de um', () => {
  it('criar o segundo NÃO troca a fonte, mesmo sendo o padrão do tipo', async () => {
    const cookie = await signUp('fernando')
    // O padrão semeado pra `anime` é o AniList, e ele entra por ÚLTIMO aqui.
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })

    const { body: created } = await link(cookie, id, {
      provider: 'anilist',
      externalId: '1',
    })

    // É esta linha que impede a troca silenciosa: sinopse e arte continuam
    // vindo de onde vinham, e trocar isso é gesto de quem é dono da obra.
    expect((created as Link).effective).toBe(false)

    const { body } = await listLinks(cookie, id)
    expect(body.map(({ provider }) => provider.slug)).toEqual([
      'jikan',
      'anilist',
    ])
    expect(body.map(({ effective }) => effective)).toEqual([true, false])
  })

  it('promover troca a fonte, e marca que a escolha foi feita', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })
    await link(cookie, id, { provider: 'anilist', externalId: '1' })

    const { status, body } = await promote(cookie, id, 'anilist')

    expect(status).toBe(200)
    // A ordem da lista é de antiguidade e não muda; quem muda é a marca.
    expect(body.map(({ provider }) => provider.slug)).toEqual([
      'jikan',
      'anilist',
    ])
    expect(body.map(({ effective }) => effective)).toEqual([false, true])
    /**
     * `chosen` é o que separa "falo daqui porque fui o primeiro" de "falo daqui
     * porque me escolheram" — dois estados que `effective` sozinho confunde.
     */
    expect(body.map(({ chosen }) => chosen)).toEqual([false, true])
  })

  it('promover o que JÁ era o efetivo é aceito, e passa a resistir', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })

    const { status, body } = await promote(cookie, id, 'jikan')

    expect(status).toBe(200)
    // Não é no-op: antes ele falava por ser o mais antigo, agora por escolha —
    // e é isso que o faz sobreviver a um vínculo mais antigo aparecer depois.
    expect(body[0]?.chosen).toBe(true)
  })

  it('promover provedor a que a obra não está vinculada é 404', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })

    expect((await promote(cookie, id, 'kitsu')).status).toBe(404)
    // A escrita não aconteceu: aceitar e não ter efeito seria pior que recusar.
    expect(
      db.select().from(entries).where(eq(entries.id, id)).get()
        ?.primaryProvider,
    ).toBeNull()
  })

  it('obra de outra pessoa é 404 ao promover', async () => {
    const cookie = await signUp('fernando')
    const ofSomeoneElse = entryOfSomeoneElse('anime', 'Cowboy Bebop')
    db.insert(externalIds)
      .values({
        mediaType: 'anime',
        entryId: ofSomeoneElse,
        provider: 'jikan',
        externalId: '1',
      })
      .run()

    expect((await promote(cookie, ofSomeoneElse, 'jikan')).status).toBe(404)
  })

  it('override órfão cai fora em vez de zerar a fonte', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })
    // O estado que sobra quando o vínculo vai embora por fora da rota — um
    // `db:seed`, um acerto manual. `sourceOf` ignora o degrau e devolve a obra
    // ao mais antigo; devolver nulo apagaria arte e sinopse dela.
    db.update(entries)
      .set({ primaryProvider: 'kitsu' })
      .where(eq(entries.id, id))
      .run()

    const { body } = await listLinks(cookie, id)
    expect(body).toHaveLength(1)
    expect(body[0]?.effective).toBe(true)
    expect(body[0]?.chosen).toBe(false)
  })
})

describe('DELETE /api/entries/{id}/links/{provider}', () => {
  it('desvincula sem apagar a obra, o progresso nem o log', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'tv',
      title: 'Breaking Bad',
      source: { provider: 'tmdb', externalId: '1396' },
    })
    await app.request(`/api/entries/${id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ delta: 8 }),
    })

    expect(await unlink(cookie, id, 'tmdb')).toBe(204)

    // É o que a copy da confirmação promete: o vínculo é o que some.
    const entry = db.select().from(entries).where(eq(entries.id, id)).get()
    expect(entry?.progress).toBe(8)
    expect(
      db.select().from(eventLog).where(eq(eventLog.entryId, id)).all(),
    ).toHaveLength(1)
    expect((await listLinks(cookie, id)).body).toEqual([])
  })

  it('desvincular o que não estava vinculado é 404, não 204', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, { mediaType: 'movie', title: 'X' })

    // 204 diria que o pedido teve efeito, e quem errou o provedor ficaria sem
    // saber que errou.
    expect(await unlink(cookie, id, 'tmdb')).toBe(404)
  })

  it('a obra volta a falar do vínculo que SOBROU', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })
    await link(cookie, id, { provider: 'anilist', externalId: '1' })
    await promote(cookie, id, 'anilist')

    expect(await unlink(cookie, id, 'anilist')).toBe(204)

    const { body } = await listLinks(cookie, id)
    expect(body).toHaveLength(1)
    expect(body[0]?.provider.slug).toBe('jikan')
    expect(body[0]?.effective).toBe(true)
  })

  it('desvincular o promovido LIMPA a escolha, em vez de deixá-la pendurada', async () => {
    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'anime',
      title: 'Cowboy Bebop',
      source: { provider: 'jikan', externalId: '1' },
    })
    await link(cookie, id, { provider: 'anilist', externalId: '1' })
    await promote(cookie, id, 'anilist')
    await unlink(cookie, id, 'anilist')

    /**
     * Sem a limpeza a coluna fica apontando pro que saiu, e **revincular aquele
     * mesmo provedor mais tarde o promoveria sozinho** — honrando uma escolha
     * que a pessoa desfez quando desvinculou.
     */
    expect(
      db.select().from(entries).where(eq(entries.id, id)).get()
        ?.primaryProvider,
    ).toBeNull()

    await link(cookie, id, { provider: 'anilist', externalId: '1' })
    const { body } = await listLinks(cookie, id)
    expect(
      body.find(({ provider }) => provider.slug === 'anilist')?.effective,
    ).toBe(false)
  })

  it('obra de outra pessoa é 404, e o vínculo dela fica', async () => {
    const cookie = await signUp('fernando')
    const ofSomeoneElse = entryOfSomeoneElse('movie', 'Fight Club')
    db.insert(externalIds)
      .values({
        mediaType: 'movie',
        entryId: ofSomeoneElse,
        provider: 'tmdb',
        externalId: '550',
      })
      .run()

    expect(await unlink(cookie, ofSomeoneElse, 'tmdb')).toBe(404)
    expect(
      db
        .select()
        .from(externalIds)
        .where(eq(externalIds.entryId, ofSomeoneElse))
        .all(),
    ).toHaveLength(1)
  })
})

describe('o vínculo novo aquece o cache de arte', () => {
  /**
   * **A prova é a IDA À REDE, não a linha no banco.**
   *
   * O que se afirma aqui é que o caminho está ligado: vincular dispara a busca
   * da arte em segundo plano. Esperar a linha de `art_cache` aparecer
   * dependeria de o dublê responder detalhe e imagem na ordem certa — isso já
   * está provado em `art.warm.test.ts`, com o dublê inteiro. Aqui o que faltava
   * era o fio: o handler chama, ou não chama.
   *
   * Sem isto, o aquecimento continuaria existindo e simplesmente **não seria
   * disparado** por este caminho — que é a forma mais silenciosa de uma feature
   * morrer, porque nada quebra.
   */
  it('vincular dispara a busca sem segurar a resposta', async () => {
    // Sem credencial o cliente recusa ANTES de tocar na rede — e está certo.
    // O que este teste quer ver é o fio ligado, então a chave precisa existir.
    db.update(providers)
      .set({ credentialValues: { api_key: 'chave-de-teste' } })
      .where(eq(providers.slug, 'tmdb'))
      .run()

    const cookie = await signUp('fernando')
    const id = await createEntry(cookie, {
      mediaType: 'movie',
      title: 'Fight Club',
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    const { status } = await link(cookie, id, {
      provider: 'tmdb',
      externalId: '550',
    })

    // A resposta não espera pela rede: ela sai antes de a arte existir.
    expect(status).toBe(201)
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
  })
})

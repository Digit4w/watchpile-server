import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../../app.js'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { importJobs } from '../../db/schema/import-jobs.js'
import { notifications } from '../../db/schema/notifications.js'
import { providers } from '../../db/schema/providers.js'
import { sessions } from '../../db/schema/sessions.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'
import * as jobs from './import.jobs.js'

/**
 * O contrato de `/api/import`.
 *
 * Aqui se prova o que a TELA vê: o 202 que troca o formulário pelo cartão de
 * "rodando", o 409 que anuncia que já há uma importação, e o `GET /status` que
 * responde as duas metades da tela numa rota só.
 */

const CABECALHO =
  'media_type,title,status,progress,total,source,external_id,updated_at'

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('Response has no Set-Cookie header')
  }
  return setCookie.split(';')[0] ?? ''
}

async function signUpAdmin(username = 'fernando'): Promise<string> {
  const res = await app.request('/api/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  return cookieFrom(res)
}

/**
 * O segundo usuário nasce direto no banco porque `/api/setup/account` só
 * responde com o banco sem usuário nenhum, e **não existe rota de registro** —
 * `settings.registration_open` está na tabela desde a primeira migration e
 * nenhuma rota a lê. O login depois é o de verdade.
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

function userIdOf(username: string): number {
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

function postCsv(cookie: string, linhas: string[], mode?: string) {
  const query = mode ? `?mode=${mode}` : ''
  return app.request(`/api/import/csv${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', cookie },
    body: [CABECALHO, ...linhas].join('\n'),
  })
}

const getStatus = (cookie: string) =>
  app.request('/api/import/status', { headers: { cookie } })

/**
 * O job roda em segundo plano, sem `await` na rota. Cede o event loop até ele
 * terminar — é a mesma cessão que o executor faz entre lotes.
 */
async function esperarFim(): Promise<void> {
  for (let i = 0; i < 50 && jobs.running(); i += 1) {
    await new Promise((r) => setImmediate(r))
  }
}

beforeEach(() => {
  /**
   * **`providers` não tem `user_id`, então nada a leva junto** — é a régua de
   * 07/09/2026, quando um `title_snapshots` sobrevivente fez um teste de RECUSA
   * passar como sucesso. Aqui o risco é o simétrico: o caso que escreve uma
   * credencial de MyAnimeList deixaria a fonte disponível para o teste seguinte,
   * e o que afirma `not-configured` passaria a depender da ORDEM do arquivo.
   */
  db.update(providers).set({ credentialValues: {} }).run()
  db.delete(importJobs).run()
  db.delete(notifications).run()
  db.delete(entries).run()
  db.delete(sessions).run()
  db.delete(users).run()
})

describe('a sessão', () => {
  it('recusa as três rotas sem sessão', async () => {
    expect((await app.request('/api/import/status')).status).toBe(401)
    expect((await postCsv('', ['anime,A,watching,,,,,'])).status).toBe(401)
    expect(
      (await app.request('/api/import/1/cancel', { method: 'POST' })).status,
    ).toBe(401)
  })
})

describe('POST /api/import/csv', () => {
  it('responde 202 com o job, e a tela já tem o que desenhar', async () => {
    // 202 e não 201: o pedido foi ACEITO e o trabalho começou — ele não
    // terminou. O corpo é o job recém-criado, que é o que troca o formulário
    // pelo cartão de "rodando" sem esperar um poll.
    const cookie = await signUpAdmin()

    const res = await postCsv(cookie, ['anime,Frieren,watching,4,28,,,'])
    expect(res.status).toBe(202)

    const job = await res.json()
    expect(job).toMatchObject({
      source: 'csv',
      mode: 'skip',
      status: 'running',
      processed: 0,
      problems: [],
      errorKind: null,
    })

    await esperarFim()
  })

  it('importa de verdade, e a obra aparece na biblioteca', async () => {
    const cookie = await signUpAdmin()

    await postCsv(cookie, [
      'anime,Frieren,watching,4,28,anilist,154587,',
      'manga,Berserk,on-hold,380,,,,',
    ])
    await esperarFim()

    const { latest } = await (await getStatus(cookie)).json()
    expect(latest).toMatchObject({
      status: 'done',
      total: 2,
      processed: 2,
      added: 2,
      // A segunda entrou sem id — recorte de `added`.
      unmatched: 1,
    })

    const biblioteca = db.select().from(entries).all()
    expect(biblioteca.map((e) => e.title).sort()).toEqual([
      'Berserk',
      'Frieren',
    ])
  })

  it('`mode` vem da query, e `overwrite` atravessa até o resultado', async () => {
    const cookie = await signUpAdmin()

    await postCsv(cookie, ['anime,Frieren,watching,4,28,anilist,154587,'])
    await esperarFim()

    const res = await postCsv(
      cookie,
      ['anime,Frieren,completed,28,28,anilist,154587,'],
      'overwrite',
    )
    expect(res.status).toBe(202)
    await esperarFim()

    const { latest } = await (await getStatus(cookie)).json()
    expect(latest).toMatchObject({ mode: 'overwrite', updated: 1, added: 0 })

    const [obra] = db.select().from(entries).all()
    expect(obra).toMatchObject({ progress: 28, status: 'completed' })
  })

  it('recusa corpo vazio com 400', async () => {
    const cookie = await signUpAdmin()
    const res = await app.request('/api/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie },
      body: '   ',
    })
    expect(res.status).toBe(400)
  })

  it('o arquivo que não é o nosso derruba o JOB, não a requisição', async () => {
    // A requisição foi válida — 202. O que falhou foi a leitura, e isso vira
    // estado do job com um `kind`, que é informação pra tela em vez de um erro
    // HTTP que ela teria de traduzir.
    const cookie = await signUpAdmin()

    const res = await app.request('/api/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', cookie },
      body: 'media_type,title\nanime,Frieren',
    })
    expect(res.status).toBe(202)
    await esperarFim()

    const { latest } = await (await getStatus(cookie)).json()
    expect(latest).toMatchObject({
      status: 'failed',
      errorKind: 'invalid-file',
      errorParams: { missing: 'status' },
    })
  })

  it('a linha ruim vira problema com `kind` e LINHA, nunca frase', async () => {
    const cookie = await signUpAdmin()

    await postCsv(cookie, [
      'anime,A,watching,,,,,',
      'anime,B,Rewatching,,,,,',
      'anime,C,watching,twelve,,,,',
    ])
    await esperarFim()

    const { latest } = await (await getStatus(cookie)).json()
    expect(latest.problemCount).toBe(2)
    expect(latest.problems).toEqual([
      { kind: 'invalid-status', row: 3, params: { value: 'Rewatching' } },
      {
        kind: 'invalid-number',
        row: 4,
        params: { field: 'progress', value: 'twelve' },
      },
    ])
  })
})

describe('uma importação por vez', () => {
  it('recusa a segunda com 409, mesmo de OUTRA pessoa', async () => {
    // O limite é do RECURSO: o `better-sqlite3` é síncrono e o banco é um
    // arquivo só, então quem importa congela o servidor de todo mundo. Quem
    // recusa é o índice único parcial da 0035, não um SELECT antes do INSERT.
    const admin = await signUpAdmin('fernando')
    const outra = await signUpMember('outra-pessoa')

    const muitas = Array.from(
      { length: 1200 },
      (_, i) => `anime,Obra ${i},watching,1,12,,,`,
    )
    expect((await postCsv(admin, muitas)).status).toBe(202)

    const segunda = await postCsv(outra, ['anime,X,watching,,,,,'])
    expect(segunda.status).toBe(409)

    await esperarFim()
  })

  it('o status diz que há uma rodando, sem dizer de QUEM', async () => {
    // A tela de quem não é dono precisa saber que o recurso está ocupado. O
    // nome de quem ocupa não viaja: o fato que impede é a ocupação.
    const admin = await signUpAdmin('fernando')
    const outra = await signUpMember('outra-pessoa')

    const muitas = Array.from(
      { length: 1200 },
      (_, i) => `anime,Obra ${i},watching,1,12,,,`,
    )
    await postCsv(admin, muitas)

    const visto = await (await getStatus(outra)).json()
    expect(visto.running).not.toBeNull()
    expect(visto.mine).toBe(false)
    expect(JSON.stringify(visto)).not.toContain('fernando')
    // Ela não tem importação nenhuma, então não há resultado pra mostrar.
    expect(visto.latest).toBeNull()

    await esperarFim()
  })

  it('libera assim que a primeira termina', async () => {
    const cookie = await signUpAdmin()

    await postCsv(cookie, ['anime,A,watching,,,,,'])
    await esperarFim()

    expect((await postCsv(cookie, ['anime,B,watching,,,,,'])).status).toBe(202)
    await esperarFim()
  })
})

describe('POST /api/import/{id}/cancel', () => {
  it('pede a parada, e o job termina como `cancelled`', async () => {
    const cookie = await signUpAdmin()

    const muitas = Array.from(
      { length: 1500 },
      (_, i) => `anime,Obra ${i},watching,1,12,,,`,
    )
    const criado = await (await postCsv(cookie, muitas)).json()

    const res = await app.request(`/api/import/${criado.id}/cancel`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(res.status).toBe(200)

    // Pedido não é estado: o status segue `running` até o laço reparar nele.
    const parcial = await res.json()
    expect(parcial.status).toBe('running')
    expect(parcial.cancelRequestedAt).not.toBeNull()

    await esperarFim()

    const { latest } = await (await getStatus(cookie)).json()
    expect(latest.status).toBe('cancelled')
    // Cancelar interrompe, não desfaz.
    expect(latest.added).toBeGreaterThan(0)
    expect(latest.added).toBeLessThan(1500)
  })

  it('dá a MESMA resposta para job de outra pessoa e para job inexistente', async () => {
    // Distinguir "não é seu" de "não existe" diria a quem não é dono que existe
    // um job daquele id, e isso não é dela.
    const admin = await signUpAdmin('fernando')
    const outra = await signUpMember('outra-pessoa')

    const muitas = Array.from(
      { length: 1200 },
      (_, i) => `anime,Obra ${i},watching,1,12,,,`,
    )
    const criado = await (await postCsv(admin, muitas)).json()

    const alheio = await app.request(`/api/import/${criado.id}/cancel`, {
      method: 'POST',
      headers: { cookie: outra },
    })
    const inexistente = await app.request('/api/import/999999/cancel', {
      method: 'POST',
      headers: { cookie: outra },
    })

    expect(alheio.status).toBe(409)
    expect(inexistente.status).toBe(409)
    expect(await alheio.json()).toEqual(await inexistente.json())

    await esperarFim()
  })
})

describe('GET /api/import/status', () => {
  it('começa vazio dos dois lados', async () => {
    const cookie = await signUpAdmin()
    const { running, mine, latest } = await (await getStatus(cookie)).json()
    expect({ running, mine, latest }).toEqual({
      running: null,
      mine: false,
      latest: null,
    })
  })

  it('diz o que esta instalação consegue importar, e por que não', async () => {
    /**
     * **A recusa se anuncia antes do clique** (design system, seção 5), e é
     * para isso que `sources` existe: sem ela, descobrir que uma fonte não pode
     * rodar exigiria clicar e receber um 503 que não teria onde aparecer — o
     * app não tem toast.
     *
     * **Este caso testa a DERIVAÇÃO, não o que o produto embarca** — e ele
     * mudou de forma em 08/09/2026, quando o Client ID do MyAnimeList saiu do
     * repositório e passou a entrar no build (`providers.embedded.ts`).
     *
     * A versão anterior afirmava `mal: available` porque o literal estava na
     * árvore, e **a suíte passava por causa de uma chave de produção**. O
     * acoplamento só apareceu quando ela saiu — que é o argumento de sempre
     * para um teste declarar o que precisa em vez de herdar do ambiente.
     *
     * `unverified` ficou sem emissor ao AniList ser ligado em 07/09.
     */
    const cookie = await signUpAdmin()
    const { sources } = await (await getStatus(cookie)).json()

    expect(sources).toEqual([
      { slug: 'csv', available: true, reason: null },
      /**
       * **Sem credencial, o MyAnimeList recusa antes do clique** — que é o que
       * uma instalação construída da FONTE encontra, e o que a nossa imagem
       * publicada não encontra, porque o CI preenche a chave. A tela oferece
       * Providers, e é para isso que `not-configured` existe.
       */
      { slug: 'mal', available: false, reason: 'not-configured' },
      /**
       * **Ligado em 07/09/2026, por decisão do dono.** Ele era `unverified` por
       * uma constante — cautela minha por a fonte nunca ter sido medida —, e não
       * por um fato observado: nada ali reagia à API deles voltar. O primeiro
       * import de verdade passa a ser a medição.
       *
       * Ele não pede credencial, então a saída do Client ID não o alcança.
       */
      { slug: 'anilist', available: true, reason: null },
    ])
  })

  /**
   * O outro lado da derivação, e é ele que a imagem publicada exercita: com a
   * credencial presente — venha ela do CI, do env de quem hospeda ou do
   * formulário de Settings — a fonte fica disponível.
   *
   * **Os dois casos juntos é que provam a regra.** Um só provaria o estado
   * daquele build, que é exatamente o que a versão anterior deste teste fazia
   * sem dizer.
   */
  it('oferece o MyAnimeList assim que há credencial, de onde quer que ela venha', async () => {
    const cookie = await signUpAdmin()
    db.update(providers)
      .set({ credentialValues: { client_id: 'chave-de-teste' } })
      .where(eq(providers.slug, 'mal'))
      .run()

    const { sources } = await (await getStatus(cookie)).json()

    expect(sources).toContainEqual({
      slug: 'mal',
      available: true,
      reason: null,
    })
  })

  it('fecha o ZUMBI na leitura, e destrava a instalação', async () => {
    // Uma linha `running` que este processo não está executando é um import
    // interrompido. Sem alguém pra limpar, o índice único — que existe pra
    // proteger o servidor — trancaria a instalação depois de um restart.
    const cookie = await signUpAdmin()
    const userId = userIdOf('fernando')
    jobs.start({ userId, source: 'csv', mode: 'skip' })

    const { running, latest } = await (await getStatus(cookie)).json()
    expect(running).toBeNull()
    expect(latest).toMatchObject({ status: 'failed', errorKind: 'interrupted' })

    // E a próxima importação passa.
    expect((await postCsv(cookie, ['anime,A,watching,,,,,'])).status).toBe(202)
    await esperarFim()
  })

  it('avisa por notificação quando termina, com audiência de usuário', async () => {
    const cookie = await signUpAdmin()
    await postCsv(cookie, ['anime,A,watching,3,12,,,'])
    await esperarFim()

    const [aviso] = db.select().from(notifications).all()
    expect(aviso).toMatchObject({
      audience: 'user',
      severity: 'info',
      kind: 'import-finished',
    })
    expect(JSON.parse(aviso?.params ?? '{}')).toMatchObject({
      source: 'csv',
      added: 1,
    })
  })
})

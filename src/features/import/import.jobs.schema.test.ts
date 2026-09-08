import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/client.js'
import { importJobs } from '../../db/schema/import-jobs.js'
import { users } from '../../db/schema/users.js'
import { hashPassword } from '../auth/auth.crypto.js'

/**
 * **Mora aqui, e não ao lado do schema, por um motivo mecânico.**
 * `drizzle.config.ts` varre `src/db/schema/*.ts`, então um teste ali dentro é
 * carregado pelo drizzle-kit — que não conhece o vitest e morre ao gerar
 * migration. Ficou latente por dois commits, porque nada entre eles regerou
 * uma. A feature que depende da invariante é quem a guarda.
 *
 * O índice `import_jobs_one_running` é o único lugar do schema em que uma regra
 * de PRODUTO — "uma importação por vez" — vive como constraint em vez de código.
 * O executor vai depender dela pra não precisar consultar-antes-de-inserir, e
 * uma constraint em que se confia sem teste é uma suposição com sintaxe de SQL.
 *
 * **Índice parcial carrega semântica que a leitura não confirma.** Foi assim que
 * a `0034` quase deduplicou nada: em SQLite dois `NULL` são DISTINTOS num índice
 * único, e o `(user_id, dedupe_key)` que parecia certo não deduplicaria
 * exatamente onde importava — sem erro nenhum. O que protege é exercitar.
 */

function criarUsuario(username: string): number {
  const [row] = db
    .insert(users)
    .values({ username, passwordHash: hashPassword('password123') })
    .returning({ id: users.id })
    .all()

  if (!row) {
    throw new Error('insert returned no row')
  }
  return row.id
}

function iniciar(userId: number) {
  return db
    .insert(importJobs)
    .values({ userId, source: 'anilist', mode: 'skip', status: 'running' })
    .returning({ id: importJobs.id })
    .all()
}

beforeEach(() => {
  db.delete(importJobs).run()
  db.delete(users).run()
})

describe('import_jobs, "uma importação por vez"', () => {
  it('aceita a primeira que roda', () => {
    expect(iniciar(criarUsuario('fernando'))).toHaveLength(1)
  })

  it('recusa a segunda, mesmo de OUTRO usuário', () => {
    // O limite é do RECURSO — o `better-sqlite3` é síncrono e o banco é um
    // arquivo só, então quem importa congela o servidor de todo mundo. Este é o
    // caso que um índice `(user_id, status)` deixaria passar, e é por ele que o
    // índice não leva `user_id`.
    iniciar(criarUsuario('fernando'))

    expect(() => iniciar(criarUsuario('outra-pessoa'))).toThrow(
      /UNIQUE constraint failed/,
    )
  })

  it('aceita quantas já terminaram', () => {
    const userId = criarUsuario('fernando')
    const terminada = (status: 'done' | 'failed' | 'cancelled') =>
      db
        .insert(importJobs)
        .values({ userId, source: 'csv', mode: 'skip', status })
        .run()

    // O `WHERE status = 'running'` tira as terminadas do índice: a instalação
    // acumula histórico sem nunca esbarrar no limite.
    expect(() => {
      terminada('done')
      terminada('done')
      terminada('failed')
      terminada('cancelled')
    }).not.toThrow()
  })

  it('libera assim que a anterior fecha', () => {
    const userId = criarUsuario('fernando')
    iniciar(userId)

    db.update(importJobs)
      .set({ status: 'done' })
      .where(eq(importJobs.status, 'running'))
      .run()

    expect(iniciar(userId)).toHaveLength(1)
  })

  it('não consome o autoincrement quando recusa', () => {
    // Contraste com o que a `0034` ensinou: `onConflictDoNothing` CONSOME o id
    // mesmo sem inserir, e ali os ids saltavam de quatro em quatro. Aqui a
    // inserção é revertida, então o histórico não ganha buracos — o que importa
    // porque o id do job aparece na URL de cancelar.
    const userId = criarUsuario('fernando')
    const [primeira] = iniciar(userId)

    expect(() => iniciar(criarUsuario('outra-pessoa'))).toThrow()

    db.update(importJobs).set({ status: 'done' }).run()
    const [segunda] = iniciar(userId)

    expect(segunda?.id).toBe((primeira?.id ?? 0) + 1)
  })
})

describe('import_jobs, o que a linha guarda', () => {
  it('começa com os contadores zerados e o total desconhecido', () => {
    // `total` é NULO até a fonte responder — no AniList a coleção vem numa
    // resposta só, no MAL paginada, no CSV depois de ler o arquivo. Zero seria
    // uma mentira com cara de dado: o contador da tela esconde o denominador
    // enquanto ele for nulo.
    const userId = criarUsuario('fernando')
    const [criada] = iniciar(userId)

    const [job] = db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, criada?.id ?? 0))
      .all()

    expect(job).toMatchObject({
      total: null,
      processed: 0,
      added: 0,
      skipped: 0,
      updated: 0,
      unmatched: 0,
      problemCount: 0,
      problems: '[]',
      errorKind: null,
      cancelRequestedAt: null,
      finishedAt: null,
    })
  })

  it('some junto com o usuário', () => {
    // Import é conteúdo, e conteúdo é do usuário (brief, 3.9) — o histórico de
    // importação de uma conta apagada não é fato da instalação.
    const userId = criarUsuario('fernando')
    iniciar(userId)

    db.delete(users).where(eq(users.id, userId)).run()

    expect(db.select().from(importJobs).all()).toHaveLength(0)
  })
})

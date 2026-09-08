import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { importJobs } from '../../db/schema/import-jobs.js'
import type {
  ImportFailureKind,
  ImportMode,
  ImportProblem,
  ImportSourceSlug,
} from './import.types.js'

/**
 * Leitura e escrita de `import_jobs`. Separado do executor pelo mesmo motivo
 * que a store de notificações é separada dos handlers: quem escreve aqui não é
 * só a rota — o executor escreve a cada lote, e a reconciliação de zumbis
 * escreve sem ninguém ter pedido.
 */

export type Job = typeof importJobs.$inferSelect

/**
 * Quantos itens por lote.
 *
 * O que o número controla é **por quanto tempo o event loop fica preso**: cada
 * item é um punhado de escritas síncronas do `better-sqlite3`, e entre lotes o
 * executor cede pra que `GET /api/import/status` — e todo o resto do app —
 * consiga responder. 200 mantém o lote na casa de dezenas de milissegundos.
 *
 * Menor não é melhor: cada lote paga uma escrita de contadores, e um lote de 1
 * transformaria o import em duas escritas por obra.
 */
export const BATCH_SIZE = 200

/**
 * Quantos problemas a linha guarda.
 *
 * **A lista tem teto e a contagem não.** Um CSV ruim produz um problema por
 * linha, e sem teto a coluna cresce junto com o arquivo — numa linha que a tela
 * relê a cada poll enquanto o job roda. Depois do vigésimo problema o padrão já
 * apareceu, e o que a pessoa precisa saber é *quantos*, que `problem_count`
 * responde sem teto nenhum.
 */
export const MAX_STORED_PROBLEMS = 100

export function start(input: {
  userId: number
  source: ImportSourceSlug
  mode: ImportMode
}): Job {
  // Sem consultar-antes-de-inserir: quem garante "uma por vez" é o índice
  // único parcial (`0035`), e um `SELECT` antes deixaria a corrida de pé.
  // O erro de constraint sobe, e a rota o traduz em 409.
  const [job] = db
    .insert(importJobs)
    .values({ ...input, status: 'running' })
    .returning()
    .all()

  if (!job) {
    throw new Error('insert returned no row')
  }
  return job
}

/** O job em andamento da instalação — no máximo um, por construção. */
export function running(): Job | undefined {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.status, 'running'))
    .get()
}

/** A última importação desta pessoa, rodando ou não. */
export function latestFor(userId: number): Job | undefined {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.startedAt), desc(importJobs.id))
    .get()
}

export function byId(id: number): Job | undefined {
  return db.select().from(importJobs).where(eq(importJobs.id, id)).get()
}

export function setTotal(id: number, total: number): void {
  db.update(importJobs).set({ total }).where(eq(importJobs.id, id)).run()
}

/**
 * Os contadores de um lote, somados aos que já estavam lá.
 *
 * Soma no SQL em vez de ler-somar-escrever: o executor não é o único a tocar a
 * linha (o `Stop` escreve `cancel_requested_at` no meio), e uma leitura em
 * memória sobrescreveria o que chegou entre o `SELECT` e o `UPDATE`.
 */
export function addProgress(
  id: number,
  delta: {
    processed: number
    added: number
    skipped: number
    updated: number
    unmatched: number
  },
): void {
  db.update(importJobs)
    .set({
      processed: sql`${importJobs.processed} + ${delta.processed}`,
      added: sql`${importJobs.added} + ${delta.added}`,
      skipped: sql`${importJobs.skipped} + ${delta.skipped}`,
      updated: sql`${importJobs.updated} + ${delta.updated}`,
      unmatched: sql`${importJobs.unmatched} + ${delta.unmatched}`,
    })
    .where(eq(importJobs.id, id))
    .run()
}

/**
 * Acrescenta problemas, respeitando o teto da lista — e nunca o da contagem.
 *
 * Lê a lista atual porque o teto é uma regra sobre o CONTEÚDO dela, que o SQL
 * não expressa sem virar ilegível. A contagem, essa sim, soma no SQL.
 */
export function addProblems(id: number, problems: ImportProblem[]): void {
  if (problems.length === 0) {
    return
  }

  const current = db
    .select({ problems: importJobs.problems })
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .get()

  const stored: ImportProblem[] = JSON.parse(current?.problems ?? '[]')
  const room = MAX_STORED_PROBLEMS - stored.length

  db.update(importJobs)
    .set({
      problemCount: sql`${importJobs.problemCount} + ${problems.length}`,
      ...(room > 0
        ? { problems: JSON.stringify([...stored, ...problems.slice(0, room)]) }
        : {}),
    })
    .where(eq(importJobs.id, id))
    .run()
}

/** O `Stop`. Não muda o status — ver `import-jobs.ts`: pedido ≠ estado. */
export function requestCancel(id: number, userId: number): boolean {
  return (
    db
      .update(importJobs)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          eq(importJobs.id, id),
          eq(importJobs.userId, userId),
          eq(importJobs.status, 'running'),
          isNull(importJobs.cancelRequestedAt),
        ),
      )
      .returning({ id: importJobs.id })
      .all().length > 0
  )
}

export function cancelRequested(id: number): boolean {
  const row = db
    .select({ at: importJobs.cancelRequestedAt })
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .get()

  return row?.at != null
}

export function finish(
  id: number,
  outcome:
    | { status: 'done' | 'cancelled' }
    | {
        status: 'failed'
        errorKind: ImportFailureKind
        errorParams?: Record<string, string | number>
      },
): void {
  db.update(importJobs)
    .set({
      status: outcome.status,
      finishedAt: new Date(),
      ...(outcome.status === 'failed'
        ? {
            errorKind: outcome.errorKind,
            errorParams: JSON.stringify(outcome.errorParams ?? {}),
          }
        : {}),
    })
    .where(eq(importJobs.id, id))
    .run()
}

/**
 * Fecha toda linha `running` que ESTE processo não está executando.
 *
 * **É a reconciliação de zumbis, e o gatilho é a LEITURA** — mesma forma do
 * reconciliador de condições de instância, motivo diferente. Um boot hook
 * pegaria o processo que morreu; isto pega também o executor que morreu sozinho,
 * de um `throw` que escapou. O teste é preciso: uma linha `running` que não está
 * na lista de vivos deste processo não pode estar rodando em lugar nenhum,
 * porque só há um processo e só há uma importação por vez.
 *
 * Sem isso, o índice único parcial — que existe pra proteger o servidor —
 * trancaria a instalação pra sempre depois de um `docker restart` infeliz. Uma
 * constraint sem quem a limpe é uma trava, não uma garantia.
 */
export function reconcileInterrupted(aliveHere: Iterable<number>): number {
  const alive = [...aliveHere]

  return db
    .update(importJobs)
    .set({
      status: 'failed',
      errorKind: 'interrupted' satisfies ImportFailureKind,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(importJobs.status, 'running'),
        alive.length > 0 ? notInArray(importJobs.id, alive) : undefined,
      ),
    )
    .returning({ id: importJobs.id })
    .all().length
}

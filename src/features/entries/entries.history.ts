import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'

/**
 * O que o log sabe contar sobre uma obra.
 *
 * ── O que ele NÃO é ─────────────────────────────────────────────────────────
 * Não é a lista de eventos. É o resumo — quando começou, quando foi a última
 * vez, quantas vezes — porque é isso que cabe numa caixa da coluna e é isso que
 * responde "faz quanto tempo que eu larguei isto?".
 *
 * **Só PROGRESSO entra**, e é honesto dizer: o `event_log` tem tipos para
 * status, nota e notas, e nenhum deles é escrito hoje — o `PATCH` de `entries`
 * muda os três sem registrar nada (brief, 3.11 fala do log como log de
 * progresso). Uma caixa que dissesse "histórico" e mostrasse só metade seria
 * pior que uma que diz o que mostra.
 *
 * ── Por que passa por `entries` ─────────────────────────────────────────────
 * `event_log` não tem `user_id`: quem é dono da linha é a obra. Sem o join, a
 * rota contaria o histórico de qualquer um que soubesse um id.
 */
export type EntryHistory = {
  /** O primeiro evento de progresso, ou nulo se nunca houve nenhum. */
  startedAt: Date | null
  /** O último. Igual ao primeiro quando só houve um. */
  lastAt: Date | null
  /** Quantos eventos de progresso — não quantas unidades. */
  events: number
}

export function historyOf(
  entryId: number,
  userId: number,
): EntryHistory | null {
  const owner = db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
    .get()

  if (!owner) {
    return null
  }

  const filter = and(
    eq(eventLog.entryId, entryId),
    eq(eventLog.type, 'progress_delta'),
  )

  const first = db
    .select({ at: eventLog.occurredAt })
    .from(eventLog)
    .where(filter)
    .orderBy(asc(eventLog.occurredAt), asc(eventLog.id))
    .get()

  const last = db
    .select({ at: eventLog.occurredAt })
    .from(eventLog)
    .where(filter)
    .orderBy(desc(eventLog.occurredAt), desc(eventLog.id))
    .get()

  const total = db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(eventLog)
    .where(filter)
    .get()

  return {
    startedAt: first?.at ?? null,
    lastAt: last?.at ?? null,
    events: total?.n ?? 0,
  }
}

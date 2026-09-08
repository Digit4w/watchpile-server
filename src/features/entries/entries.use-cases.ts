import type { Entry } from './entries.entity.js'
import type { EntriesRepository, EventOrigin } from './entries.repository.js'

export type RecordProgressFailure =
  | 'entry-not-found'
  | 'progress-below-zero'
  | 'progress-above-total'

export type RecordProgressResult =
  | { ok: true; entry: Entry }
  | { ok: false; reason: RecordProgressFailure }

export interface RecordProgressCommand {
  entryId: number
  userId: number
  delta: number
  occurredAt: Date
  origin: EventOrigin
}

/**
 * Ajusta o progresso de uma obra. Nunca corrige a linha antiga do log —
 * desfazer é um evento novo com delta negativo (brief, 3.11).
 *
 * Delta fora dos limites é recusado em vez de aparado: gravar no log um
 * delta diferente do que foi pedido faria o histórico mentir, e clamp
 * silencioso esconde bug de cliente.
 */
export function recordProgress(
  repository: EntriesRepository,
  command: RecordProgressCommand,
): RecordProgressResult {
  const entry = repository.findById(command.entryId, command.userId)
  if (!entry) {
    return { ok: false, reason: 'entry-not-found' }
  }

  const progress = entry.progress + command.delta

  if (progress < 0) {
    return { ok: false, reason: 'progress-below-zero' }
  }

  // total desconhecido (mangá em publicação, brief 3.12) não impõe teto
  if (entry.total !== null && progress > entry.total) {
    return { ok: false, reason: 'progress-above-total' }
  }

  return {
    ok: true,
    entry: repository.recordProgress({
      entryId: entry.id,
      delta: command.delta,
      progress,
      occurredAt: command.occurredAt,
      origin: command.origin,
    }),
  }
}

import type { InferSelectModel } from 'drizzle-orm'
import type { eventLog } from '../../db/schema/event-log.js'
import type { Entry } from './entries.entity.js'

export type ProgressEvent = InferSelectModel<typeof eventLog>

export type EventOrigin = ProgressEvent['origin']

export interface RecordProgressInput {
  entryId: number
  delta: number
  progress: number
  occurredAt: Date
  origin: EventOrigin
}

export interface EntriesRepository {
  findById(id: number, userId: number): Entry | undefined
  /**
   * Grava o evento no log e o novo contador na obra na **mesma** transação.
   * As duas escritas juntas são a invariante do brief 3.11 — contador
   * derivável do log, mas nunca derivado em leitura.
   */
  recordProgress(input: RecordProgressInput): Entry
}

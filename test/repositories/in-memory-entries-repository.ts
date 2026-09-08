import type { Entry } from '../../src/features/entries/entries.entity.js'
import type {
  EntriesRepository,
  ProgressEvent,
  RecordProgressInput,
} from '../../src/features/entries/entries.repository.js'

/**
 * Fake in-memory do `EntriesRepository`. Existe para o
 * `entries.use-cases.spec.ts` exercitar a regra de progresso sem subir
 * SQLite — e para o teste conseguir olhar o log, que é o que prova a
 * invariante append-only do brief 3.11.
 */
export class InMemoryEntriesRepository implements EntriesRepository {
  readonly entries: Entry[]
  readonly events: ProgressEvent[] = []

  private nextEventId = 1

  constructor(entries: Entry[] = []) {
    this.entries = entries
  }

  findById(id: number, userId: number): Entry | undefined {
    return this.entries.find(
      (entry) => entry.id === id && entry.userId === userId,
    )
  }

  recordProgress(input: RecordProgressInput): Entry {
    const entry = this.entries.find(({ id }) => id === input.entryId)
    if (!entry) {
      throw new Error(`Entry ${input.entryId} is not in the fake repository`)
    }

    this.events.push({
      id: this.nextEventId++,
      entryId: input.entryId,
      type: 'progress_delta',
      delta: input.delta,
      previousValue: null,
      newValue: null,
      origin: input.origin,
      occurredAt: input.occurredAt,
      createdAt: new Date(),
    })

    entry.progress = input.progress
    entry.updatedAt = new Date()

    return entry
  }
}

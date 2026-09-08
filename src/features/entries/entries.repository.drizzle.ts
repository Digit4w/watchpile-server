import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { eventLog } from '../../db/schema/event-log.js'
import type { Entry } from './entries.entity.js'
import type {
  EntriesRepository,
  RecordProgressInput,
} from './entries.repository.js'

export const drizzleEntriesRepository: EntriesRepository = {
  findById(id, userId) {
    return db
      .select()
      .from(entries)
      .where(and(eq(entries.id, id), eq(entries.userId, userId)))
      .get()
  },

  recordProgress(input: RecordProgressInput): Entry {
    return db.transaction((tx) => {
      tx.insert(eventLog)
        .values({
          entryId: input.entryId,
          type: 'progress_delta',
          delta: input.delta,
          origin: input.origin,
          occurredAt: input.occurredAt,
        })
        .run()

      return tx
        .update(entries)
        .set({ progress: input.progress, updatedAt: new Date() })
        .where(eq(entries.id, input.entryId))
        .returning()
        .get()
    })
  },
}

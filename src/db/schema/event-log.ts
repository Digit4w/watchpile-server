import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { entries } from './entries.js'

export const eventLog = sqliteTable('event_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entryId: integer('entry_id')
    .notNull()
    .references(() => entries.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['progress_delta', 'status_change', 'rating_change', 'note_change'],
  }).notNull(),
  delta: integer('delta'),
  previousValue: text('previous_value'),
  newValue: text('new_value'),
  origin: text('origin', { enum: ['manual', 'import', 'scrobble'] })
    .notNull()
    .default('manual'),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

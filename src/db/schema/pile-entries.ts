import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, unique } from 'drizzle-orm/sqlite-core'
import { entries } from './entries.js'
import { piles } from './piles.js'

export const pileEntries = sqliteTable(
  'pile_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pileId: integer('pile_id')
      .notNull()
      .references(() => piles.id, { onDelete: 'cascade' }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [unique().on(table.pileId, table.entryId)],
)

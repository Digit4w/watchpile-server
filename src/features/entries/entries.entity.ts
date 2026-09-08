import type { InferSelectModel } from 'drizzle-orm'
import type { entries } from '../../db/schema/entries.js'

export type Entry = InferSelectModel<typeof entries>

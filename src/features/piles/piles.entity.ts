import type { InferSelectModel } from 'drizzle-orm'
import type { piles } from '../../db/schema/piles.js'

export type Pile = InferSelectModel<typeof piles>

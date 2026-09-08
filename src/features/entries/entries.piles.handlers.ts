import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { publicPileColumns } from '../piles/piles.public.js'
import type { ListPilesRoute } from './entries.piles.routes.js'

export const listPiles: AppRouteHandler<ListPilesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const owns =
    db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, id), eq(entries.userId, user.id)))
      .get() !== undefined

  if (!owns) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  // O filtro por `userId` na pilha é redundante com o dono da obra, mas fica:
  // é a mesma cautela do resto da feature, e o custo é zero.
  const rows = db
    .select(publicPileColumns)
    .from(pileEntries)
    .innerJoin(piles, eq(piles.id, pileEntries.pileId))
    .where(and(eq(pileEntries.entryId, id), eq(piles.userId, user.id)))
    .orderBy(asc(piles.name), asc(piles.id))
    .all()

  return c.json(rows, 200)
}

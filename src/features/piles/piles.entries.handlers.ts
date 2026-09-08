import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import type { AppRouteHandler } from '../../lib/types.js'
import type { Entry } from '../entries/entries.entity.js'
import {
  type PublicEntry,
  toPublicEntries,
  toPublicEntry,
} from '../entries/entries.public.js'
import type {
  AddEntryRoute,
  ListEntriesRoute,
  MoveEntryRoute,
  RemoveEntryRoute,
} from './piles.entries.routes.js'
import { appendToPiles, type Tx, touchPiles } from './piles.membership.js'
import { positionBetween, rebalancedPositions } from './piles.ordering.js'

function ownsPile(pileId: number, userId: number): boolean {
  return (
    db
      .select({ id: piles.id })
      .from(piles)
      .where(and(eq(piles.id, pileId), eq(piles.userId, userId)))
      .get() !== undefined
  )
}

function ownsEntry(entryId: number, userId: number): boolean {
  return (
    db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
      .get() !== undefined
  )
}

/** Membros da pile em ordem manual, com a posição junto para o reorder. */
function membershipsOf(
  pileId: number,
  tx: Tx | typeof db = db,
): { entryId: number; position: number }[] {
  return tx
    .select({ entryId: pileEntries.entryId, position: pileEntries.position })
    .from(pileEntries)
    .where(eq(pileEntries.pileId, pileId))
    .orderBy(asc(pileEntries.position), asc(pileEntries.entryId))
    .all()
}

function entriesOf(pileId: number): PublicEntry[] {
  return toPublicEntries(
    db
      .select()
      .from(pileEntries)
      .innerJoin(entries, eq(entries.id, pileEntries.entryId))
      .where(eq(pileEntries.pileId, pileId))
      .orderBy(asc(pileEntries.position), asc(pileEntries.entryId))
      .all()
      .map(({ entries: entry }) => entry),
  )
}

export const listEntries: AppRouteHandler<ListEntriesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  if (!ownsPile(id, user.id)) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.json(entriesOf(id), 200)
}

export const addEntry: AppRouteHandler<AddEntryRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { entryId } = c.req.valid('json')

  if (!ownsPile(id, user.id)) {
    return c.json({ message: 'Pile not found' }, 404)
  }
  if (!ownsEntry(entryId, user.id)) {
    return c.json({ message: 'Entry not found' }, 404)
  }

  const members = membershipsOf(id)
  if (members.some((member) => member.entryId === entryId)) {
    return c.json({ message: 'The entry is already in this pile' }, 409)
  }

  // A conta do append mora em `piles.membership.ts`, porque a folha de criar
  // obra escreve pelo mesmo caminho (brief, 3.17). Aqui a duplicata já foi
  // recusada acima com 409: nesta rota adicionar é a ação inteira, e ficar
  // calado esconderia o resultado.
  appendToPiles(entryId, [id])

  const entry = db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .get() as Entry

  return c.json(toPublicEntry(entry), 201)
}

export const moveEntry: AppRouteHandler<MoveEntryRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id, entryId } = c.req.valid('param')
  const { after } = c.req.valid('json')

  if (!ownsPile(id, user.id)) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  const members = membershipsOf(id)
  if (!members.some((member) => member.entryId === entryId)) {
    return c.json({ message: 'Entry not found in this pile' }, 404)
  }
  if (after === entryId) {
    return c.json({ message: 'An entry cannot sit behind itself' }, 422)
  }
  if (after !== null && !members.some((member) => member.entryId === after)) {
    return c.json({ message: 'Anchor entry is not in this pile' }, 422)
  }

  db.transaction((tx) => {
    let current = membershipsOf(id, tx).filter(
      (member) => member.entryId !== entryId,
    )

    const anchorAt =
      after === null
        ? -1
        : current.findIndex((member) => member.entryId === after)

    const before =
      anchorAt === -1 ? null : (current[anchorAt]?.position ?? null)
    const next = current[anchorAt + 1]?.position ?? null

    let position = positionBetween(before, next)

    if (position === null) {
      // precisão esgotada entre os vizinhos: renumera a pile em passo inteiro
      // e refaz a conta, em vez de gravar uma posição que colide (3.14)
      const renumbered = rebalancedPositions(current.length)
      current.forEach((member, index) => {
        tx.update(pileEntries)
          .set({ position: renumbered[index] as number })
          .where(
            and(
              eq(pileEntries.pileId, id),
              eq(pileEntries.entryId, member.entryId),
            ),
          )
          .run()
      })
      current = current.map((member, index) => ({
        ...member,
        position: renumbered[index] as number,
      }))
      position = positionBetween(
        anchorAt === -1 ? null : (current[anchorAt]?.position ?? null),
        current[anchorAt + 1]?.position ?? null,
      ) as number
    }

    tx.update(pileEntries)
      .set({ position })
      .where(and(eq(pileEntries.pileId, id), eq(pileEntries.entryId, entryId)))
      .run()
  })

  return c.json(entriesOf(id), 200)
}

export const removeEntry: AppRouteHandler<RemoveEntryRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id, entryId } = c.req.valid('param')

  if (!ownsPile(id, user.id)) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  const deleted = db
    .delete(pileEntries)
    .where(and(eq(pileEntries.pileId, id), eq(pileEntries.entryId, entryId)))
    .returning({ id: pileEntries.id })
    .get()

  if (!deleted) {
    return c.json({ message: 'Entry not found in this pile' }, 404)
  }

  // A pilha perdeu uma obra: mudou de conteúdo, e a ordem padrão de `/piles` é
  // "Recently updated". Mesmo motivo pelo qual o auto-remove já fazia isto.
  touchPiles([id])

  return c.body(null, 204)
}

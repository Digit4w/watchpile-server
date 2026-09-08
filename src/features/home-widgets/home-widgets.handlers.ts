import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { homeWidgets } from '../../db/schema/home-widgets.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import { widgetEntryOrder } from '../../db/schema/widget-entry-order.js'
import { widgetPiles } from '../../db/schema/widget-piles.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { toPublicEntries } from '../entries/entries.public.js'
import {
  positionBetween,
  rebalancedPositions,
} from '../piles/piles.ordering.js'
import type { HomeWidget } from './home-widgets.entity.js'
import type { WidgetFilter } from './home-widgets.filter.js'
import { orderForWidget } from './home-widgets.ordering.js'
import type {
  CreateRoute,
  ListEntriesRoute,
  ListRoute,
  MoveEntryRoute,
  RemoveRoute,
  UpdateLayoutRoute,
  UpdateRoute,
} from './home-widgets.routes.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Db = Tx | typeof db

type WidgetRow = typeof homeWidgets.$inferSelect

function pileIdsOf(widgetId: number, tx: Db = db): number[] {
  return tx
    .select({ pileId: widgetPiles.pileId })
    .from(widgetPiles)
    .where(eq(widgetPiles.widgetId, widgetId))
    .all()
    .map(({ pileId }) => pileId)
}

function present(widget: WidgetRow, tx: Db = db) {
  const { userId: _userId, filter, ...rest } = widget
  return {
    ...rest,
    filter: filter as WidgetFilter,
    pileIds: pileIdsOf(widget.id, tx),
  }
}

function findWidget(id: number, userId: number): WidgetRow | undefined {
  return db
    .select()
    .from(homeWidgets)
    .where(and(eq(homeWidgets.id, id), eq(homeWidgets.userId, userId)))
    .get()
}

/** Pile de outro usuário não pode alimentar o seu widget. */
function allPilesOwned(pileIds: number[], userId: number): boolean {
  if (pileIds.length === 0) {
    return true
  }
  const owned = db
    .select({ id: piles.id })
    .from(piles)
    .where(and(inArray(piles.id, pileIds), eq(piles.userId, userId)))
    .all()

  return owned.length === new Set(pileIds).size
}

function replacePiles(widgetId: number, pileIds: number[], tx: Tx): void {
  tx.delete(widgetPiles).where(eq(widgetPiles.widgetId, widgetId)).run()
  const unique = [...new Set(pileIds)]
  if (unique.length > 0) {
    tx.insert(widgetPiles)
      .values(unique.map((pileId) => ({ widgetId, pileId })))
      .run()
  }
}

export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const rows = db
    .select()
    .from(homeWidgets)
    .where(eq(homeWidgets.userId, user.id))
    .all()

  return c.json(
    rows.map((row) => present(row)),
    200,
  )
}

/**
 * Espaço em branco não é nome. `"  "` e `""` viram `null`, que é o único jeito
 * de dizer "sem nome" — senão o cabeçalho ficaria vazio em vez de voltar ao
 * rótulo derivado, e existiriam dois estados para a mesma coisa.
 */
function normalizeTitle<T extends { title?: string | null }>(body: T): T {
  if (body.title === undefined || body.title === null) {
    return body
  }
  const trimmed = body.title.trim()
  return { ...body, title: trimmed === '' ? null : trimmed }
}

export const create: AppRouteHandler<CreateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { pileIds, ...rest } = c.req.valid('json')
  const body = normalizeTitle(rest)

  if (!allPilesOwned(pileIds, user.id)) {
    return c.json({ message: 'Pile not found' }, 422)
  }

  const created = db.transaction((tx) => {
    const widget = tx
      .insert(homeWidgets)
      .values({ ...body, userId: user.id })
      .returning()
      .get()

    replacePiles(widget.id, pileIds, tx)
    return present(widget, tx)
  })

  return c.json(created, 201)
}

export const updateLayout: AppRouteHandler<UpdateLayoutRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { widgets } = c.req.valid('json')

  const owned = db
    .select({ id: homeWidgets.id })
    .from(homeWidgets)
    .where(
      and(
        eq(homeWidgets.userId, user.id),
        inArray(
          homeWidgets.id,
          widgets.map(({ id }) => id),
        ),
      ),
    )
    .all()

  // um id de fora derruba o lote inteiro: layout meio salvo é pior que nenhum
  if (owned.length !== new Set(widgets.map(({ id }) => id)).size) {
    return c.json({ message: 'Widget not found' }, 404)
  }

  const saved = db.transaction((tx) => {
    for (const { id, ...layout } of widgets) {
      tx.update(homeWidgets)
        .set({ ...layout, updatedAt: new Date() })
        .where(eq(homeWidgets.id, id))
        .run()
    }

    return tx
      .select()
      .from(homeWidgets)
      .where(eq(homeWidgets.userId, user.id))
      .all()
      .map((row) => present(row, tx))
  })

  return c.json(saved, 200)
}

export const update: AppRouteHandler<UpdateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const { pileIds, ...rest } = c.req.valid('json')
  const body = normalizeTitle(rest)

  if (!findWidget(id, user.id)) {
    return c.json({ message: 'Widget not found' }, 404)
  }
  if (pileIds !== undefined && !allPilesOwned(pileIds, user.id)) {
    return c.json({ message: 'Pile not found' }, 422)
  }

  const updated = db.transaction((tx) => {
    const widget =
      Object.keys(body).length > 0
        ? tx
            .update(homeWidgets)
            .set({ ...body, updatedAt: new Date() })
            .where(eq(homeWidgets.id, id))
            .returning()
            .get()
        : (tx
            .select()
            .from(homeWidgets)
            .where(eq(homeWidgets.id, id))
            .get() as WidgetRow)

    if (pileIds !== undefined) {
      replacePiles(id, pileIds, tx)
    }

    return present(widget, tx)
  })

  return c.json(updated, 200)
}

export const remove: AppRouteHandler<RemoveRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const deleted = db
    .delete(homeWidgets)
    .where(and(eq(homeWidgets.id, id), eq(homeWidgets.userId, user.id)))
    .returning({ id: homeWidgets.id })
    .get()

  if (!deleted) {
    return c.json({ message: 'Widget not found' }, 404)
  }

  return c.body(null, 204)
}

/**
 * As obras que um widget resolve, na ordem de exibição — sem o corte de
 * `itemCount`.
 *
 * Extraído de `listEntries` em 29/08/2026 porque o reorder precisa da MESMA
 * lista: congelar a ordem visível no primeiro arrasto só funciona se "visível"
 * quiser dizer exatamente o que a leitura devolve. Duas resoluções paralelas
 * divergiriam no primeiro filtro novo.
 */
function resolveEntries(widget: HomeWidget, userId: number) {
  const filter = widget.filter as WidgetFilter
  const sourcePiles = pileIdsOf(widget.id)

  const conditions = [
    eq(entries.userId, userId),
    filter.mediaType ? inArray(entries.mediaType, filter.mediaType) : undefined,
    filter.status ? inArray(entries.status, filter.status) : undefined,
  ]

  // zero pile = biblioteca inteira, não widget vazio (brief, 3.15)
  const rows =
    sourcePiles.length === 0
      ? db
          .select()
          .from(entries)
          .where(and(...conditions))
          .all()
      : db
          .selectDistinct({ entry: entries })
          .from(pileEntries)
          .innerJoin(entries, eq(entries.id, pileEntries.entryId))
          .where(and(inArray(pileEntries.pileId, sourcePiles), ...conditions))
          .all()
          .map(({ entry }) => entry)

  return orderForWidget(rows, manualPositionsOf(widget.id))
}

function manualPositionsOf(widgetId: number, tx: Db = db) {
  return new Map(
    tx
      .select({
        entryId: widgetEntryOrder.entryId,
        position: widgetEntryOrder.position,
      })
      .from(widgetEntryOrder)
      .where(eq(widgetEntryOrder.widgetId, widgetId))
      .all()
      .map(({ entryId, position }) => [entryId, position] as const),
  )
}

export const listEntries: AppRouteHandler<ListEntriesRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const widget = findWidget(id, user.id)
  if (!widget) {
    return c.json({ message: 'Widget not found' }, 404)
  }

  const ordered = resolveEntries(widget, user.id)
  const limited =
    widget.itemCount === null ? ordered : ordered.slice(0, widget.itemCount)

  return c.json(toPublicEntries(limited), 200)
}

/**
 * Move uma obra dentro do widget. O cliente diz atrás de quem ela vai; o
 * servidor escolhe o número (brief, 3.14), como no reorder de pile.
 *
 * ── Congelar no primeiro arrasto (29/08/2026) ───────────────────────────────
 * `orderForWidget` põe TODOS os itens com posição manual antes de TODOS os
 * demais. Gravar só o arrastado, então, o mandaria pro topo em vez da posição
 * onde foi solto — o gesto não corresponderia ao resultado, que é o que se lê
 * como bug.
 *
 * Por isso o primeiro arrasto materializa a ordem visível INTEIRA, na ordem em
 * que ela já estava, e só depois move. A partir daí o widget tem ordem própria
 * e o arrasto se comporta como em qualquer lista.
 *
 * A consequência aceita: obra que passe a casar com o filtro depois disso entra
 * no fim, e não mais ordenada por data. É o preço de o widget ter ordem
 * própria, e vale mais que um arrasto que não obedece.
 *
 * Isto vive no servidor, e não no cliente mandando a lista inteira: assim
 * nenhum cliente consegue gravar posição duplicada nem inverter a invariante.
 */
export const moveEntry: AppRouteHandler<MoveEntryRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id, entryId } = c.req.valid('param')
  const { after } = c.req.valid('json')

  const widget = findWidget(id, user.id)
  if (!widget) {
    return c.json({ message: 'Widget not found' }, 404)
  }

  const visible = resolveEntries(widget, user.id)
  if (!visible.some((entry) => entry.id === entryId)) {
    return c.json({ message: 'Entry not found in this widget' }, 404)
  }
  if (after === entryId) {
    return c.json({ message: 'An entry cannot sit behind itself' }, 422)
  }
  if (after !== null && !visible.some((entry) => entry.id === after)) {
    return c.json({ message: 'Anchor entry is not in this widget' }, 422)
  }

  db.transaction((tx) => {
    // O congelamento: renumera a ordem visível em passo inteiro, do jeito que
    // ela está agora. Idempotente — rodar de novo com a mesma ordem reescreve
    // os mesmos números.
    const frozen = rebalancedPositions(visible.length)
    visible.forEach((entry, index) => {
      const position = frozen[index] as number
      tx.insert(widgetEntryOrder)
        .values({ widgetId: id, entryId: entry.id, position })
        .onConflictDoUpdate({
          target: [widgetEntryOrder.widgetId, widgetEntryOrder.entryId],
          set: { position },
        })
        .run()
    })

    const remaining = visible.filter((entry) => entry.id !== entryId)
    const anchorAt =
      after === null ? -1 : remaining.findIndex((entry) => entry.id === after)

    const before =
      anchorAt === -1
        ? null
        : (frozen[visible.findIndex((e) => e.id === remaining[anchorAt]?.id)] ??
          null)
    const nextEntry = remaining[anchorAt + 1]
    const next =
      nextEntry === undefined
        ? null
        : (frozen[visible.findIndex((e) => e.id === nextEntry.id)] ?? null)

    // Depois de renumerar em passo inteiro sempre há casa entre dois vizinhos,
    // então aqui `positionBetween` não devolve `null`.
    const position = positionBetween(before, next) as number

    tx.update(widgetEntryOrder)
      .set({ position })
      .where(
        and(
          eq(widgetEntryOrder.widgetId, id),
          eq(widgetEntryOrder.entryId, entryId),
        ),
      )
      .run()
  })

  const ordered = resolveEntries(widget, user.id)
  const limited =
    widget.itemCount === null ? ordered : ordered.slice(0, widget.itemCount)

  return c.json(toPublicEntries(limited), 200)
}

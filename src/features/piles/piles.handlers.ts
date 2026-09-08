import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import type { AppRouteHandler } from '../../lib/types.js'
import {
  findPile,
  previewsFor,
  publicPileColumns as publicColumns,
  withDetails,
} from './piles.public.js'
import { entryCountExpression, nameContains, orderFor } from './piles.query.js'
import type {
  CreateRoute,
  GetByIdRoute,
  ListRoute,
  RemoveRoute,
  UpdateRoute,
} from './piles.routes.js'

export const list: AppRouteHandler<ListRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { q, sort } = c.req.valid('query')

  /**
   * `LEFT JOIN` e não `INNER`: pilha vazia é caso normal do modelo — ela nasce
   * vazia, num popover de um campo, antes de ter obra nenhuma. Com `INNER` ela
   * sumiria da própria tela que serve pra enchê-la.
   */
  const rows = db
    .select({ ...publicColumns, entryCount: entryCountExpression })
    .from(piles)
    .leftJoin(pileEntries, eq(pileEntries.pileId, piles.id))
    .where(and(eq(piles.userId, user.id), q ? nameContains(q) : undefined))
    .groupBy(piles.id)
    .orderBy(...orderFor(sort))
    .all()

  const previews = previewsFor(rows.map(({ id }) => id))

  return c.json(
    rows.map((pile) => ({ ...pile, preview: previews.get(pile.id) ?? [] })),
    200,
  )
}

export const create: AppRouteHandler<CreateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { name, description, removeWhenCompleted } = c.req.valid('json')

  const created = db
    .insert(piles)
    .values({
      userId: user.id,
      name,
      description: description ?? null,
      removeWhenCompleted: removeWhenCompleted ?? false,
    })
    .returning(publicColumns)
    .get()

  // Recém-criada, então sem obra nenhuma — mas passa pelo mesmo caminho das
  // outras rotas de propósito: a forma da resposta é uma só, e o cliente põe
  // esta pilha direto no cache da lista sem remendar buraco.
  return c.json(withDetails(created), 201)
}

export const getById: AppRouteHandler<GetByIdRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  const pile = findPile(id, user.id)
  if (!pile) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.json(withDetails(pile), 200)
}

export const update: AppRouteHandler<UpdateRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  /**
   * Só os campos que vieram, e `updated_at` junto deles.
   *
   * Montar o objeto em vez de passar o corpo inteiro é o que faz o PATCH ser
   * parcial de verdade: `set({ description: undefined })` é a forma de apagar
   * sem querer o que ninguém tocou — a mesma armadilha que `.partial()` com
   * `.default()` já cobrou uma vez neste repositório (server/CLAUDE.md).
   */
  const patch: Partial<typeof piles.$inferInsert> = {}
  if (body.name !== undefined) {
    patch.name = body.name
  }
  if (body.description !== undefined) {
    patch.description = body.description
  }
  if (body.removeWhenCompleted !== undefined) {
    patch.removeWhenCompleted = body.removeWhenCompleted
  }
  /**
   * O cliente manda a intenção; o instante é escolhido aqui — mesma divisão de
   * responsabilidade que `position` já tem. Desfixar zera a data em vez de
   * guardá-la: "quando foi fixada" só faz sentido enquanto está fixada, e uma
   * data órfã acabaria ordenando alguma coisa um dia.
   */
  if (body.pinned !== undefined) {
    patch.pinnedAt = body.pinned ? new Date() : null
  }

  /**
   * PATCH vazio não é erro, mas também não toca em `updated_at`. A ordem
   * padrão da tela é "Recently updated": deixar um corpo vazio empurrar a
   * pilha pro topo faria a lista se reordenar por um pedido que não pediu
   * mudança nenhuma.
   */
  if (Object.keys(patch).length === 0) {
    const current = findPile(id, user.id)
    return current
      ? c.json(withDetails(current), 200)
      : c.json({ message: 'Pile not found' }, 404)
  }

  const updated = db
    .update(piles)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(piles.id, id), eq(piles.userId, user.id)))
    .returning(publicColumns)
    .get()

  if (!updated) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.json(withDetails(updated), 200)
}

export const remove: AppRouteHandler<RemoveRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { id } = c.req.valid('param')

  /**
   * Apagar pilha **não** apaga obra: `pile_entries` cai por `ON DELETE
   * CASCADE`, `entries` não é tocada. Isso é o modelo (a pilha é agrupamento
   * opcional, a obra vive fora dela) e é o que a confirmação da tela precisa
   * dizer em voz alta.
   *
   * Não há pilha de sistema pra proteger aqui — decidido em 29/08/2026, toda
   * pilha é do usuário e apagável (brief, 6).
   */
  const deleted = db
    .delete(piles)
    .where(and(eq(piles.id, id), eq(piles.userId, user.id)))
    .returning({ id: piles.id })
    .get()

  if (!deleted) {
    return c.json({ message: 'Pile not found' }, 404)
  }

  return c.body(null, 204)
}

import { integer, sqliteTable, unique } from 'drizzle-orm/sqlite-core'
import { homeWidgets } from './home-widgets.js'
import { piles } from './piles.js'

/**
 * Quais piles alimentam um widget (brief, 3.15). N-para-N de propósito: um
 * widget soma mais de uma pile. **Zero linhas aqui significa a biblioteca
 * inteira** — sem restrição de fonte, só o filtro do widget decide. É isso que
 * faz um widget "In progress" existir sem obrigar o usuário a manter uma pile
 * espelhando o próprio status.
 */
export const widgetPiles = sqliteTable(
  'widget_piles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    widgetId: integer('widget_id')
      .notNull()
      .references(() => homeWidgets.id, { onDelete: 'cascade' }),
    pileId: integer('pile_id')
      .notNull()
      .references(() => piles.id, { onDelete: 'cascade' }),
  },
  (table) => [unique().on(table.widgetId, table.pileId)],
)

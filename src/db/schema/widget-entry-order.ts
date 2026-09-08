import { integer, real, sqliteTable, unique } from 'drizzle-orm/sqlite-core'
import { entries } from './entries.js'
import { homeWidgets } from './home-widgets.js'

/**
 * Override manual de ordem DENTRO de um widget (brief, 3.14). É separado da
 * ordem canônica de `pile_entries` de propósito: a mesma pile pode aparecer em
 * ordens diferentes em dois widgets, cada um lembrando a sua.
 *
 * Nunca precisa ser completo — só os itens que o usuário efetivamente
 * arrastou. Sem linha aqui, a exibição cai pra `entries.updated_at` desc.
 */
export const widgetEntryOrder = sqliteTable(
  'widget_entry_order',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    widgetId: integer('widget_id')
      .notNull()
      .references(() => homeWidgets.id, { onDelete: 'cascade' }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
  },
  (table) => [unique().on(table.widgetId, table.entryId)],
)

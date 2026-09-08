import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users.js'

export const homeWidgets = sqliteTable('home_widgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['list', 'grid', 'scroll', 'stats'],
  }).notNull(),
  /**
   * Nome dado pelo usuário. `null` significa "use o rótulo derivado" — tipo +
   * fonte —, e não "sem nome": dois widgets da mesma pile, ou dois sem pile
   * nenhuma, ficavam com cabeçalho idêntico e indistinguíveis na home.
   *
   * Nulável em vez de string vazia: o default derivado é o comportamento
   * normal, e `''` obrigaria toda leitura a tratar vazio como ausente.
   */
  title: text('title'),
  /**
   * Filtro do widget, não da pile (brief, 3.15). JSON e não coluna por campo:
   * filtro é o que mais cresce, e coluna solta viraria migration a cada campo
   * novo. Validado por Zod na escrita, então não é gaveta de bagunça.
   */
  filter: text('filter', { mode: 'json' }).notNull().default(sql`'{}'`),
  itemCount: integer('item_count'),
  // x/y/w/h no formato que o react-grid-layout lê nativamente (brief, 3.15)
  x: integer('x').notNull().default(0),
  y: integer('y').notNull().default(0),
  w: integer('w').notNull().default(4),
  h: integer('h').notNull().default(4),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users.js'

export const piles = sqliteTable('piles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /**
   * Livre e opcional — "What is this pile for?". Na listagem ela é uma linha
   * truncada; onde ela aparece inteira é a tela da pilha (`/piles/:id`).
   * Não entra na criação: criar pilha pede só o nome, num popover de um campo,
   * porque é gesto de meio de tarefa (brief, 3.17).
   */
  description: text('description'),

  /**
   * A capa que o usuário subiu — **BLOB no próprio banco** (brief, 3.17).
   *
   * Não é inconsistência com a arte de obra, que vai pro disco: a regra é
   * **regenerável vai pro disco com teto, insubstituível vai pro banco**, e
   * quem a decide é a promessa de "um arquivo de banco" (3.1). Backup é copiar
   * esse arquivo; capa em disco sumiria calada numa restauração.
   *
   * **Chega já redimensionada** — quem corta e reduz é o navegador (31/08/2026).
   * O servidor valida tipo e tamanho em bytes e guarda o que recebeu; ele não
   * normaliza dimensão, e isso é decisão de empacotamento, não de elegância:
   * `sharp` seria um segundo módulo nativo além do `better-sqlite3`, dobrando a
   * superfície do `electron:rebuild` em toda release.
   */
  cover: blob('cover', { mode: 'buffer' }),
  /**
   * O mime do que está em `cover`, para devolvê-lo com o `Content-Type` certo.
   *
   * Coluna e não constante porque o **formato de destino ainda está em aberto**
   * (design system, decisão #9): fixar `image/webp` em código hoje seria decidir
   * calado o que ninguém decidiu, e o dia da mudança acharia BLOBs antigos
   * servidos com o tipo errado. Anda junto de `cover` — os dois são `NULL` ou
   * os dois têm valor.
   */
  coverType: text('cover_type'),

  /**
   * Obra marcada como `completed` sai da pilha sozinha (brief, 3.17).
   *
   * É o que transforma uma pilha em **fila** sem inventar um tipo especial de
   * pilha: a diferença é dado numa linha, nunca uma tabela nova — a mesma
   * invariante que a 3.12 protege nos tipos de mídia. Desligar devolve uma
   * pilha comum, sem migrar nada.
   *
   * **Apaga associação, nunca a obra**: mexe em `pile_entries`, e a linha de
   * `entries` — progresso, nota, log — fica inteira.
   */
  removeWhenCompleted: integer('remove_when_completed', { mode: 'boolean' })
    .notNull()
    .default(false),

  /**
   * A pilha aparece na navegação, sob os destinos fixos.
   *
   * Timestamp nulável e não booleano: o `NULL` já é o não-fixado, e a data
   * ordena as fixadas por si só. Um booleano precisaria de uma segunda coluna
   * de ordem pra responder a mesma pergunta.
   */
  pinnedAt: integer('pinned_at', { mode: 'timestamp' }),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

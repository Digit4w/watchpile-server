import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import { providers } from './providers.js'
import { users } from './users.js'

export const entries = sqliteTable('entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /**
   * O enum de seis virou FK para `media_types.slug` em 31/08/2026 (brief,
   * 3.12): os seis eram ponto de partida, não teto, e o usuário passa a criar
   * tipo próprio. A coluna continua sendo TEXT com o mesmo conteúdo de antes —
   * ver `media-types.ts` para por que a FK aponta pro slug e não pro id.
   *
   * `restrict` e não `cascade`: apagar um tipo em uso **recusa**, e a recusa é
   * a decisão de produto (brief, 3.12), não uma limitação. Cascade apagaria as
   * obras de outro usuário sem que ninguém tivesse pedido.
   */
  mediaType: text('media_type')
    .notNull()
    .references(() => mediaTypes.slug, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
  title: text('title').notNull(),
  status: text('status', {
    enum: ['watching', 'completed', 'dropped', 'planned', 'on-hold'],
  })
    .notNull()
    .default('planned'),
  rating: real('rating'),
  notes: text('notes'),
  progress: integer('progress').notNull().default(0),
  total: integer('total'),
  /**
   * De qual vínculo ESTA obra fala, quando a dona dela discorda do padrão.
   *
   * ── Por que ela existe, e por que aqui ──────────────────────────────────────
   * Até 02/09/2026 quem decidia de qual provedor saem sinopse, ano e arte era o
   * provedor padrão do **tipo** (brief, 3.10) — e tipo é vocabulário da
   * instância, portanto do admin (3.9). Uma obra com dois vínculos não tinha
   * como discordar disso, então o segundo vínculo era invisível: ele existia, e
   * nada na tela o alcançava.
   *
   * A coluna cai do lado certo da régua de 30/08: **infraestrutura da instância
   * é do admin, conteúdo é do usuário**. O padrão do tipo ficou com a busca, que
   * é infraestrutura; esta coluna é a obra — que é conteúdo — dizendo de qual
   * vínculo ela fala. Nenhum vocabulário de ninguém muda.
   *
   * ── Nulo é legítimo, e é o estado de quase toda obra ────────────────────────
   * Mesma forma e mesmo significado de `media_types.default_provider_slug`, um
   * nível acima: nulo quer dizer "ninguém decidiu AQUI", não "sem fonte". Quem
   * resolve a cadeia inteira é `sourceOf`, e ela é a única a resolvê-la.
   *
   * FK pro `slug` e não pro `id`, como em `external_ids`, e `restrict` pelo
   * mesmo motivo: apagar a definição de um provedor não pode levar junto a
   * escolha de quem a fez.
   *
   * **Apontar pra um provedor que a obra não tem é possível e não é erro** — é
   * o que sobra se o vínculo for embora por fora. `sourceOf` ignora o degrau em
   * vez de devolver nada, e desvincular limpa a coluna quando ela apontava pra
   * ali.
   */
  primaryProvider: text('primary_provider').references(() => providers.slug, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { entries } from './entries.js'
import { mediaTypes } from './media-types.js'
import { providers } from './providers.js'

/**
 * A mesma obra existe em mais de um provedor, e amanhã entra provedor novo —
 * por isso ID externo é TABELA, não coluna (brief, 3.10). Seis colunas
 * nullable não resolvem.
 *
 * **`provider` deixou de ser enum de quatro e virou FK — 31/08/2026** (brief,
 * 3.10: "os dois enums fixos abrem"). A FK aponta pro `slug` de `providers`, e
 * não pro `id`, e a escolha se paga na migration: as linhas existentes já
 * guardam `'tmdb'`, `'anilist'`, `'igdb'` e `'openlibrary'` como texto, então o
 * enum vira tabela **sem reescrever uma linha de dado**.
 *
 * `onDelete: 'restrict'` e não cascade: o par (provedor, id externo) é dado
 * sobre a obra, não sobre o provedor. Apagar a definição do TMDB e levar junto
 * a informação de que esta obra é `tmdb/550` perderia o que reconecta as duas
 * se o provedor voltar. **Apagar provedor não é oferecido pela API ainda** — a
 * guarda existe antes da rota, de propósito, porque é ela que decide o que a
 * rota vai poder fazer.
 */
export const externalIds = sqliteTable(
  'external_ids',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    provider: text('provider')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    externalId: text('external_id').notNull(),
    /**
     * **O tipo faz PARTE da identidade externa** — 07/09/2026, medido.
     *
     * O id de um provedor é único DENTRO do tipo, não entre tipos: no
     * MyAnimeList, `21` é o anime One Piece **e** o mangá Death Note; no TMDB,
     * `1396` é Breaking Bad em série e *Mirror* em filme. Sem esta coluna, o par
     * `(provider, external_id)` parecia identidade completa e não era.
     *
     * ── O que isso custava, e não era teórico ──────────────────────────────
     * Um import do MyAnimeList de 426 obras entregou 422: quatro mangás —
     * Death Note, Beck, Hajime no Ippo e 666 Satan — foram lidos como "já está
     * na sua biblioteca" porque um ANIME tinha o mesmo número. **Perda
     * silenciosa, e a tela dizia o contrário**: o resultado contava as quatro
     * como puladas.
     *
     * O repositório já conhecia a armadilha — foi ela que tornou `detail_path`
     * propriedade do PAR (tipo, provedor) em 01/09/2026 —, mas `external_ids`
     * tinha ficado de fora. Nunca doeu porque obra entrava uma de cada vez pela
     * busca, que já sabe o tipo; o import é a primeira coisa que insere anime e
     * mangá do mesmo provedor no mesmo gesto.
     *
     * ── Por que COLUNA, e não um join com `entries` ────────────────────────
     * O valor é derivável (toda obra tem tipo), e um join na consulta
     * consertaria a conciliação. O que ele não consertaria é `art_cache`, que é
     * chaveado por `(provider, external_id)` **sem referência a entrada** — de
     * propósito, porque arte não é dado pessoal. Lá não há de onde derivar, e é
     * isso que prova que o tipo pertence à IDENTIDADE, não à consulta.
     *
     * FK pro `slug`, com `restrict`, como `entries.media_type`: apagar um tipo
     * em uso recusa (brief, 3.12).
     */
    mediaType: text('media_type')
      .notNull()
      .references(() => mediaTypes.slug, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [unique().on(table.entryId, table.provider)],
)

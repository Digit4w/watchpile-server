import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import { providers } from './providers.js'

/**
 * O que a obra É, gravado aqui, para que ela não dependa do provedor estar de
 * pé — 07/09/2026.
 *
 * ── O problema, e ele é de hoje ─────────────────────────────────────────────
 * `getEntryDetails` resolvia ao vivo no provedor a cada visita, com as 6h de
 * `provider_cache` como único amortecedor. Com o AniList fora do ar, **toda
 * obra de anime e mangá da biblioteca passou a mostrar recusa** assim que a
 * entrada de cache expirou — obra que é da pessoa, que ela adicionou, e que o
 * nosso banco conhece pelo nome.
 *
 * A régua já existia e vinha do cache de arte (brief, 3.10): o que a pessoa
 * TEM não pode depender da CDN de terceiro daqui a dois anos. Esta tabela é
 * essa mesma decisão um nível acima — a arte já não dependia, o resto da obra
 * ainda dependia.
 *
 * ── Por que tabela, e não colunas em `entries` ──────────────────────────────
 * Dois motivos concretos, e nenhum é de gosto:
 *
 * - **`entries.total` já existe e é do USUÁRIO.** Um `total` do provedor na
 *   mesma linha seriam duas colunas com o mesmo nome e donos diferentes, e a
 *   régua de 31/08 (quando um campo responde duas perguntas, separam-se os
 *   objetos) diz o que fazer com isso antes de ele acontecer
 * - **Obra com dois vínculos tem dois detalhes.** `?source=` existe desde
 *   02/09 justamente porque ver a obra por um vínculo é ver aquele vínculo;
 *   uma coluna em `entries` teria um slot só para as duas fontes
 *
 * ── Por que a chave é (TIPO, provedor, id externo) ──────────────────────────
 * A mesma de `art_cache` e de `external_ids` desde a `0037`, e pelo mesmo
 * motivo: **sinopse e ano são fato do provedor, não dado pessoal**. Duas
 * pessoas com o mesmo filme compartilham uma linha, e quem abre a obra
 * revalida para as duas.
 *
 * E o tipo entra na identidade porque o id de um provedor é único DENTRO do
 * tipo — no MyAnimeList `21` é o anime One Piece e o mangá Death Note. Esta
 * tabela nasce já sabendo o que as duas vizinhas aprenderam doendo.
 *
 * ── O que ela NÃO guarda, e é decisão ───────────────────────────────────────
 * Vínculos, recomendações, grupos de unidade e links ficam fora. Os quatro já
 * degradam para lista vazia hoje sem quebrar a tela, e os quatro são **contexto
 * do provedor**, não a obra: sem provedor a tela mostra a obra inteira e as
 * seções de contexto somem, que é o que elas já fazem num provedor que não tem
 * o conceito.
 */
export const titleSnapshots = sqliteTable(
  'title_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * `cascade` como em `art_cache`, e não `restrict` como em `external_ids`.
     *
     * A diferença é o que se perde: lá some a informação de que esta obra é
     * `tmdb/550`, que é o que a reconecta se o provedor voltar; aqui some uma
     * cópia do que o provedor já disse. E provedor com obra vinculada não é
     * apagável de qualquer forma — `external_ids` recusa antes.
     */
    provider: text('provider')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    externalId: text('external_id').notNull(),
    /** Parte da identidade, não descrição — ver o cabeçalho. */
    mediaType: text('media_type')
      .notNull()
      .references(() => mediaTypes.slug, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    /**
     * O título **como o provedor o escreve**, que não é `entries.title`.
     *
     * Aquele é da pessoa e ela pode reescrevê-lo; este é o do catálogo, e é o
     * que a tela de detalhe mostra hoje quando resolve ao vivo. Guardar os dois
     * é o que faz a degradação não trocar um pelo outro sem avisar.
     */
    title: text('title').notNull(),
    year: integer('year'),
    synopsis: text('synopsis'),
    /**
     * O endereço da arte **na CDN do provedor**, não a nossa rota de cache.
     *
     * Os dois convivem de propósito: o arquivo mora em `art_cache`, e este é o
     * de onde ele veio. Quem decide qual dos dois vai pra tela continua sendo
     * `resolveTitle`, pela régua da posse (brief, 3.10).
     */
    art: text('art'),
    total: integer('total'),
    subtype: text('subtype'),
    score: real('score'),
    votes: integer('votes'),
    /**
     * Quando o provedor respondeu isto.
     *
     * **É o que vai pra tela**, não só carimbo de manutenção: servir um
     * snapshot como se fosse a resposta de agora afirmaria como atual uma
     * sinopse que pode ter meses. A data é a diferença entre degradar e mentir.
     */
    fetchedAt: integer('fetched_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique().on(table.provider, table.externalId, table.mediaType),
    /**
     * A limpeza do item 7 vai pedir as mais antigas em ordem, como o descarte
     * do cache de arte pede. Sem índice ela varre a tabela inteira.
     */
    index('title_snapshots_fetched_at_idx').on(table.fetchedAt),
  ],
)

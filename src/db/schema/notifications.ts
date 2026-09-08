import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { users } from './users.js'

/**
 * A central de notificações (brief, 3.9; design system, seções 4, 5, 7 e 8).
 *
 * **Notificação é EVENTO; a condição é ESTADO e mora no objeto** (design
 * system, 31/08/2026). Esta tabela guarda só a primeira metade — "o que
 * aconteceu" —, e ela é dispensável. "Ainda é verdade?" continua sendo
 * respondido pela linha do provedor, que não é aviso e não se dispensa.
 *
 * ── O que a linha guarda, e o que ela deliberadamente NÃO guarda ────────────
 * Ela guarda `kind` mais `params`, **nunca a frase**. Escrever
 * "IGDB needs an API key" numa coluna seria copy de tela nascendo no servidor —
 * a quarta ocorrência do padrão que o design system já registrou duas vezes
 * (seção 8: *frase escrita no servidor continua sendo copy de tela*) —, e aqui
 * ela é pior que nas outras três: a linha é PERSISTIDA, então a frase
 * sobreviveria à tradução do app e ficaria em inglês num histórico de dois anos
 * atrás. A UI é multi-idioma desde o início (brief, 3.8), e catálogo de copy só
 * alcança o que o cliente monta.
 *
 * ── A chave de dedupe, e por que ela é a coluna que faz a peça funcionar ────
 * **A notificação nasce uma vez por CONDIÇÃO, não uma por boot.** Sem isso,
 * dispensar é desfeito no próximo restart do container, e um sinal que volta
 * sozinho ensina a ser ignorado — que é a régua de "o barulho do sinal
 * acompanha o tamanho do fato" virada contra o próprio sinal.
 *
 * O índice único é **parcial**, e as duas condições dele são decisões:
 *
 * - `WHERE dedupe_key IS NOT NULL` deixa passar o evento puro. "O import
 *   terminou" acontece de novo toda vez que alguém importa, e dois imports são
 *   dois fatos
 * - `AND dismissed_at IS NULL` é o que permite a condição VOLTAR. Chave
 *   removida depois de recolocada é um fato novo, e um único global impediria
 *   o segundo aviso pra sempre
 *
 * **A chave carrega o escopo inteiro** (`instance:provider-missing-key:igdb`)
 * em vez de o índice ser `(user_id, dedupe_key)`. O motivo é mecânico e cala:
 * em SQLite dois `NULL` são DISTINTOS num índice único, e `user_id` é nulo
 * justamente na notificação de instância — o índice composto não deduplicaria
 * nada exatamente onde a dedupe importa, sem erro nenhum.
 *
 * ── Lido e dispensado são DOIS estados ──────────────────────────────────────
 * `read_at` zera o contador do sino; `dismissed_at` tira do painel e mantém na
 * rota. É essa distinção que dá endereço próprio a `/notifications`: se
 * dispensar apagasse a linha, o histórico seria o painel com rolagem, e não
 * mereceria uma URL.
 *
 * **Condição resolvida se dispensa sozinha**, e não é conceito novo — dispensar
 * significa "terminei com isto", e resolver a condição É terminar com ela. Quem
 * escreve `dismissed_at` nesse caso é o reconciliador, não a pessoa.
 *
 * ── `user_id` nulo é a audiência, não um dado faltando ──────────────────────
 * Audiência é campo desde o brief 3.9 (30/08/2026), porque a regra curta
 * "notificação é coisa de admin" erra em "o import terminou". `instance` não
 * tem dono — ela é da instalação e só admin a vê —, e é por isso que `user_id`
 * é nulável em vez de apontar pro primeiro admin: o dono da instalação pode
 * mudar, e o fato não é dele.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    /** Nulo quando `audience` é `instance` — o fato é da instalação, não de alguém. */
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),

    audience: text('audience', { enum: ['instance', 'user'] }).notNull(),

    /**
     * `info` não tem gravidade nenhuma, e é o degrau que o contador de seção
     * não precisava ter: "o import terminou" pintado de `warning` é a régua do
     * sinal virada contra si mesma (design system, seção 5).
     */
    severity: text('severity', {
      enum: ['info', 'warning', 'danger'],
    }).notNull(),

    /** O que aconteceu. A frase que descreve isto é montada pelo cliente. */
    kind: text('kind').notNull(),

    /** JSON com o que a frase interpola — `{"provider":"IGDB"}`. */
    params: text('params').notNull().default('{}'),

    /** Nulo = evento puro, que nunca deduplica. Ver o bloco acima. */
    dedupeKey: text('dedupe_key'),

    /**
     * `integer` em modo timestamp, como as outras oito tabelas do schema — e
     * não `text` com `datetime('now')`, que foi a primeira versão.
     *
     * A diferença não é de gosto e ela aparece na TELA: `datetime('now')` grava
     * UTC **sem sufixo de fuso** (`2026-09-05 22:02:41`), e uma string assim é
     * lida pelo navegador como hora LOCAL — uma notificação de agora apareceria
     * com três horas de idade no Brasil, sem nada dizendo que está errado. Em
     * modo timestamp o valor viaja como ISO com `Z`, e `formatRelativeTime` do
     * cliente, que já existe, funciona sem uma linha nova.
     */
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),

    readAt: integer('read_at', { mode: 'timestamp' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('notifications_dedupe_open')
      .on(table.dedupeKey)
      .where(
        sql`${table.dedupeKey} IS NOT NULL AND ${table.dismissedAt} IS NULL`,
      ),
    // A consulta da lista é sempre "as minhas, mais recentes primeiro".
    index('notifications_user_created').on(table.userId, table.createdAt),
  ],
)

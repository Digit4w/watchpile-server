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
 * O import (brief, 3.12; design system, seções 2, 5, 7 e 8).
 *
 * Uma linha por importação — em andamento ou já terminada. É ela que a tela lê
 * pra desenhar as duas metades de `/settings/import`: o cartão de "rodando",
 * com o contador, e o bloco de "última importação", com os três números.
 *
 * ── Por que a linha existe, em vez de o job viver só em memória ─────────────
 * A tela pergunta "em que pé está?" por uma rota, então o progresso precisa ser
 * legível de fora do laço que o produz. Guardar em memória (como o cache de
 * token do IGDB) resolveria a leitura enquanto o processo vive — e o processo
 * pode morrer no meio de um import de doze mil itens, que é justamente o caso
 * em que alguém quer saber o que aconteceu.
 *
 * **A consequência é um zumbi, e ele se resolve no BOOT**: uma linha
 * `running` cujo processo não existe mais é um import interrompido, não um
 * import em andamento. Quem a fecha é a reconciliação de partida, com
 * `error_kind = 'interrupted'` — mesma forma do reconciliador de condições de
 * instância, um gatilho diferente. Sem isso, o índice de "um por vez" trava a
 * instalação inteira pra sempre depois de um `docker restart` infeliz.
 *
 * ── "Uma importação por vez" é da INSTALAÇÃO, não da pessoa ─────────────────
 * O `better-sqlite3` é síncrono e o banco é um arquivo só: quem importa
 * congela o servidor de todo mundo (brief, riscos). O limite, portanto, é do
 * recurso — e o índice único parcial o grava no BANCO em vez de num
 * `if` que consulta antes de inserir.
 *
 * A tela de quem não é o dono do job diz que **há uma importação rodando neste
 * servidor**, sem dizer de quem: o fato que impede é a ocupação do recurso, e
 * o nome de quem ocupa não é dele.
 *
 * ── `source` não é `provider`, e por isso não é FK ──────────────────────────
 * `anilist` aqui e `anilist` em `providers` são o mesmo serviço em dois papéis
 * diferentes: o provedor **procura no catálogo**, a fonte de import **lê o
 * perfil de uma pessoa**. `csv` prova a distinção — é fonte e não é provedor de
 * coisa nenhuma. Uma FK amarraria o import à existência de uma definição de
 * provedor que ele não usa.
 *
 * > **O que É FK, e é onde o vínculo importa:** o id que a fonte trouxe se
 * > pendura em `external_ids`, que referencia `providers.slug`. Id de MAL mora
 * > no `jikan`, e é por isso que o Jikan não pode sair da semente enquanto o
 * > import de MAL existir (brief, 3.10).
 *
 * ── Os contadores são quatro, e cada um responde uma pergunta diferente ─────
 * `added` + `skipped` + `updated` + `unmatched` não somam `processed`, e não
 * deveriam: `unmatched` é um **recorte de `added`** — a obra entrou, com um
 * vínculo em vez de dois. É essa a diferença medida contra o Yamtrack, que
 * DESCARTA a obra cuja identidade ele não sabe usar; aqui ela entra, e o número
 * existe pra dizer quantas ainda pedem um vínculo.
 *
 * `skipped` e `updated` são os dois lados da colisão: com `mode = 'skip'` só o
 * primeiro anda, com `'overwrite'` só o segundo. Guardar os dois em vez de um
 * "colidiram" deixa o resultado legível sem consultar o modo.
 *
 * ── A lista de problemas guarda `kind` + `params`, NUNCA a frase ────────────
 * Mesma régua de `notifications`, um nível abaixo, e pelo mesmo motivo: a linha
 * é persistida, e uma frase gravada aqui sobreviveria à tradução do app —
 * ficaria em inglês num resultado que alguém abre semanas depois. O cliente
 * monta "Row 14: media_type “light-novel” isn’t a type on this installation" a
 * partir de `{"kind":"unknown-media-type","row":14,"params":{"value":"light-novel"}}`.
 *
 * **E a lista tem TETO; a contagem não.** Um CSV ruim produz um problema por
 * linha, e sem teto a coluna cresce junto com o arquivo — numa linha que a tela
 * relê a cada poll enquanto o job roda. `problem_count` é o número verdadeiro,
 * `problems` são os primeiros N. A tela diz "1.204 rows couldn't be read" e
 * mostra os que couberam, que é a informação útil: depois do vigésimo, o padrão
 * já apareceu.
 *
 * ── Cancelar é um PEDIDO com carimbo, não um status ─────────────────────────
 * `cancel_requested_at` em vez de um status `cancelling` porque as duas coisas
 * não são a mesma: o pedido é um fato datado de quem apertou `Stop`, e o
 * estado continua sendo `running` até o laço chegar no fim do lote e reparar
 * nele. Conflar os dois perderia *quando* o pedido chegou, que é o que explica
 * por que mais duzentas obras entraram depois dele.
 *
 * **O que já entrou FICA.** Cancelar interrompe, não desfaz — desfazer é outra
 * feature, e ela tem onde apoiar (o `event_log` registra origem `import`), mas
 * não é esta.
 */
export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    /** Import é conteúdo, e conteúdo é do usuário (brief, 3.9). */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** De onde se leu. Ver o bloco acima: fonte de import ≠ provedor. */
    source: text('source', { enum: ['anilist', 'mal', 'csv'] }).notNull(),

    /** O que fazer com a obra que já está na biblioteca. */
    mode: text('mode', { enum: ['skip', 'overwrite'] }).notNull(),

    status: text('status', {
      enum: ['running', 'done', 'failed', 'cancelled'],
    }).notNull(),

    /**
     * Quando alguém apertou `Stop`. O laço confere isto entre lotes; até lá o
     * `status` continua `running`, porque ainda está.
     */
    cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp' }),

    /**
     * Quantos itens a fonte entregou. **Nulo até ela responder** — no AniList a
     * coleção inteira vem numa resposta só, no MAL ela vem paginada, e no CSV
     * só se sabe depois de ler o arquivo. O denominador do contador da tela,
     * que fica escondido enquanto for nulo em vez de mentir um zero.
     */
    total: integer('total'),

    /** O numerador. Escrito uma vez por LOTE, não por item. */
    processed: integer('processed').notNull().default(0),

    /** Obras que não existiam e entraram. */
    added: integer('added').notNull().default(0),

    /** Já estavam na biblioteca, e `mode` era `skip`. */
    skipped: integer('skipped').notNull().default(0),

    /** Já estavam na biblioteca, e `mode` era `overwrite`. */
    updated: integer('updated').notNull().default(0),

    /** Recorte de `added`: entraram com um vínculo em vez de dois. */
    unmatched: integer('unmatched').notNull().default(0),

    /** O número verdadeiro de problemas — sem teto. */
    problemCount: integer('problem_count').notNull().default(0),

    /** Os primeiros N, como `[{kind, row?, params}]`. Nunca a frase. */
    problems: text('problems').notNull().default('[]'),

    /**
     * Por que o job inteiro falhou — `user-not-found`, `private-profile`,
     * `provider-down`, `invalid-file`, `interrupted`. `kind`, não frase, pelo
     * mesmo motivo da lista acima.
     *
     * É diferente de um problema: o problema é de um item e o import continua;
     * isto para tudo. A separação segue a régua da recusa (design system,
     * seção 5) — o alcance do sinal é o alcance real do fato.
     */
    errorKind: text('error_kind'),
    errorParams: text('error_params').notNull().default('{}'),

    startedAt: integer('started_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),

    finishedAt: integer('finished_at', { mode: 'timestamp' }),
  },
  (table) => [
    /**
     * **Uma importação por vez, na instalação inteira.** Como só uma linha pode
     * ter `status = 'running'`, o banco recusa a segunda em vez de o código
     * consultar-e-inserir. O índice é parcial, então ele indexa só a linha viva
     * — nunca as milhares já terminadas.
     */
    uniqueIndex('import_jobs_one_running')
      .on(table.status)
      .where(sql`${table.status} = 'running'`),

    /** "A minha última importação" é a consulta que a tela sempre faz. */
    index('import_jobs_user_started').on(table.userId, table.startedAt),
  ],
)

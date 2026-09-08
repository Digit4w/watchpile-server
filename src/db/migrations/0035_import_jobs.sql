-- O import (brief, 3.12). Uma linha por importação — em andamento ou terminada.
--
-- Ela existe em vez de o job viver só em memória porque a TELA pergunta "em que
-- pé está?" por uma rota: o progresso precisa ser legível de fora do laço que o
-- produz. A consequência é um zumbi — linha `running` cujo processo morreu —, e
-- ele se resolve no BOOT, com `error_kind = 'interrupted'`. Sem isso, um
-- `docker restart` infeliz no meio de um import trava a instalação pra sempre.
--
-- ── O índice único parcial é a peça que carrega semântica ────────────────────
-- "Uma importação por vez" é da INSTALAÇÃO, não da pessoa: o `better-sqlite3` é
-- síncrono e o banco é um arquivo só, então quem importa congela o servidor de
-- todo mundo. O limite é do RECURSO, e o índice o grava no banco em vez de num
-- `if` que consulta antes de inserir.
--
-- Conferido contra o SQLite real antes de escrever, que é a regra desde a
-- migration anterior:
--   · segundo `running`, de outro usuário   → SQLITE_CONSTRAINT_UNIQUE
--   · qualquer número de `done`             → passa (o WHERE os exclui do índice)
--   · novo `running` após o anterior fechar → passa
--
-- E um detalhe que contrasta com o que a `0034` ensinou: **a recusa por
-- constraint NÃO consome o autoincrement** — os ids saíram contíguos. Quem
-- consome é `onConflictDoNothing`, que insere-e-ignora; aqui a inserção é
-- revertida.
--
-- ── O que a linha guarda, e o que ela deliberadamente NÃO guarda ─────────────
-- `problems` guarda `kind` + `params`, nunca a frase — mesma régua da `0034`, e
-- pelo mesmo motivo: a linha é persistida, e uma frase gravada aqui ficaria em
-- inglês num resultado que alguém abre semanas depois, com o app traduzido.
--
-- **A lista tem TETO e a contagem não.** Um CSV ruim produz um problema por
-- linha, e sem teto a coluna cresce junto com o arquivo — numa linha que a tela
-- relê a cada poll enquanto o job roda. `problem_count` é o número verdadeiro.
--
-- `source` não é FK pra `providers`, e a distinção é real: o provedor procura no
-- CATÁLOGO, a fonte de import lê o PERFIL de uma pessoa — e `csv` é fonte sem
-- ser provedor de coisa nenhuma. O que é FK é o id que a fonte trouxe, que se
-- pendura em `external_ids`.
--
-- Os quatro contadores não somam `processed`, e não deveriam: `unmatched` é um
-- RECORTE de `added` — a obra entrou, com um vínculo em vez de dois. É a
-- diferença medida contra o Yamtrack, que descarta a obra sem par.
--
-- Nada a preencher: instalação existente começa sem import nenhum.

CREATE TABLE `import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`cancel_requested_at` integer,
	`total` integer,
	`processed` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`unmatched` integer DEFAULT 0 NOT NULL,
	`problem_count` integer DEFAULT 0 NOT NULL,
	`problems` text DEFAULT '[]' NOT NULL,
	`error_kind` text,
	`error_params` text DEFAULT '{}' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_one_running` ON `import_jobs` (`status`) WHERE "import_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `import_jobs_user_started` ON `import_jobs` (`user_id`,`started_at`);
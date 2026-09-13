-- A varredura de atualização — 13/09/2026, item 11(c) da fila do dono.
--
-- `kind` ganha um terceiro valor, `refresh`, e ele **não precisa de DDL**: o
-- enum do Drizzle é tipagem, e a `0053` criou a coluna sem `CHECK`.
--
-- O que precisa é `source`, e o motivo é honestidade de dado: ela nomeia de
-- ONDE se leu — `anilist`, `mal`, `csv` —, e uma varredura não vem de fonte
-- nenhuma. Ela relê os provedores que as obras já apontam, que podem ser vários
-- dentro do mesmo job. Gravar `'csv'` ali para satisfazer o `NOT NULL` seria
-- uma mentira no banco, do tipo que fica plausível e nunca é conferida.
--
-- ── Por que a coluna inteira, e não um valor a mais no enum ─────────────────
-- `source` é FONTE DE IMPORT, e o comentário da tabela separa isso de provedor
-- com cuidado: `csv` prova a distinção, porque é fonte e não é provedor de
-- coisa nenhuma. Um `'refresh'` dentro desse enum poria um TIPO DE TRABALHO
-- numa coluna que responde outra pergunta — e `kind` já responde essa.
--
-- Nulo passa a significar *"este trabalho não veio de uma fonte"*, e é o estado
-- de todo `refresh`. `import` e `enrich` continuam preenchendo.
--
-- ── O SQLite não altera a nulidade de uma coluna no lugar ───────────────────
-- `ALTER TABLE ... ALTER COLUMN` não existe aqui, então o caminho é recriar a
-- tabela. As linhas já gravadas atravessam intactas, e os dois índices são
-- refeitos como estavam — o único parcial, por `(status, kind)`, é o que
-- permite um trabalho de cada tipo por vez.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text DEFAULT 'import' NOT NULL,
	`source` text,
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
INSERT INTO `__new_import_jobs` SELECT
	`id`, `user_id`, `kind`, `source`, `mode`, `status`, `cancel_requested_at`,
	`total`, `processed`, `added`, `skipped`, `updated`, `unmatched`,
	`problem_count`, `problems`, `error_kind`, `error_params`, `started_at`,
	`finished_at`
FROM `import_jobs`;
--> statement-breakpoint
DROP TABLE `import_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_import_jobs` RENAME TO `import_jobs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_one_running` ON `import_jobs` (`status`,`kind`) WHERE `import_jobs`.`status` = 'running';
--> statement-breakpoint
CREATE INDEX `import_jobs_user_started` ON `import_jobs` (`user_id`,`started_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

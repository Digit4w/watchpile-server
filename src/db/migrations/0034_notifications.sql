-- A central de notificações (brief, 3.9). Notificação é EVENTO — "o que
-- aconteceu" —, e é dispensável; "ainda é verdade?" continua sendo respondido
-- pelo ESTADO na linha do objeto, que não é aviso e não se dispensa.
--
-- A linha guarda `kind` + `params`, NUNCA a frase: escrever "IGDB needs an API
-- key" numa coluna seria copy de tela nascendo no servidor, e aqui é pior que
-- nos outros casos porque a linha é persistida — a frase sobreviveria à
-- tradução do app e ficaria em inglês num histórico de dois anos atrás. A UI é
-- multi-idioma desde o início (brief, 3.8).
--
-- Os carimbos são `integer` em modo timestamp, como as outras oito tabelas do
-- schema. `text` com `datetime('now')` foi a primeira versão, e a diferença
-- aparece na TELA: aquilo grava UTC sem sufixo de fuso, e o navegador lê uma
-- string assim como hora LOCAL — uma notificação de agora apareceria com três
-- horas de idade no Brasil, calada.
--
-- O índice único é PARCIAL, e as duas condições são decisões:
--   · `dedupe_key IS NOT NULL` deixa passar o evento puro — dois imports são
--     dois fatos, e "o import terminou" não deduplica
--   · `dismissed_at IS NULL` permite a condição VOLTAR: chave removida depois
--     de recolocada é fato novo, e um único global calaria o segundo aviso
--     pra sempre
--
-- A chave carrega o escopo inteiro (`instance:provider-missing-key:igdb`) em
-- vez de o índice ser (user_id, dedupe_key), e o motivo é mecânico: em SQLite
-- dois NULL são DISTINTOS num índice único, e `user_id` é nulo justamente na
-- notificação de instância — o índice composto não deduplicaria nada
-- exatamente onde a dedupe importa, e sem erro nenhum.
--
-- `user_id` nulo é a AUDIÊNCIA, não um dado faltando: o fato de instância é da
-- instalação e só o admin o vê. Apontá-lo pro primeiro admin seria dar dono a
-- um fato que não tem — o dono da instalação pode mudar.
--
-- Nada a preencher: instalação existente começa sem notificação nenhuma, e o
-- reconciliador de condições de instância cria as que couberem na primeira
-- leitura.

CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`audience` text NOT NULL,
	`severity` text NOT NULL,
	`kind` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`dedupe_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`read_at` integer,
	`dismissed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_open` ON `notifications` (`dedupe_key`) WHERE "notifications"."dedupe_key" IS NOT NULL AND "notifications"."dismissed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `notifications_user_created` ON `notifications` (`user_id`,`created_at`);

-- A checagem de versão nova — 10/09/2026, decisão do dono: LIGADA, com como
-- desligar. É a única saída para fora que o servidor faz sem alguém ter pedido,
-- e num produto self-hosted isso pede consentimento legível.
--
-- `update_checked_at` guarda quando a consulta ACONTECEU, não quando ela achou
-- algo: é o que segura a cadência, e é carimbado mesmo quando ela falha — senão
-- uma instalação sem rede tentaria a cada leitura do sino.
--
-- `update_latest_version` e `update_latest_url` existem porque a condição de
-- notificação é derivada de ESTADO, sem rede: ela roda em toda leitura de admin,
-- e uma condição que precisasse de `fetch` faria o sino esperar a internet.
ALTER TABLE `settings` ADD `update_check_enabled` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `update_checked_at` integer;
--> statement-breakpoint
ALTER TABLE `settings` ADD `update_latest_version` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD `update_latest_url` text;

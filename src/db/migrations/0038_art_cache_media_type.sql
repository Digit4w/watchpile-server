-- **O tipo faz parte da identidade externa, TAMBÉM aqui** — 07/09/2026.
--
-- É o mesmo defeito que a `0037` tirou de `external_ids`, na tabela que aquela
-- migration nomeou como ainda tendo: `art_cache` chaveava por `(provedor, id
-- externo)`, e o id de um provedor é único DENTRO do tipo. No MyAnimeList `21`
-- é o anime One Piece **e** o mangá Death Note — uma linha só para os dois, com
-- o segundo mostrando o pôster do primeiro. Plausível, na coluna certa, sem
-- erro nenhum.
--
-- ── Por que ele saiu de latente agora ───────────────────────────────────────
-- A `0037` registrou este caso como "ciclo próprio" porque ele exigia as duas
-- obras com arte já cacheada, o que a busca — uma obra por vez — quase nunca
-- produz. O aquecimento do cache depois de um import (`import.art.ts`) faz
-- exatamente isso: percorre anime e mangá do mesmo provedor no mesmo gesto. O
-- teste dele foi quem cobrou, gravando **uma** linha onde deviam ser duas.
--
-- ── A linha órfã TEM resposta, e a `0037` dizia que não ─────────────────────
-- Aquela migration afirmou que o backfill não teria o que fazer com uma linha
-- sem obra correspondente. Tem, e é a natureza da tabela que responde: **isto é
-- cache**. Linha que não se consegue classificar se JOGA FORA, e o que se perde
-- é uma ida à rede na próxima vez que alguém olhar aquela carta. Em
-- `external_ids` descartar seria perder a identidade da obra; aqui é limpar
-- prateleira.
--
-- Duas classes caem:
--   · sem vínculo nenhum — a obra foi apagada depois de a arte ser cacheada
--   · com vínculos de MAIS DE UM tipo para o mesmo (provedor, id) — é
--     exatamente a colisão, e qual dos dois pôsteres está no arquivo não é
--     recuperável. Adivinhar aqui gravaria a arte errada com cara de certa,
--     que é o defeito que esta migration veio tirar
--
-- Custo assumido: o arquivo em disco dessas linhas fica órfão. O descarte LRU
-- enxerga o índice, não o diretório, então ele não os alcança — são poucos, são
-- pequenos, e apagá-los precisaria de uma varredura que este servidor não tem
-- (brief, 3.10: sob demanda, nunca em varredura).
--
-- ── O nome do ARQUIVO muda junto, e por isso as linhas velhas continuam ─────
-- `fileNameFor` passa a levar o tipo no hash — senão duas linhas legítimas
-- apontariam para um arquivo só, e a segunda gravação sobrescreveria a primeira.
-- As linhas que sobrevivem a este backfill guardam o nome ANTIGO na coluna
-- `file_name` e continuam servindo: o nome é dado, não conta refeita a cada
-- leitura. Só o que for gravado daqui pra frente usa o hash novo.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_art_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`media_type` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`media_type`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_art_cache`("id", "provider", "external_id", "media_type", "file_name", "content_type", "bytes", "last_used_at", "created_at")
SELECT `a`.`id`, `a`.`provider`, `a`.`external_id`, `t`.`media_type`, `a`.`file_name`, `a`.`content_type`, `a`.`bytes`, `a`.`last_used_at`, `a`.`created_at`
FROM `art_cache` `a`
JOIN (
	SELECT `provider`, `external_id`, MIN(`media_type`) AS `media_type`, COUNT(DISTINCT `media_type`) AS `tipos`
	FROM `external_ids`
	GROUP BY `provider`, `external_id`
) `t` ON `t`.`provider` = `a`.`provider` AND `t`.`external_id` = `a`.`external_id` AND `t`.`tipos` = 1;--> statement-breakpoint
DROP TABLE `art_cache`;--> statement-breakpoint
ALTER TABLE `__new_art_cache` RENAME TO `art_cache`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `art_cache_provider_external_id_media_type_unique` ON `art_cache` (`provider`,`external_id`,`media_type`);--> statement-breakpoint
CREATE INDEX `art_cache_last_used_idx` ON `art_cache` (`last_used_at`);

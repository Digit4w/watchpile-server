-- Provedor vira LINHA, e o enum de `external_ids.provider` vira chave
-- estrangeira (brief, 3.10: "os dois enums fixos abrem").
--
-- A FK aponta pro `slug` e não pro `id`, e a escolha se paga aqui: as linhas
-- existentes já guardam 'tmdb', 'anilist' e afins como texto, então o enum vira
-- tabela **sem reescrever uma linha de dado**.

CREATE TABLE `media_type_providers` (
	`media_type_slug` text NOT NULL,
	`provider_slug` text NOT NULL,
	PRIMARY KEY(`media_type_slug`, `provider_slug`),
	FOREIGN KEY (`media_type_slug`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`provider_slug`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`attribution` text,
	`auth` text NOT NULL,
	`endpoints` text NOT NULL,
	`field_map` text NOT NULL,
	`credentials` text DEFAULT '[]' NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`credential_values` text DEFAULT '{}' NOT NULL,
	`option_values` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);--> statement-breakpoint
-- O TMDB nasce como DEFINIÇÃO, igual à que o usuário escreveria — não como caso
-- especial em código (brief, 3.10). Se o embutido passa por um atalho, a
-- definição do usuário vira cidadão de segunda e ninguém percebe que quebrou.
--
-- Isto roda ANTES da recriação de `external_ids`, e a ordem não é estética: a
-- FK nova aponta pra `providers.slug`, e com `foreign_keys=OFF` a cópia
-- passaria calada deixando linha órfã. Foi o defeito que a migration 0006 quase
-- teve (`server/CLAUDE.md`), e a regra que saiu dele é que migration com seed
-- se lê à mão antes de rodar.
--
-- `credential_values` e `option_values` ficam no default: a credencial é do
-- admin e a chave embarcada não mora no banco — ela é o último degrau da
-- precedência, resolvida em leitura (`providers.credentials.ts`).
INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `auth`, `endpoints`, `field_map`, `credentials`, `options`) VALUES
	('tmdb', 'TMDB', 'https://api.themoviedb.org/3', 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
	 '{"style":"query-key","param":"api_key","credential":"api_key"}',
	 '{"search":{"path":"/search/multi","queryParam":"query"},"detail":{"path":"/movie/{id}"},"test":{"path":"/configuration"}}',
	 '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview"}',
	 '[{"key":"api_key","label":"API key","help":"Free, from your TMDB account settings under API."}]',
	 '[{"key":"nsfw","type":"boolean","label":"Include adult titles","default":false},{"key":"language","type":"string","label":"Metadata language","default":"en-US"}]');
--> statement-breakpoint
-- A junção só nasce pros tipos que EXISTEM nesta instalação. O wizard de
-- primeiro uso vai semear tipos parcialmente (brief, 3.9), e provedor sem tipo
-- a que se ligar fica **ocioso, não quebrado** — nada aqui trata isso como erro.
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`)
SELECT 'movie', 'tmdb' WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'movie')
UNION ALL SELECT 'tv', 'tmdb' WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'tv');
--> statement-breakpoint
-- A guarda de órfã, e ela é o motivo de a recriação vir depois do seed.
-- `external_ids` está vazia em toda instalação que existe hoje (nenhum provedor
-- foi integrado ainda), mas uma linha apontando pra 'anilist' — provedor que o
-- v1 não semeia — viraria referência quebrada em silêncio com foreign_keys=OFF.
-- Apagar é seguro justamente porque não há o que perder; quando AniList entrar,
-- ele entra como semeadura, não como conserto.
DELETE FROM `external_ids` WHERE `provider` NOT IN (SELECT `slug` FROM `providers`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_ids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_external_ids`("id", "entry_id", "provider", "external_id", "created_at") SELECT "id", "entry_id", "provider", "external_id", "created_at" FROM `external_ids`;--> statement-breakpoint
DROP TABLE `external_ids`;--> statement-breakpoint
ALTER TABLE `__new_external_ids` RENAME TO `external_ids`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `external_ids_entry_id_provider_unique` ON `external_ids` (`entry_id`,`provider`);
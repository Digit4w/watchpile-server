-- O "como" de uma busca é do PAR (tipo, provedor), não do provedor — 01/09/2026.
--
-- O TMDB obriga: `/search/movie` e `/search/tv` são rotas diferentes, e as duas
-- devolvem campos diferentes pra mesma ideia (`title`/`name`,
-- `release_date`/`first_air_date`). Um mapa de campos por provedor descreveria
-- um dos dois e mentiria sobre o outro. A junção JÁ É esse par, então é onde o
-- "como" mora.
--
-- Junto vem o cache de resposta, que o brief 3.10 chama de requisito e não de
-- otimização: a chave é da instância, então o rate limit é compartilhado por
-- todo mundo que usa aquele servidor.

CREATE TABLE `provider_cache` (
	`provider_slug` text NOT NULL,
	`request_key` text NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`provider_slug`, `request_key`),
	FOREIGN KEY (`provider_slug`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `media_type_providers` ADD `search_path` text;--> statement-breakpoint
ALTER TABLE `media_type_providers` ADD `field_map` text;
--> statement-breakpoint
-- A semeadura acompanha o schema. Ela é UPDATE e não INSERT porque as linhas já
-- existem desde a 0007 — o que muda é a definição ganhar o "como" por par, e as
-- opções passarem a viajar por `{option:<chave>}` no endpoint em vez de não
-- viajarem.
--
-- `providers.seed.ts` continua sendo a fonte viva; esta migration é o retrato
-- congelado dela nesta data, e o teste que compara os dois é o que impede a
-- divergência.
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/search/multi","queryParam":"query","query":{"include_adult":"{option:nsfw}","language":"{option:language}"}},"detail":{"path":"/movie/{id}","query":{"language":"{option:language}"}},"test":{"path":"/configuration"}}' WHERE `slug` = 'tmdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/search/movie', `field_map` = '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview"}' WHERE `provider_slug` = 'tmdb' AND `media_type_slug` = 'movie';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/search/tv', `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","art":"poster_path","synopsis":"overview"}' WHERE `provider_slug` = 'tmdb' AND `media_type_slug` = 'tv';

-- O SEGUNDO provedor, e a coluna que ele obrigou.
--
-- `detail_field_map` existe porque a resposta de busca e a de detalhe do Open
-- Library não nomeiam as mesmas coisas: a busca devolve `cover_i` e a detalhe
-- devolve `covers[0]`. O TMDB escondia isso, porque lá os dois endpoints usam
-- os mesmos nomes. Nulo cai no mapa da busca, então nada do TMDB muda.
--
-- As linhas abaixo saíram de `scripts/print-provider-seed.ts`, que lê
-- `providers.seed.ts`. A migration é o retrato congelado do módulo; digitar o
-- retrato à mão foi como `detail_path` nasceu torto num dos dois lados.

ALTER TABLE `media_type_providers` ADD `detail_field_map` text;--> statement-breakpoint
INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('openlibrary', 'Open Library', 'https://openlibrary.org', NULL, 'https://covers.openlibrary.org/b/id/{path}-M.jpg', '{"style":"none"}', '{"search":{"path":"/search.json","queryParam":"q","query":{"limit":"20","fields":"key,title,first_publish_year,cover_i,author_name"},"resultsPath":"docs"},"detail":{"path":"{id}.json"},"test":{"path":"/search.json","query":{"q":"a","limit":"1"}}}', '{"externalId":"key","title":"title","year":"first_publish_year","art":"cover_i"}', '[]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `field_map`, `detail_path`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'book', 'openlibrary', NULL, NULL, NULL, '{"externalId":"key","title":"title","art":"covers.0","synopsis":"description","links":[{"label":"Open Library","path":"key","template":"https://openlibrary.org{id}"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'book');

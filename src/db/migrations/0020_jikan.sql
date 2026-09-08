-- O TERCEIRO provedor, e as duas coisas que ele cobrou.
--
-- `rate_limit` é do PROVEDOR, não constante nossa: o TMDB tolera ~50 por
-- segundo, o Jikan documenta 3 por segundo e 60 por minuto. Um número só
-- serviria ao mais permissivo e derrubaria o mais estrito, e uma tabela em
-- código seria o `if (slug === 'jikan')` que a primeira invariante proíbe.
--
-- A outra é a lista PLANA de unidades — anime não agrupa episódio. Não é
-- coluna nova: é `units_path` sem `{group}` e mapa sem `unitGroups`, que o
-- desenho de 01/09 já previa e nunca tinha exercido.
--
-- E corrige o endpoint de teste do Open Library, que estava em `q=a`: ele
-- recusa termo com menos de três caracteres com 422, e o admin lia isso como
-- "o provedor está fora do ar". Gerado de `providers.seed.ts`.

ALTER TABLE `providers` ADD `rate_limit` text;
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/search.json","queryParam":"q","query":{"limit":"20","fields":"key,title,first_publish_year,cover_i,author_name"},"resultsPath":"docs"},"detail":{"path":"{id}.json"},"test":{"path":"/search.json","query":{"q":"test","limit":"1"}}}', `field_map` = '{"externalId":"key","title":"title","year":"first_publish_year","art":"cover_i"}', `rate_limit` = NULL WHERE `slug` = 'openlibrary';
--> statement-breakpoint
INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `rate_limit`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('jikan', 'Jikan (MyAnimeList)', 'https://api.jikan.moe/v4', 'Data from MyAnimeList, via the Jikan API.', NULL, '{"style":"none"}', '{"perSecond":1,"burst":3}', '{"search":{"path":"/anime","queryParam":"q","query":{"limit":"20","sfw":"true"},"resultsPath":"data"},"detail":{"path":"/anime/{id}"},"test":{"path":"/anime","query":{"q":"test","limit":"1"}}}', '{"externalId":"mal_id","title":"title","year":"year","total":"episodes","art":"images.jpg.image_url","synopsis":"synopsis","score":"score","votes":"scored_by"}', '[]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `field_map`, `detail_path`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'anime', 'jikan', NULL, NULL, '/anime/{id}', '{"externalId":"data.mal_id","title":"data.title","year":"data.year","total":"data.episodes","art":"data.images.jpg.image_url","synopsis":"data.synopsis","score":"data.score","votes":"data.scored_by","links":[{"label":"MyAnimeList","path":"data.url"}]}', '/anime/{id}/episodes', '{"number":"mal_id","title":"title","date":"aired"}' WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'anime');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `field_map`, `detail_path`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'manga', 'jikan', '/manga', '{"externalId":"mal_id","title":"title","year":"published.prop.from.year","total":"chapters","art":"images.jpg.image_url","synopsis":"synopsis","score":"score","votes":"scored_by"}', '/manga/{id}', '{"externalId":"data.mal_id","title":"data.title","year":"data.published.prop.from.year","total":"data.chapters","art":"data.images.jpg.image_url","synopsis":"data.synopsis","score":"data.score","votes":"data.scored_by","links":[{"label":"MyAnimeList","path":"data.url"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'manga');

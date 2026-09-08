--
-- Links para fora e `append_to_response` no detalhe.
--
-- Gerado A PARTIR de `providers.seed.ts`, não digitado: a migration é o retrato
-- congelado da semente, e um teste compara os dois campo a campo. Digitar o
-- JSON à mão é como os dois divergem.
--
-- Os links são CONTEXTO do provedor, não `external_ids`: IMDb e Wikidata não
-- são provedores que este servidor conhece, e criar linha pra eles seria
-- inventar provedor que ninguém configurou (brief, 3.10).
--
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/search/multi","queryParam":"query","query":{"include_adult":"{option:nsfw}","language":"{option:language}"}},"detail":{"path":"/movie/{id}","query":{"language":"{option:language}","append_to_response":"external_ids"}},"test":{"path":"/configuration"}}' WHERE `slug` = 'tmdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `field_map` = '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","links":[{"label":"TMDB","path":"id","template":"https://www.themoviedb.org/movie/{id}"},{"label":"IMDb","path":"external_ids.imdb_id","template":"https://www.imdb.com/title/{id}/"},{"label":"Wikidata","path":"external_ids.wikidata_id","template":"https://www.wikidata.org/wiki/{id}"}]}' WHERE `media_type_slug` = 'movie' AND `provider_slug` = 'tmdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","links":[{"label":"TMDB","path":"id","template":"https://www.themoviedb.org/tv/{id}"},{"label":"IMDb","path":"external_ids.imdb_id","template":"https://www.imdb.com/title/{id}/"},{"label":"Wikidata","path":"external_ids.wikidata_id","template":"https://www.wikidata.org/wiki/{id}"}],"unitGroups":{"path":"seasons","number":"season_number","name":"name","count":"episode_count"}}' WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';

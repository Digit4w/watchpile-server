--
-- O total de unidades da série. Gerado a partir de `providers.seed.ts`, como a
-- 0015 — a migration é o retrato congelado da semente, e digitar o JSON à mão
-- é como os dois divergem.
--
UPDATE `media_type_providers` SET `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","total":"number_of_episodes","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","links":[{"label":"TMDB","path":"id","template":"https://www.themoviedb.org/tv/{id}"},{"label":"IMDb","path":"external_ids.imdb_id","template":"https://www.imdb.com/title/{id}/"},{"label":"Wikidata","path":"external_ids.wikidata_id","template":"https://www.wikidata.org/wiki/{id}"}],"unitGroups":{"path":"seasons","number":"season_number","name":"name","count":"episode_count"}}' WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';

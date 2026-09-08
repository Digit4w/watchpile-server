-- As RECOMENDAÇÕES de uma obra — 03/09/2026.
--
-- O handoff supunha dois provedores; medir achou **três**, e o terceiro é o
-- TMDB, que é justamente quem serve `movie` e `tv`:
--
--   TMDB     recommendations.results[]   20 de 538, via append_to_response
--   AniList  recommendations.edges[]     o que se pedir, com sort obrigatório
--   IGDB     similar_games[]             dez, fixos
--
-- Kitsu (404 no endpoint), Open Library e Jikan não têm o conceito.
--
-- ── Nenhuma coluna nova, e nenhum campo novo no mapa ──────────────────────
--
-- `RelationMap` já descrevia tudo que os três devolvem — id, título, arte,
-- ano, formato de ano e token de tipo. **Isso foi medido campo a campo antes
-- da primeira linha de código**, que é a régua que o ciclo do `parent_game`
-- deixou: modelar por suposição é o que se refaz no primeiro provedor
-- seguinte. O que muda é só `field_map.recommendations` existir ao lado de
-- `field_map.relations`, lendo pelo mesmo mapeador.
--
-- ── Por que campo separado, se a forma é a mesma ──────────────────────────
--
-- Porque o significado não é. Vínculo é FATO — isto *é* a prequela daquilo, e
-- o provedor está afirmando. Recomendação é OPINIÃO, com cauda longa. Numa
-- lista só a distinção sumiria justamente onde ela é o conteúdo.
--
-- E por isso `kind` fica NULO: nenhum dos três nomeia a relação, porque não
-- há relação a nomear. `kindConst: 'Recommended'` seria o servidor escrevendo
-- copy de tela — quem nomeia a seção é quem fala o idioma de quem lê.
--
-- ── O que muda nos ENDPOINTS, e o custo assumido ──────────────────────────
--
-- Os três passam a PEDIR o campo, senão o mapa apontaria pra um caminho
-- ausente e a lista viria vazia em silêncio — a lição do `subtype`, na 0027.
--
-- No TMDB o pedido é `append_to_response=external_ids,recommendations`, e não
-- o endpoint `/movie/{id}/recommendations`, que existe. Ir por lá custaria
-- coluna nova na junção (o caminho é por par), segunda ida à rede e segunda
-- entrada de cache — três coisas pra trazer o mesmo JSON. **O custo medido**
-- é a resposta de detalhe de uma série indo de 5,5 KB a 19,5 KB, e é ela que
-- fica em `provider_cache`. Não dá pra pedir menos: `append_to_response` não
-- seleciona campo.
--
-- No AniList, `sort: RATING_DESC` é obrigatório — sem ele a ordem não é a de
-- relevância (medido: 298, 254, 1172) — e `pageInfo` derruba o servidor deles
-- com 500, isolado num pedido por vez. `perPage: 10` é o único teto que
-- alguém escolhe dos três.
--
-- Gerado por `scripts/print-provider-seed.ts <slug> --update`.

UPDATE `providers` SET `endpoints` = '{"search":{"path":"/search/multi","queryParam":"query","query":{"include_adult":"{option:nsfw}","language":"{option:language}"}},"detail":{"path":"/movie/{id}","query":{"language":"{option:language}","append_to_response":"external_ids,recommendations"}},"test":{"path":"/configuration"}}', `field_map` = '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview"}', `rate_limit` = NULL, `timeout_ms` = 10000 WHERE `slug` = 'tmdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/search/movie', `search_body` = NULL, `field_map` = '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","links":[{"label":"TMDB","path":"id","template":"https://www.themoviedb.org/movie/{id}"},{"label":"IMDb","path":"external_ids.imdb_id","template":"https://www.imdb.com/title/{id}/"},{"label":"Wikidata","path":"external_ids.wikidata_id","template":"https://www.wikidata.org/wiki/{id}"}],"recommendations":{"path":"recommendations.results","id":"id","title":"title","art":"poster_path","year":"release_date"}}', `detail_path` = '/movie/{id}', `detail_body` = NULL, `detail_field_map` = NULL, `provider_type_token` = NULL, `relations_path` = NULL, `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'movie' AND `provider_slug` = 'tmdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/search/tv', `search_body` = NULL, `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","total":"number_of_episodes","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","links":[{"label":"TMDB","path":"id","template":"https://www.themoviedb.org/tv/{id}"},{"label":"IMDb","path":"external_ids.imdb_id","template":"https://www.imdb.com/title/{id}/"},{"label":"Wikidata","path":"external_ids.wikidata_id","template":"https://www.wikidata.org/wiki/{id}"}],"unitGroups":{"path":"seasons","number":"season_number","name":"name","count":"episode_count","art":"poster_path"},"recommendations":{"path":"recommendations.results","id":"id","title":"name","art":"poster_path","year":"first_air_date"}}', `detail_path` = '/tv/{id}', `detail_body` = NULL, `detail_field_map` = NULL, `provider_type_token` = NULL, `relations_path` = NULL, `units_path` = '/tv/{id}/season/{group}', `unit_map` = '{"number":"episode_number","title":"name","synopsis":"overview","art":"still_path","date":"air_date","runtime":"runtime"}' WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/","queryParam":"","resultsPath":"data.Page.media","body":{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"ANIME"}}}},"detail":{"path":"/","body":{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl relations { edges { relationType node { id type title { romaji } coverImage { large } startDate { year } } } } recommendations(sort: RATING_DESC, perPage: 10) { edges { node { mediaRecommendation { id type title { romaji } coverImage { large } startDate { year } } } } } } }","variables":{"id":"{id}","type":"ANIME"}}}},"test":{"path":"/","body":{"kind":"json","value":{"query":"query { Page(perPage: 1) { media(id: 1) { id } } }"}}},"textFormat":"html"}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","art":"coverImage.large","synopsis":"description","subtype":"format"}', `rate_limit` = '{"perSecond":0.5,"burst":5}', `timeout_ms` = 10000 WHERE `slug` = 'anilist';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"ANIME"}}}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"episodes","art":"coverImage.large","synopsis":"description","subtype":"format"}', `detail_path` = NULL, `detail_body` = '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl relations { edges { relationType node { id type title { romaji } coverImage { large } startDate { year } } } } recommendations(sort: RATING_DESC, perPage: 10) { edges { node { mediaRecommendation { id type title { romaji } coverImage { large } startDate { year } } } } } } }","variables":{"id":"{id}","type":"ANIME"}}}', `detail_field_map` = '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.episodes","art":"data.Media.coverImage.large","synopsis":"data.Media.description","subtype":"data.Media.format","relations":{"path":"data.Media.relations.edges","kind":"relationType","id":"node.id","title":"node.title.romaji","art":"node.coverImage.large","year":"node.startDate.year","typeToken":"node.type"},"recommendations":{"path":"data.Media.recommendations.edges","id":"node.mediaRecommendation.id","title":"node.mediaRecommendation.title.romaji","art":"node.mediaRecommendation.coverImage.large","year":"node.mediaRecommendation.startDate.year","typeToken":"node.mediaRecommendation.type"},"links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', `provider_type_token` = 'ANIME', `relations_path` = NULL, `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'anilist';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"MANGA"}}}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"chapters","art":"coverImage.large","synopsis":"description","subtype":"format"}', `detail_path` = NULL, `detail_body` = '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl relations { edges { relationType node { id type title { romaji } coverImage { large } startDate { year } } } } recommendations(sort: RATING_DESC, perPage: 10) { edges { node { mediaRecommendation { id type title { romaji } coverImage { large } startDate { year } } } } } } }","variables":{"id":"{id}","type":"MANGA"}}}', `detail_field_map` = '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.chapters","art":"data.Media.coverImage.large","synopsis":"data.Media.description","subtype":"data.Media.format","relations":{"path":"data.Media.relations.edges","kind":"relationType","id":"node.id","title":"node.title.romaji","art":"node.coverImage.large","year":"node.startDate.year","typeToken":"node.type"},"recommendations":{"path":"data.Media.recommendations.edges","id":"node.mediaRecommendation.id","title":"node.mediaRecommendation.title.romaji","art":"node.mediaRecommendation.coverImage.large","year":"node.mediaRecommendation.startDate.year","typeToken":"node.mediaRecommendation.type"},"links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', `provider_type_token` = 'MANGA', `relations_path` = NULL, `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'manga' AND `provider_slug` = 'anilist';
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/games","queryParam":"","body":{"kind":"apicalypse","template":"search \"{term}\"; fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url,game_type.type; limit 20;"}},"detail":{"path":"/games","body":{"kind":"apicalypse","template":"fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url,game_type.type,parent_game.name,parent_game.cover.image_id,parent_game.first_release_date,similar_games.name,similar_games.cover.image_id,similar_games.first_release_date; where id = {id};"}},"test":{"path":"/games","body":{"kind":"apicalypse","template":"fields id; limit 1;"}}}', `field_map` = '{"externalId":"id","title":"name","subtype":"game_type.type","year":"first_release_date","yearFormat":"unix-seconds","art":"cover.image_id","synopsis":"summary"}', `rate_limit` = '{"perSecond":4,"burst":8}', `timeout_ms` = 10000 WHERE `slug` = 'igdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = NULL, `field_map` = NULL, `detail_path` = NULL, `detail_body` = NULL, `detail_field_map` = '{"externalId":"0.id","title":"0.name","subtype":"0.game_type.type","year":"0.first_release_date","yearFormat":"unix-seconds","art":"0.cover.image_id","synopsis":"0.summary","relations":{"path":"0.parent_game","kindConst":"parent","id":"id","title":"name","art":"cover.image_id","year":"first_release_date","yearFormat":"unix-seconds"},"recommendations":{"path":"0.similar_games","id":"id","title":"name","art":"cover.image_id","year":"first_release_date","yearFormat":"unix-seconds"},"links":[{"label":"IGDB","path":"0.url"}]}', `provider_type_token` = NULL, `relations_path` = NULL, `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'game' AND `provider_slug` = 'igdb';

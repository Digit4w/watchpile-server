-- O SUBTIPO entra no mapa de campos — o que a obra é DENTRO do tipo dela.
--
-- Descoberto construindo o IGDB e confirmado contra o `research/yamtrack`: a
-- busca por "hollow knight" devolve **duas linhas com o título idêntico** — o
-- jogo e um Mod chamado igual, com `parent_game` apontando pro primeiro — e
-- nada na tela as separa.
--
-- ── A saída NÃO é filtrar ──────────────────────────────────────────────────
--
-- Cortar por `game_type` tiraria o mod e a DLC, o que parece limpeza; mas
-- tiraria junto remaster, port e expansão standalone, que são obras que alguém
-- legitimamente acompanha. **Busca que esconde o que existe é pior que busca
-- com uma linha a mais**, e quem decide qual é a obra certa é quem procurou. O
-- Yamtrack chega na mesma conclusão: ele não filtra, e mostra o formato como
-- dado (`FORMAT: Mod`).
--
-- ── Não é campo a serviço de um provedor ───────────────────────────────────
--
-- **Quatro dos seis têm o conceito**, com quatro nomes diferentes — e é isso
-- que o promove de exceção a vocabulário:
--
--   AniList   format             TV, ONA, MANGA, ONE_SHOT
--   Kitsu     attributes.subtype TV, manga
--   Jikan     type               TV
--   IGDB      game_type.type     Main Game, Mod, Update
--
-- TMDB e Open Library não têm, e ficam nulos — ausência legítima, não lacuna.
--
-- ── Por que o valor é NORMALIZADO, se o rótulo do grupo vem cru ────────────
--
-- Porque o que volta vai de rótulo humano (`Main Game`) a enum de máquina
-- (`ONE_SHOT`), passando por minúsculo (`manga`). Cru, a tela mostraria os três
-- lado a lado. `subtypeLabel` (em `providers.text.ts`) é **genérica e não sabe
-- de provedor nenhum**: ela sabe de sublinhado e de caixa, e preserva sigla
-- curta em maiúsculas — sem isso `ONA` viraria `Ona`, que é title-case ingênuo
-- estragando o dado em vez de arrumá-lo. Um mapa por provedor seria o
-- `if (slug === …)` que o brief 3.10 recusa, escrito de outro jeito.
--
-- ── O que mais mudou junto, e por quê ──────────────────────────────────────
--
-- O IGDB e o AniList precisam **PEDIR** o campo: apicalypse lista campo a campo
-- e GraphQL também. Por isso o `endpoints` dos dois muda junto do `field_map` —
-- sem isso o mapa apontaria pra um campo que a resposta não traz, e o subtipo
-- viria nulo em silêncio. O Kitsu e o Jikan não mudam de consulta: os dois já
-- devolvem o registro inteiro.
--
-- **UPDATE e não INSERT.** As definições já estão semeadas desde a `0007`, a
-- `0018`, a `0020`, a `0021`, a `0025` e a `0026`; migration não se reescreve, e
-- a correção de uma semente aplicada é uma migration nova.
--
-- Gerado de `providers.seed.ts` por `scripts/print-provider-seed.ts <slug>
-- --update` e `--update --provider-only`.

UPDATE `providers` SET `endpoints` = '{"search":{"path":"/anime","queryParam":"q","query":{"limit":"20","sfw":"true"},"resultsPath":"data"},"detail":{"path":"/anime/{id}"},"test":{"path":"/anime","query":{"q":"test","limit":"1"}}}', `field_map` = '{"externalId":"mal_id","title":"title","year":"year","total":"episodes","art":"images.jpg.image_url","synopsis":"synopsis","subtype":"type","score":"score","votes":"scored_by"}', `rate_limit` = '{"perSecond":1,"burst":3}', `timeout_ms` = 10000 WHERE `slug` = 'jikan';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = NULL, `field_map` = NULL, `detail_path` = '/anime/{id}', `detail_body` = NULL, `detail_field_map` = '{"externalId":"data.mal_id","title":"data.title","year":"data.year","total":"data.episodes","art":"data.images.jpg.image_url","synopsis":"data.synopsis","subtype":"data.type","score":"data.score","votes":"data.scored_by","links":[{"label":"MyAnimeList","path":"data.url"}]}', `units_path` = '/anime/{id}/episodes', `unit_map` = '{"number":"mal_id","title":"title","date":"aired"}' WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'jikan';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/manga', `search_body` = NULL, `field_map` = '{"externalId":"mal_id","title":"title","year":"published.prop.from.year","total":"chapters","art":"images.jpg.image_url","synopsis":"synopsis","subtype":"type","score":"score","votes":"scored_by"}', `detail_path` = '/manga/{id}', `detail_body` = NULL, `detail_field_map` = '{"externalId":"data.mal_id","title":"data.title","year":"data.published.prop.from.year","total":"data.chapters","art":"data.images.jpg.image_url","synopsis":"data.synopsis","subtype":"data.type","score":"data.score","votes":"data.scored_by","links":[{"label":"MyAnimeList","path":"data.url"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'manga' AND `provider_slug` = 'jikan';
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/anime","queryParam":"filter[text]","query":{"page[limit]":"20"},"resultsPath":"data"},"detail":{"path":"/anime/{id}"},"test":{"path":"/anime","query":{"page[limit]":"1"}},"accept":"application/vnd.api+json"}', `field_map` = '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis","subtype":"attributes.subtype"}', `rate_limit` = '{"perSecond":3,"burst":5}', `timeout_ms` = 30000 WHERE `slug` = 'kitsu';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/anime', `search_body` = NULL, `field_map` = '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","total":"attributes.episodeCount","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis","subtype":"attributes.subtype"}', `detail_path` = '/anime/{id}', `detail_body` = NULL, `detail_field_map` = '{"externalId":"data.id","title":"data.attributes.canonicalTitle","year":"data.attributes.startDate","total":"data.attributes.episodeCount","art":"data.attributes.posterImage.medium","synopsis":"data.attributes.synopsis","subtype":"data.attributes.subtype","links":[{"label":"Kitsu","path":"data.attributes.slug","template":"https://kitsu.app/anime/{id}"}]}', `units_path` = '/anime/{id}/episodes?page[limit]=20', `unit_map` = '{"number":"attributes.number","title":"attributes.canonicalTitle","synopsis":"attributes.synopsis","art":"attributes.thumbnail.original","date":"attributes.airdate","runtime":"attributes.length"}' WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'kitsu';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = '/manga', `search_body` = NULL, `field_map` = '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","total":"attributes.chapterCount","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis","subtype":"attributes.subtype"}', `detail_path` = '/manga/{id}', `detail_body` = NULL, `detail_field_map` = '{"externalId":"data.id","title":"data.attributes.canonicalTitle","year":"data.attributes.startDate","total":"data.attributes.chapterCount","art":"data.attributes.posterImage.medium","synopsis":"data.attributes.synopsis","subtype":"data.attributes.subtype","links":[{"label":"Kitsu","path":"data.attributes.slug","template":"https://kitsu.app/manga/{id}"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'manga' AND `provider_slug` = 'kitsu';
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/","queryParam":"","resultsPath":"data.Page.media","body":{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"ANIME"}}}},"detail":{"path":"/","body":{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl } }","variables":{"id":"{id}","type":"ANIME"}}}},"test":{"path":"/","body":{"kind":"json","value":{"query":"query { Page(perPage: 1) { media(id: 1) { id } } }"}}},"textFormat":"html"}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","art":"coverImage.large","synopsis":"description","subtype":"format"}', `rate_limit` = '{"perSecond":0.5,"burst":5}', `timeout_ms` = 10000 WHERE `slug` = 'anilist';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"ANIME"}}}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"episodes","art":"coverImage.large","synopsis":"description","subtype":"format"}', `detail_path` = NULL, `detail_body` = '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl } }","variables":{"id":"{id}","type":"ANIME"}}}', `detail_field_map` = '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.episodes","art":"data.Media.coverImage.large","synopsis":"data.Media.description","subtype":"data.Media.format","links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'anilist';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format } } }","variables":{"search":"{term}","type":"MANGA"}}}', `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"chapters","art":"coverImage.large","synopsis":"description","subtype":"format"}', `detail_path` = NULL, `detail_body` = '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters format siteUrl } }","variables":{"id":"{id}","type":"MANGA"}}}', `detail_field_map` = '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.chapters","art":"data.Media.coverImage.large","synopsis":"data.Media.description","subtype":"data.Media.format","links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'manga' AND `provider_slug` = 'anilist';
--> statement-breakpoint
UPDATE `providers` SET `endpoints` = '{"search":{"path":"/games","queryParam":"","body":{"kind":"apicalypse","template":"search \"{term}\"; fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url,game_type.type; limit 20;"}},"detail":{"path":"/games","body":{"kind":"apicalypse","template":"fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url,game_type.type; where id = {id};"}},"test":{"path":"/games","body":{"kind":"apicalypse","template":"fields id; limit 1;"}}}', `field_map` = '{"externalId":"id","title":"name","subtype":"game_type.type","year":"first_release_date","yearFormat":"unix-seconds","art":"cover.image_id","synopsis":"summary"}', `rate_limit` = '{"perSecond":4,"burst":8}', `timeout_ms` = 10000 WHERE `slug` = 'igdb';
--> statement-breakpoint
UPDATE `media_type_providers` SET `search_path` = NULL, `search_body` = NULL, `field_map` = NULL, `detail_path` = NULL, `detail_body` = NULL, `detail_field_map` = '{"externalId":"0.id","title":"0.name","subtype":"0.game_type.type","year":"0.first_release_date","yearFormat":"unix-seconds","art":"0.cover.image_id","synopsis":"0.summary","links":[{"label":"IGDB","path":"0.url"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'game' AND `provider_slug` = 'igdb';

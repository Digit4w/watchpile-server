-- O MyAnimeList — o SÉTIMO provedor, e o primeiro desde o TMDB que carrega
-- `score` (brief, 3.10).
--
-- **Tudo nesta definição foi MEDIDO em 07/09/2026**, contra a API real. Não é
-- zelo: a referência oficial deles **não traz uma amostra de resposta sequer**
-- (`node` aparece zero vezes no texto renderizado), então o envelope
-- `data[].node` só é conhecido por wrappers da comunidade. Escrever `field_map`
-- a partir disso seria modelar de terceira mão — o que este projeto já pagou
-- caro (o `pageInfo` que derrubava o AniList com 500 só apareceu medindo).
--
-- ── O que medir entregou, e a doc não ────────────────────────────────────────
--   · `mean` é 0–10 (9.25 no Frieren), a mesma escala do TMDB — Kitsu, AniList
--     e IGDB ficaram sem `score` porque a deles é 0–100
--   · `num_chapters`/`num_volumes` vêm **0** para obra em publicação: Berserk
--     (`currently_publishing`) devolve 0, Monster (`finished`) devolve 162. Zero
--     é DESCONHECIDO, e o mapeador já o lê como ausente
--   · `related_anime[].relation_type_formatted` devolve o rótulo **pronto**
--     (`Other`), então o `kind` do vínculo dispensa normalização
--   · Sem header de rate limit e sem limite documentado — o teto de 3/s é
--     contenção NOSSA, mesma régua do Kitsu
--
-- ── Quatro respostas de FALHA, e duas delas compartilham o status ────────────
--   403 `not_permitted`  lista privada
--   403 `forbidden`      sem credencial
--   404 `not_found`      usuário inexistente
--   400 `bad_request`    "Invalid client id"
--
-- Dois 403 com significados opostos: **só o corpo separa**. É a mesma lição que
-- o conserto de 07/09 registrou — o status é um proxy, e quem carrega o fato é
-- o `error`.
--
-- ── A marca dele NÃO entra na nossa tela, e é o contrato que diz ─────────────
-- A seção 17 do *API License and Developer Agreement* proíbe incluir as marcas
-- deles em "Your Applications"; a única exceção (3(a)(xiii)) é usá-las **para
-- atribuir a fonte**, e o exemplo que eles dão é uma FRASE. Daí `attribution`
-- com texto, e o ladrilho da tela fica na inicial — que é o fallback que o
-- design system já tinha previsto ao decidir marca de terceiro.
--
-- ── Ele vira o PADRÃO de anime e mangá ──────────────────────────────────────
-- O `UPDATE` é guardado por `= 'anilist'`: troca só a escolha automática
-- anterior, **nunca a de um admin**. Vale porque o AniList desativou a própria
-- API em 07/09/2026 (403 em toda consulta, site no ar) e o Jikan responde 504
-- em tudo que não está em cache — sem isto, buscar anime ou mangá não funciona.

INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `rate_limit`, `timeout_ms`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('mal', 'MyAnimeList', 'https://api.myanimelist.net/v2', 'Data from MyAnimeList', NULL, '{"style":"header-key","header":"X-MAL-Client-ID","credential":"client_id"}', '{"perSecond":3,"burst":5}', 10000, '{"search":{"path":"/anime","queryParam":"q","query":{"limit":"20","fields":"id,title,main_picture,start_date,synopsis,mean,media_type"},"resultsPath":"data"},"detail":{"path":"/anime/{id}","query":{"fields":"id,title,main_picture,start_date,synopsis,mean,media_type,num_episodes,related_anime,recommendations"}},"test":{"path":"/anime","query":{"q":"a","limit":"1"}}}', '{"externalId":"node.id","title":"node.title","year":"node.start_date","art":"node.main_picture.large","synopsis":"node.synopsis","score":"node.mean","subtype":"node.media_type"}', '[{"key":"client_id","label":"Client ID","help":"Free, from myanimelist.net/apiconfig. Only the ID is needed."}]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `search_body`, `field_map`, `detail_path`, `detail_body`, `detail_field_map`, `provider_type_token`, `relations_path`, `units_path`, `unit_map`) SELECT 'anime', 'mal', '/anime', NULL, '{"externalId":"node.id","title":"node.title","year":"node.start_date","total":"node.num_episodes","art":"node.main_picture.large","synopsis":"node.synopsis","score":"node.mean","subtype":"node.media_type"}', '/anime/{id}', NULL, '{"externalId":"id","title":"title","year":"start_date","total":"num_episodes","art":"main_picture.large","synopsis":"synopsis","score":"mean","subtype":"media_type","relations":{"path":"related_anime","id":"node.id","title":"node.title","art":"node.main_picture.large","kind":"relation_type_formatted"},"recommendations":{"path":"recommendations","id":"node.id","title":"node.title","art":"node.main_picture.large"}}', 'anime', NULL, NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'anime');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `search_body`, `field_map`, `detail_path`, `detail_body`, `detail_field_map`, `provider_type_token`, `relations_path`, `units_path`, `unit_map`) SELECT 'manga', 'mal', '/manga', NULL, '{"externalId":"node.id","title":"node.title","year":"node.start_date","total":"node.num_chapters","art":"node.main_picture.large","synopsis":"node.synopsis","score":"node.mean","subtype":"node.media_type"}', '/manga/{id}', NULL, '{"externalId":"id","title":"title","year":"start_date","total":"num_chapters","art":"main_picture.large","synopsis":"synopsis","score":"mean","subtype":"media_type","relations":{"path":"related_manga","id":"node.id","title":"node.title","art":"node.main_picture.large","kind":"relation_type_formatted"},"recommendations":{"path":"recommendations","id":"node.id","title":"node.title","art":"node.main_picture.large"}}', 'manga', NULL, NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'manga');
--> statement-breakpoint
UPDATE `media_types` SET `default_provider_slug` = 'mal'
WHERE `slug` IN ('anime', 'manga')
  AND `default_provider_slug` = 'anilist'
  AND EXISTS (
    SELECT 1 FROM `media_type_providers`
    WHERE `media_type_slug` = `media_types`.`slug` AND `provider_slug` = 'mal'
  );

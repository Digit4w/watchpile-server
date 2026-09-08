--
-- A nota do provedor entra no `field_map` das duas ligações do TMDB.
--
-- Não é mudança de SCHEMA — o mapa é JSON numa coluna que já existe —, mas é
-- mudança de DADO semeado, e a migration é o retrato congelado de
-- `providers.seed.ts`. Sem isto o teste que compara os dois campo a campo
-- reprova, e a instalação existente ficaria sem a nota do provedor.
--
UPDATE `media_type_providers`
SET `field_map` = '{"externalId":"id","title":"title","year":"release_date","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count"}'
WHERE `media_type_slug` = 'movie' AND `provider_slug` = 'tmdb';--> statement-breakpoint
UPDATE `media_type_providers`
SET `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","art":"poster_path","synopsis":"overview","score":"vote_average","votes":"vote_count","unitGroups":{"path":"seasons","number":"season_number","name":"name","count":"episode_count"}}'
WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';

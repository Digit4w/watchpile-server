ALTER TABLE `media_type_providers` ADD `units_path` text;--> statement-breakpoint
ALTER TABLE `media_type_providers` ADD `unit_map` text;--> statement-breakpoint
--
-- A linha semeada do par (tv, tmdb) ganha o que a definição passou a declarar.
-- A migration é o retrato congelado de `providers.seed.ts`, e um teste compara
-- os dois campo a campo — sem isto a instalação existente ficaria sem unidades
-- e o retrato mentiria sobre a semente.
--
UPDATE `media_type_providers`
SET `field_map` = '{"externalId":"id","title":"name","year":"first_air_date","art":"poster_path","synopsis":"overview","unitGroups":{"path":"seasons","number":"season_number","name":"name","count":"episode_count"}}',
    `units_path` = '/tv/{id}/season/{group}',
    `unit_map` = '{"number":"episode_number","title":"name","synopsis":"overview","art":"still_path","date":"air_date","runtime":"runtime"}'
WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';

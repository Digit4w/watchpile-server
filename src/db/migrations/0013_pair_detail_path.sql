ALTER TABLE `media_type_providers` ADD `detail_path` text;--> statement-breakpoint
--
-- O "como" de um DETALHE é do PAR, não do provedor. O TMDB lê `/movie/{id}` e
-- `/tv/{id}`: com um endpoint só, pedir o detalhe de uma série trazia o filme
-- de mesmo id — 1396 é Breaking Bad em série e *Mirror* (1975) em filme. O
-- cache de arte tinha o mesmo defeito, latente, porque só fora exercido com
-- filme.
--
UPDATE `media_type_providers` SET `detail_path` = '/movie/{id}'
WHERE `media_type_slug` = 'movie' AND `provider_slug` = 'tmdb';--> statement-breakpoint
UPDATE `media_type_providers` SET `detail_path` = '/tv/{id}'
WHERE `media_type_slug` = 'tv' AND `provider_slug` = 'tmdb';

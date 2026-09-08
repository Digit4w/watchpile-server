-- O QUARTO provedor — e o primeiro que entra pra SUBSTITUIR outro, não pra
-- cobrir um tipo que estava sem fonte.
--
-- O Jikan caiu em 02/09/2026, e não do jeito que a issue #612 dele descreve
-- ("FULL OUTAGE"). Medido: `/anime/{id}` responde 200, e TODO o resto devolve
-- 504 — busca de anime, busca e detalhe de mangá, a lista de episódios, e o
-- nosso próprio endpoint de teste. Só o detalhe de anime está de pé, o que na
-- prática o torna inalcançável: sem busca não há como chegar numa obra nova.
--
-- O Kitsu cobre os dois pares com fonte primária, sem chave e sem
-- intermediário. Ele cobrou UMA coisa do contrato, e ela virou vocabulário em
-- vez de exceção: `endpoints.accept`, porque ele fala JSON:API e responde 406
-- ao `application/json` que o cliente mandava fixo. Não é coluna nova —
-- `endpoints` já é JSON.
--
-- Duas ausências deliberadas na definição, explicadas em `providers.seed.ts`:
-- `score`/`votes` ficam de fora porque a escala dele é 0–100 contra 0–10 dos
-- outros, e mangá fica sem `units_path` porque `/manga/{id}/chapters` devolve
-- capítulo sem título e sem data.
--
-- Gerado de `providers.seed.ts` por `scripts/print-provider-seed.ts kitsu`.
-- A última instrução é a única escrita à mão, e tem seção própria abaixo.

INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `rate_limit`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('kitsu', 'Kitsu', 'https://kitsu.app/api/edge', NULL, NULL, '{"style":"none"}', '{"perSecond":3,"burst":5}', '{"search":{"path":"/anime","queryParam":"filter[text]","query":{"page[limit]":"20"},"resultsPath":"data"},"detail":{"path":"/anime/{id}"},"test":{"path":"/anime","query":{"page[limit]":"1"}},"accept":"application/vnd.api+json"}', '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis"}', '[]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `field_map`, `detail_path`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'anime', 'kitsu', '/anime', '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","total":"attributes.episodeCount","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis"}', '/anime/{id}', '{"externalId":"data.id","title":"data.attributes.canonicalTitle","year":"data.attributes.startDate","total":"data.attributes.episodeCount","art":"data.attributes.posterImage.medium","synopsis":"data.attributes.synopsis","links":[{"label":"Kitsu","path":"data.attributes.slug","template":"https://kitsu.app/anime/{id}"}]}', '/anime/{id}/episodes?page[limit]=20', '{"number":"attributes.number","title":"attributes.canonicalTitle","synopsis":"attributes.synopsis","art":"attributes.thumbnail.original","date":"attributes.airdate","runtime":"attributes.length"}' WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'anime');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `field_map`, `detail_path`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'manga', 'kitsu', '/manga', '{"externalId":"id","title":"attributes.canonicalTitle","year":"attributes.startDate","total":"attributes.chapterCount","art":"attributes.posterImage.medium","synopsis":"attributes.synopsis"}', '/manga/{id}', '{"externalId":"data.id","title":"data.attributes.canonicalTitle","year":"data.attributes.startDate","total":"data.attributes.chapterCount","art":"data.attributes.posterImage.medium","synopsis":"data.attributes.synopsis","links":[{"label":"Kitsu","path":"data.attributes.slug","template":"https://kitsu.app/manga/{id}"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'manga');
--> statement-breakpoint
-- ── O canônico, e por que semeá-lo aqui NÃO contradiz a 0009 ────────────────
--
-- A 0009 deixou a coluna sem semeadura de propósito: "decisão só é necessária
-- quando há ambiguidade", e semear 'tmdb' em filme e série gravaria como
-- escolha o que era só falta de concorrente.
--
-- É exatamente a ambiguidade que acaba de nascer. `anime` e `manga` passam a
-- ter DOIS provedores associados, e sem canônico o desempate de
-- `search.provider-choice.ts` é o primeiro por slug — 'jikan' vem antes de
-- 'kitsu', então a busca cairia justamente no que está devolvendo 504.
--
-- `IS NULL` porque a coluna guarda decisão do ADMIN: uma instalação que já
-- tenha escolhido a fonte dela não pode ser sobrescrita por um upgrade. E
-- EXISTS sobre a junção porque semear canônico pra um tipo que não recebeu a
-- associação apontaria pra uma opção que não existe.
UPDATE `media_types` SET `default_provider_slug` = 'kitsu'
WHERE `slug` IN ('anime', 'manga')
  AND `default_provider_slug` IS NULL
  AND EXISTS (
    SELECT 1 FROM `media_type_providers`
    WHERE `media_type_slug` = `media_types`.`slug` AND `provider_slug` = 'kitsu'
  );

-- O QUINTO provedor, e o primeiro que fala por POST.
--
-- O AniList estava fora desde o começo por um motivo só, registrado no brief
-- 3.10: ele é GraphQL, ou seja **POST com corpo**, que o cliente genérico não
-- sabia dizer. A `0024` deu o vocabulário; esta é a definição usando-o.
--
-- Ele NÃO substitui o Kitsu — anime e mangá passam a ter três provedores
-- associados, e o canônico continua sendo o `kitsu` gravado pela `0021`. A
-- escolha fica com o admin, e a tela de busca oferece trocar de fonte. O que o
-- AniList acrescenta é velocidade: **0,35s medidos** contra 6 a 12s da busca do
-- Kitsu, na mesma consulta.
--
-- ── O que ele cobrou, e as três viraram vocabulário ─────────────────────────
--
-- 1. **`endpoints.*.body`**, a união fechada por dialeto — `json` aqui,
--    `apicalypse` quando o IGDB entrar. A presença do corpo é o que faz o
--    pedido ser POST; não há `method` separado
-- 2. **`search_body` e `detail_body` na JUNÇÃO** (migration `0024`). O caminho
--    dele é `/` pra tudo, e quem separa anime de mangá é a variável `type`
--    dentro do corpo. Verificado ao vivo: pedir um id de anime com
--    `type: MANGA` devolve 404, então isto não é simetria — é correção
-- 3. **`endpoints.textFormat`**, porque a prosa dele é HTML. `asHtml: false`
--    não resolve, verificado: `<br>` e `<i>` voltam das duas formas
--
-- ── Duas ausências declaradas ──────────────────────────────────────────────
--
-- **`score`/`votes` fora**, pela MESMA razão do Kitsu: `averageScore` é 0–100
-- contra os 0–10 do TMDB e do Jikan, e o contrato não tem vocabulário de
-- escala. Segunda ocorrência da mesma ausência.
--
-- **Sem `units_path`**, e aqui a ausência é do provedor: o AniList devolve só a
-- CONTAGEM de episódios e capítulos (brief, 3.10). Não há como listar unidade a
-- unidade, e o contador continua sendo a fonte do progresso.
--
-- ── O teto ─────────────────────────────────────────────────────────────────
--
-- `0,5/s` — o header `x-ratelimit-limit` diz **30 por minuto**, enquanto a
-- documentação deles fala em 90. **Quando os dois discordam vale o observado**,
-- que é o que a instalação vai encontrar. Primeiro `perSecond` fracionário, e o
-- balde de fichas já era ponto flutuante.
--
-- Gerado de `providers.seed.ts` por `scripts/print-provider-seed.ts anilist`.

INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `rate_limit`, `timeout_ms`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('anilist', 'AniList', 'https://graphql.anilist.co', NULL, NULL, '{"style":"none"}', '{"perSecond":0.5,"burst":5}', 10000, '{"search":{"path":"/","queryParam":"","resultsPath":"data.Page.media","body":{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters } } }","variables":{"search":"{term}","type":"ANIME"}}}},"detail":{"path":"/","body":{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters siteUrl } }","variables":{"id":"{id}","type":"ANIME"}}}},"test":{"path":"/","body":{"kind":"json","value":{"query":"query { Page(perPage: 1) { media(id: 1) { id } } }"}}},"textFormat":"html"}', '{"externalId":"id","title":"title.romaji","year":"startDate.year","art":"coverImage.large","synopsis":"description"}', '[]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `search_body`, `field_map`, `detail_path`, `detail_body`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'anime', 'anilist', NULL, '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters } } }","variables":{"search":"{term}","type":"ANIME"}}}', '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"episodes","art":"coverImage.large","synopsis":"description"}', NULL, '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters siteUrl } }","variables":{"id":"{id}","type":"ANIME"}}}', '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.episodes","art":"data.Media.coverImage.large","synopsis":"data.Media.description","links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'anime');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `search_body`, `field_map`, `detail_path`, `detail_body`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'manga', 'anilist', NULL, '{"kind":"json","value":{"query":"query ($search: String, $type: MediaType) { Page(page: 1, perPage: 20) { media(search: $search, type: $type, sort: SEARCH_MATCH) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters } } }","variables":{"search":"{term}","type":"MANGA"}}}', '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"chapters","art":"coverImage.large","synopsis":"description"}', NULL, '{"kind":"json","value":{"query":"query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) episodes chapters siteUrl } }","variables":{"id":"{id}","type":"MANGA"}}}', '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.chapters","art":"data.Media.coverImage.large","synopsis":"data.Media.description","links":[{"label":"AniList","path":"data.Media.siteUrl"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'manga');
--> statement-breakpoint
-- ── O canônico passa a ser o AniList, e a guarda é mais estreita que a da 0021 ─
--
-- Medido nesta sessão: a busca do AniList responde em **0,25 a 0,7s** contra os
-- **6 a 12s** do Kitsu — foi a lentidão dele que obrigou o `timeout_ms` a
-- existir, quatro horas atrás. Fonte que devolve a mesma pergunta vinte vezes
-- mais rápido é a que deve responder por padrão.
--
-- **A guarda é `= 'kitsu'`, não `IS NULL`.** A 0021 usava `IS NULL` porque
-- estava semeando uma coluna vazia: qualquer valor ali seria escolha do admin. O
-- caso aqui é outro — o valor que existe foi gravado por NÓS, na 0021, e é ele
-- que esta migration corrige. Trocar só quem está em `kitsu` deixa intacta a
-- instalação que já apontou pra outra coisa, que é a decisão que continua sendo
-- do admin.
--
-- E `EXISTS` sobre a junção, como na 0021: apontar o canônico pra um provedor
-- que não está associado ao tipo é oferecer uma opção que não existe.
UPDATE `media_types` SET `default_provider_slug` = 'anilist'
WHERE `slug` IN ('anime', 'manga')
  AND `default_provider_slug` = 'kitsu'
  AND EXISTS (
    SELECT 1 FROM `media_type_providers`
    WHERE `media_type_slug` = `media_types`.`slug` AND `provider_slug` = 'anilist'
  );

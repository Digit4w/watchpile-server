-- As SIGLAS de subtipo passam a ser DECLARADAS pelo par (tipo, provedor).
--
-- `subtypeLabel` sabe de sublinhado e de caixa, e não sabe de anime: pra ele
-- `tv` é uma palavra de duas letras e vira `Tv`. Uma lista de siglas dentro
-- dele seria vocabulário de um domínio numa função que é genérica de propósito
-- — o `if (slug === …)` do brief 3.10 escrito de outro jeito. Então quem
-- declara é o provedor (decisão do dono, 08/09/2026), em `field_map`, ao lado
-- do campo que a lista explica — como `yearFormat` mora ao lado de `year`.
--
-- ── MEDIR mudou o recorte inteiro ─────────────────────────────────────────
-- A suposição era que quatro provedores precisariam da lista. Medido em
-- 08/09/2026: o Kitsu manda `TV` e `OVA` em MAIÚSCULA e já sai certo pela regra
-- genérica, e o mangá do MyAnimeList não tem sigla nenhuma (`light_novel`,
-- `manga`, `manhwa`, `one_shot`). Sobram DOIS pares:
--
--   * `mal` × `anime` — MEDIDO: `tv`, `ona`, `movie`, `tv_special`
--   * `anilist` × `anime` — NÃO medido (403 desde 07/09); sai do enum
--     `MediaFormat` documentado, e quem precisa da lista é `TV_SHORT`, porque
--     ali a sigla está DENTRO de um valor composto
--
-- Só `field_map` e `detail_field_map` mudam; nenhuma outra coluna é tocada, e
-- por isso o `UPDATE` não repete a definição inteira do par.

UPDATE `media_type_providers` SET `field_map` = '{"externalId":"node.id","title":"node.title","year":"node.start_date","total":"node.num_episodes","art":"node.main_picture.large","synopsis":"node.synopsis","score":"node.mean","subtype":"node.media_type","subtypeAcronyms":["tv","ova","ona"]}', `detail_field_map` = '{"externalId":"id","title":"title","year":"start_date","total":"num_episodes","art":"main_picture.large","synopsis":"synopsis","score":"mean","subtype":"media_type","subtypeAcronyms":["tv","ova","ona"],"relations":{"path":"related_anime","id":"node.id","title":"node.title","art":"node.main_picture.large","kind":"relation_type_formatted"},"recommendations":{"path":"recommendations","id":"node.id","title":"node.title","art":"node.main_picture.large"}}'
  WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'mal';
--> statement-breakpoint
UPDATE `media_type_providers` SET `field_map` = '{"externalId":"id","title":"title.romaji","year":"startDate.year","total":"episodes","art":"coverImage.large","synopsis":"description","subtype":"format","subtypeAcronyms":["tv","ova","ona"]}', `detail_field_map` = '{"externalId":"data.Media.id","title":"data.Media.title.romaji","year":"data.Media.startDate.year","total":"data.Media.episodes","art":"data.Media.coverImage.large","synopsis":"data.Media.description","subtype":"data.Media.format","subtypeAcronyms":["tv","ova","ona"],"relations":{"path":"data.Media.relations.edges","kind":"relationType","id":"node.id","title":"node.title.romaji","art":"node.coverImage.large","year":"node.startDate.year","typeToken":"node.type"},"recommendations":{"path":"data.Media.recommendations.edges","id":"node.mediaRecommendation.id","title":"node.mediaRecommendation.title.romaji","art":"node.mediaRecommendation.coverImage.large","year":"node.mediaRecommendation.startDate.year","typeToken":"node.mediaRecommendation.type"},"links":[{"label":"AniList","path":"data.Media.siteUrl"}]}'
  WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'anilist';

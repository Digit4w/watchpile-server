-- O `fields` do MyAnimeList passa a pedir o que os DOIS tipos leem.
--
-- ── O comentário descrevia um mecanismo que não existia ────────────────────
-- A definição dizia que "os dois pares trazem o seu [fields], porque o campo de
-- total difere". Não trazem: `query` mora em `endpoints`, que é do PROVEDOR, e
-- o par só sobrescreve `path` e `body`. A lista era anime-only, e o `field_map`
-- de mangá lia caminhos que a resposta nunca continha — sem erro nenhum, porque
-- caminho ausente é nulo.
--
-- ── Quatro coisas quebradas, uma causa (medidas em 09/09/2026) ─────────────
--   1. A BUSCA não pedia total em tipo nenhum. `field_map.total` aponta pra
--      `node.num_episodes` / `node.num_chapters`, e nenhum dos dois era pedido:
--      toda obra adicionada do MyAnimeList nascia com o total em branco
--   2. O DETALHE de mangá não pedia `num_chapters`
--   3. O DETALHE de mangá não pedia `related_manga`, então mangá nenhum jamais
--      mostrou vínculo — a seção existia e nunca tinha o que renderizar
--   4. Nem vínculo nem recomendação pediam a data, e a carta dizia
--      `Year unknown` em todas
--
-- ── A UNIÃO, e por que ela e não uma coluna por par ────────────────────────
-- Medido contra a API real: o MyAnimeList IGNORA em silêncio o campo que não se
-- aplica ao tipo — a busca de anime devolve `num_episodes` e omite
-- `num_chapters`, a de mangá faz o inverso, e nenhuma das duas erra. Uma coluna
-- de query no par seria a quinta propriedade a fazer o caminho "o que pertence
-- ao par se declara", e é o certo no dia em que um segundo provedor precisar
-- dela; hoje só o MyAnimeList usa `fields` com mais de um tipo (o Open Library
-- usa e tem um tipo só). Decisão do dono, 09/09/2026.
--
-- A sub-seleção com chaves (`recommendations{node{start_date}}`) é dialeto
-- deles, e também foi medida: sem ela o `node` volta só com id, título e
-- imagem.

UPDATE `providers` SET `endpoints` = '{"search":{"path":"/anime","queryParam":"q","query":{"limit":"20","fields":"id,title,main_picture,start_date,synopsis,mean,media_type,num_episodes,num_chapters"},"resultsPath":"data"},"detail":{"path":"/anime/{id}","query":{"fields":"id,title,main_picture,start_date,synopsis,mean,media_type,num_episodes,num_chapters,related_anime{node{start_date}},related_manga{node{start_date}},recommendations{node{start_date}}"}},"test":{"path":"/anime","query":{"q":"test","limit":"1"}}}'
  WHERE `slug` = 'mal';
--> statement-breakpoint
UPDATE `media_type_providers` SET `detail_field_map` = '{"externalId":"id","title":"title","year":"start_date","total":"num_episodes","art":"main_picture.large","synopsis":"synopsis","score":"mean","subtype":"media_type","subtypeAcronyms":["tv","ova","ona"],"relations":{"path":"related_anime","id":"node.id","title":"node.title","art":"node.main_picture.large","kind":"relation_type_formatted","year":"node.start_date"},"recommendations":{"path":"recommendations","id":"node.id","title":"node.title","art":"node.main_picture.large","year":"node.start_date"}}'
  WHERE `media_type_slug` = 'anime' AND `provider_slug` = 'mal';
--> statement-breakpoint
UPDATE `media_type_providers` SET `detail_field_map` = '{"externalId":"id","title":"title","year":"start_date","total":"num_chapters","art":"main_picture.large","synopsis":"synopsis","score":"mean","subtype":"media_type","relations":{"path":"related_manga","id":"node.id","title":"node.title","art":"node.main_picture.large","kind":"relation_type_formatted","year":"node.start_date"},"recommendations":{"path":"recommendations","id":"node.id","title":"node.title","art":"node.main_picture.large","year":"node.start_date"}}'
  WHERE `media_type_slug` = 'manga' AND `provider_slug` = 'mal';

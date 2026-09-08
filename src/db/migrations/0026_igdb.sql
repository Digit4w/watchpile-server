-- O SEXTO provedor, e o primeiro que exige configuração do admin pra funcionar.
--
-- O IGDB usa o degrau do corpo (`0024`) pelo outro dialeto — apicalypse, não
-- GraphQL — e executa o `oauth-client-credentials`, que estava DECLARADO no
-- contrato desde a `0007` e nunca tinha rodado.
--
-- ── Três coisas que ele cobrou, e a primeira sem credencial nenhuma ─────────
--
-- 1. **`auth.idHeader`** — o Client-ID viaja num header PRÓPRIO, ao lado do
--    token. Isso é exigência dele, não do OAuth, e foi descoberto batendo no
--    endpoint sem chave: o 401 responde com uma lista de dicas cuja primeira é
--    literal, "Ensure you are sending Authorization and Client-ID as headers"
-- 2. **O cache de token** (`providers.token.ts`). Medido: `expires_in` volta
--    **5.327.537 segundos**, ou 61,7 dias. Pedir um token por busca bateria no
--    endpoint da Twitch milhares de vezes por um valor que não muda em dois
--    meses. Fica em memória, como o limitador — e ali há um motivo a mais: o
--    token é derivado do segredo, e gravá-lo faria uma segunda cópia de
--    material secreto viajar dentro do `.db` do backup
-- 3. **`field_map.yearFormat`** — `first_release_date` é timestamp Unix.
--    Medido: `1431993600` é maio de 2015, quando The Witcher 3 saiu, e ler os
--    quatro primeiros dígitos daria o ano **1431**. Plausível, na coluna certa,
--    sem erro nenhum: o modo de falhar mais caro que existe
--
-- ── O secret NÃO é embarcado, e é decisão ──────────────────────────────────
--
-- A cadeia de precedência (env > arquivo de secret > literal embutido) continua
-- valendo, mas `providers.embedded.ts` não ganha linha pro IGDB. Dois motivos
-- somados: a cláusula da Twitch é literal — "Treat client secrets as you would
-- your password… never expose it to users, even in an obscured form" — e o teto
-- é por `client_id`, então uma chave nossa na release seria 4 requisições por
-- segundo divididas entre todas as instalações do Watchpile.
--
-- A consequência é assumida: buscar jogo numa instalação recém-criada recusa
-- com `not-configured`, e a tela manda o admin pra Settings. É a resposta
-- honesta, e já estava construída.
--
-- ── Uma ausência declarada, pela terceira vez ──────────────────────────────
--
-- `score`/`votes` ficam de fora: `total_rating` é 0–100 (medido, 82.2256… para
-- Elden Ring Nightreign) contra os 0–10 do TMDB. Depois do Kitsu e do AniList,
-- é a terceira ocorrência — e três vezes é o que faz "falta vocabulário de
-- escala" virar pendência com dono em vez de observação.
--
-- Gerado de `providers.seed.ts` por `scripts/print-provider-seed.ts igdb`.
-- A última instrução é a única escrita à mão, e tem seção própria abaixo.

INSERT INTO `providers` (`slug`, `name`, `base_url`, `attribution`, `art_template`, `auth`, `rate_limit`, `timeout_ms`, `endpoints`, `field_map`, `credentials`, `options`) VALUES ('igdb', 'IGDB', 'https://api.igdb.com/v4', NULL, 'https://images.igdb.com/igdb/image/upload/t_cover_big/{path}.jpg', '{"style":"oauth-client-credentials","tokenUrl":"https://id.twitch.tv/oauth2/token","header":"Authorization","prefix":"Bearer ","idHeader":"Client-ID","credentials":{"id":"client_id","secret":"client_secret"}}', '{"perSecond":4,"burst":8}', 10000, '{"search":{"path":"/games","queryParam":"","body":{"kind":"apicalypse","template":"search \"{term}\"; fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url; limit 20;"}},"detail":{"path":"/games","body":{"kind":"apicalypse","template":"fields name,cover.image_id,first_release_date,summary,total_rating,total_rating_count,url; where id = {id};"}},"test":{"path":"/games","body":{"kind":"apicalypse","template":"fields id; limit 1;"}}}', '{"externalId":"id","title":"name","year":"first_release_date","yearFormat":"unix-seconds","art":"cover.image_id","synopsis":"summary"}', '[{"key":"client_id","label":"Client ID","help":"Create an application at dev.twitch.tv/console/apps. Requires 2FA on the Twitch account."},{"key":"client_secret","label":"Client secret","help":"Shown once, when you generate it. Generating a new one invalidates the old."}]', '[]');
--> statement-breakpoint
INSERT INTO `media_type_providers` (`media_type_slug`, `provider_slug`, `search_path`, `search_body`, `field_map`, `detail_path`, `detail_body`, `detail_field_map`, `units_path`, `unit_map`) SELECT 'game', 'igdb', NULL, NULL, NULL, NULL, NULL, '{"externalId":"0.id","title":"0.name","year":"0.first_release_date","yearFormat":"unix-seconds","art":"0.cover.image_id","synopsis":"0.summary","links":[{"label":"IGDB","path":"0.url"}]}', NULL, NULL WHERE EXISTS (SELECT 1 FROM `media_types` WHERE `slug` = 'game');
--> statement-breakpoint
-- ── O canônico de `game`, e por que ele é gravado ──────────────────────────
--
-- O IGDB é o ÚNICO provedor de jogo, então `search.provider-choice.ts` já o
-- escolheria por eliminação, e gravar aqui pode parecer redundante. Não é: a
-- coluna é o que torna a escolha EXPLÍCITA em vez de emergente. No dia em que
-- um segundo provedor de jogo entrar, sem esta linha o desempate viraria a
-- ordem alfabética por slug — que é exatamente o defeito que a `0021` corrigiu
-- em anime e mangá, com a busca caindo no provedor que estava em 504.
--
-- `IS NULL` e não `= '…'`: aqui não há valor anterior nosso a corrigir, então a
-- guarda é a da `0021` — decisão do admin não se sobrescreve num upgrade.
UPDATE `media_types` SET `default_provider_slug` = 'igdb'
WHERE `slug` = 'game'
  AND `default_provider_slug` IS NULL
  AND EXISTS (
    SELECT 1 FROM `media_type_providers`
    WHERE `media_type_slug` = 'game' AND `provider_slug` = 'igdb'
  );

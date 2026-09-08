-- O prazo de resposta vira propriedade da DEFINIÇÃO, com 10s de padrão.
--
-- Era `AbortSignal.timeout(10_000)` repetido em cinco lugares — busca, detalhe,
-- unidades, testar conexão e a imagem do cache de arte —, calibrado contra o
-- TMDB sem ninguém dizer contra o quê. Quanto um provedor demora é fato DELE,
-- não constante nossa: é a mesma classe de `rate_limit` (o teto é do provedor)
-- e de `endpoints.accept` (o dialeto é do provedor), e as duas já moram aqui.
--
-- Quem cobrou foi o Kitsu, no dia em que entrou: a busca dele leva **6 a 12s**
-- medidos, contra ~0,5s do detalhe e das unidades. Parte das buscas estourava
-- os 10s e voltava como `unreachable`, que é a MESMA resposta de rede fora e de
-- DNS quebrado — um provedor lento se lia como um provedor quebrado, e a tela
-- oferecia "tente de novo" pra uma coisa que ia demorar igual na segunda vez.
--
-- `NOT NULL` com `DEFAULT`, e não nulável como `rate_limit`, porque o valor
-- efetivo tem que ser legível na linha: o padrão do limitador só se descobre
-- lendo o código dele, e este número o admin vai procurar na definição no dia
-- em que ela for editável.

ALTER TABLE `providers` ADD `timeout_ms` integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
-- ── Os 30s do Kitsu ─────────────────────────────────────────────────────────
--
-- Não é folga de segurança: é o que foi medido. Ele responde entre 6 e 12s em
-- busca, e o dobro do pior caso observado é o que deixa a variação natural do
-- host caber sem que a busca vire recusa. Os outros três ficam no padrão, que
-- é onde já estavam sem saber.
UPDATE `providers` SET `timeout_ms` = 30000 WHERE `slug` = 'kitsu';

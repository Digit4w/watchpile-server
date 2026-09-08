-- O pedido de teste do MyAnimeList era recusado por ele — 07/09/2026.
--
-- `endpoints.test` mandava `q=a`, e o MAL **exige três caracteres**: medido
-- hoje, `a` e `ab` devolvem `400 {"message":"invalid q","error":"bad_request"}`,
-- `abc` e `test` devolvem 200. Ou seja, "testar conexão" falhava SEMPRE neste
-- provedor — com a frase de credencial recusada — enquanto a mesma chave servia
-- busca, detalhe e um import de 116 obras sem uma falha.
--
-- ── Por que isso passou ─────────────────────────────────────────────────────
-- O comentário logo acima daquela linha, na semente, diz textualmente *"um
-- pedido que o provedor ACEITA — a lição que o Open Library cobrou"*. A régua
-- estava enunciada no lugar certo e a linha abaixo a violava, porque **enunciar
-- não cumpre**: o pedido de teste é a única parte de uma definição que nenhum
-- outro caminho exercita — busca usa o termo de quem procura, detalhe usa um id.
-- Ele só é provado sendo EXECUTADO uma vez contra o provedor de verdade.
--
-- `json_set` em vez de reescrever `endpoints` inteiro: a mudança é de um valor,
-- e reescrever o JSON todo levaria junto qualquer ajuste que tenha entrado nele
-- desde a `0036`.
UPDATE `providers`
SET `endpoints` = json_set(`endpoints`, '$.test.query.q', 'test')
WHERE `slug` = 'mal';

-- **Jogo deixa de contar** — 07/09/2026, decisão do dono.
--
-- Ela REVERTE uma decisão do mesmo dia. A `0043` deu a `game` o
-- `counts_progress = 1` do default, e o motivo estava escrito no template desde
-- a migration dos tipos: *"jogo conta sem ter unidade natural — uns contam
-- horas, outros capítulos, outros conquistas"*. Olhando a tela, o dono decidiu
-- que jogo não conta e não pergunta total.
--
-- **O custo está assumido:** quem acompanhava um jogo em 37/120 horas deixa de
-- ver o contador. Nenhum dado de `entries` é tocado — o número continua
-- gravado, como em todo tipo que deixa de contar (`0043`).
--
-- **A guarda é o estado SEMEADO dos dois campos.** `game` nasce `(1, 1)`; um
-- admin que já tenha mexido em qualquer um dos dois decidiu alguma coisa sobre
-- este tipo, e migration não desfaz decisão. É a mesma régua da `0043`, com a
-- diferença de que ali o alvo era um campo e aqui são dois — e basta um estar
-- fora do semeado para a linha ficar como está.
--
-- **E ela não consegue o que a `0043` conseguia**, pelo mesmo motivo que a
-- `0039` não conseguiu: um banco com `(1, 1)` pode ser o semeado ou pode ser um
-- admin que ligou os dois de volta de propósito, e nenhuma coluna separa as
-- duas histórias. Guarda de migration não lê intenção.
UPDATE `media_types`
  SET `counts_progress` = 0, `asks_total` = 0
  WHERE `slug` = 'game' AND `counts_progress` = 1 AND `asks_total` = 1;

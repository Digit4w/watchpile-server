-- **O que não se conta não ganha contador** — 07/09/2026, decisão do dono.
--
-- `asks_total` respondia DUAS perguntas. Filme era `false` porque não há o que
-- contar; um webnovel seria `false` porque conta e nunca sabe o total — duas
-- situações opostas na mesma coluna, e a tela não tinha como separá-las. Esta
-- migration separa os objetos, que é o que o projeto já fez com "tipo de mídia"
-- (31/08) e com `default_provider_slug` (02/09).
--
-- Daqui pra frente `asks_total` responde só *"o formulário pergunta o total?"*.
ALTER TABLE `media_types` ADD `counts_progress` integer DEFAULT true NOT NULL;
--> statement-breakpoint
-- **A guarda `asks_total = 0` é o estado SEMEADO do filme** (`0006`).
--
-- Se um admin o virou pra 1, ele decidiu que conta filme, e a migration não
-- desfaz isso. E tipo criado pelo usuário com `asks_total = 0` **cai no default
-- e continua contando** — porque ali a leitura é a segunda (conta, não sabe o
-- total), que é justamente a que o dono mandou manter.
--
-- Nenhum dado de `entries` é tocado: filme que já tem progresso mantém o
-- número, ele só deixa de ser mostrado. O dado não está errado, e apagá-lo por
-- causa de uma regra de EXIBIÇÃO seria irreversível.
UPDATE `media_types` SET `counts_progress` = 0
  WHERE `slug` = 'movie' AND `asks_total` = 0;

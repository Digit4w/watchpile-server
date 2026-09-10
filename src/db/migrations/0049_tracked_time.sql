-- **Tempo investido, e ele NÃO é progresso** — 10/09/2026, decisão do dono.
--
-- O pedido era "jogo registra horas", e a leitura fácil seria ligar
-- `counts_progress` em `game` de volta — o que reverteria a `0044`, tomada três
-- dias antes olhando a tela. **As duas coisas não cabiam juntas porque são
-- duas:** *quanto do acervo você percorreu* é o contador, com unidade,
-- denominador e fim; *quanto tempo você investiu* não tem nenhum dos três.
--
-- Jogo continua sem contador — o status segue sendo o gesto fácil, que é o que
-- o dono pediu pra não mexer — e ganha onde registrar horas.
--
-- **A decisão mora no TIPO e o valor na OBRA.** A alternativa era só a coluna em
-- `entries`, e ela cobraria no terceiro tipo que quisesse o mesmo: audiolivro,
-- podcast e curso têm o mesmo formato, e o vocabulário é aberto desde 30/08.
--
-- **Minutos, inteiro.** `47` vira `47m` e `150` vira `2h30` na tela. Decimal na
-- coluna seria a primeira fração do schema, e ela viria só por causa da unidade
-- escolhida na exibição.
--
-- **Só `game` nasce ligado**, e sem guarda de estado semeado: a coluna está
-- nascendo agora, então não há decisão de admin anterior que possa ser desfeita
-- — que é justamente o que a `0043`, a `0044` e a `0048` tiveram que proteger.
ALTER TABLE `entries` ADD COLUMN `time_spent` integer;--> statement-breakpoint
ALTER TABLE `media_types` ADD COLUMN `tracks_time` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `media_types` SET `tracks_time` = 1 WHERE `slug` = 'game';

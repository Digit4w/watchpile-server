-- Quando o wizard de primeiro uso terminou o passo de INSTÂNCIA (brief, 3.9).
--
-- Nulo = ainda não rodou. A coluna existe porque a dedução não serve: "já
-- configurou?" não se responde olhando se há usuário, senão quem cria o admin e
-- fecha o navegador pula a configuração pra sempre.
ALTER TABLE `settings` ADD `instance_setup_at` integer;--> statement-breakpoint
-- Instalação que JÁ TEM usuário nasce carimbada.
--
-- Ela já fez as escolhas dela — os seis tipos que a `0006` semeou, o idioma em
-- inglês do default —, e mandá-la pra um wizard cuja ação é APAGAR tipo seria
-- pior que pulá-lo. O carimbo é o `created_at` de `settings`, e não o `unixepoch()`
-- de agora: a instância foi configurada no dia em que subiu, não no dia em que
-- esta migration rodou.
UPDATE `settings`
   SET `instance_setup_at` = `created_at`
 WHERE EXISTS (SELECT 1 FROM `users`);

-- O endereço que o admin escolheu pelo controle de conexões remotas.
--
-- Nulável de propósito: nulo é "nunca escolhi", e é o que deixa o padrão da
-- instalação valer. Gravar um endereço aqui congelaria toda instalação já
-- rodando no valor de hoje -- que é justamente o valor que ninguém escolheu,
-- porque ele vinha de `serve()` nunca ter recebido um `hostname`.
ALTER TABLE `settings` ADD `bind_host` text;

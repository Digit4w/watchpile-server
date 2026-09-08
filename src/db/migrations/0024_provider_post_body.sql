-- O corpo de um pedido entra na definição — o quinto e o sexto provedores
-- cobraram isto juntos.
--
-- Até aqui todo provedor cabia em `GET` com query string. O AniList é GraphQL e
-- o IGDB é apicalypse, e os dois só respondem a `POST` com corpo: o cliente
-- genérico não sabia dizer outra coisa, e essa é a única razão pela qual nenhum
-- dos dois entrou antes.
--
-- **Duas colunas na JUNÇÃO, e nenhuma no provedor.** O corpo é do PAR pelo
-- mesmo motivo que `search_path` e `detail_path` são: no AniList o endereço é
-- `/` pra tudo que ele serve, e o que separa anime de mangá é a variável `type`
-- **dentro do corpo**. Verificado ao vivo em 02/09/2026: pedir um id de anime
-- com `type: MANGA` devolve **404** — é o mesmo defeito do id 1396 do TMDB, e
-- sem estas colunas ele voltaria por outra porta.
--
-- O corpo do endpoint do PROVEDOR mora em `endpoints`, que já é JSON e não
-- precisa de coluna — é lá que ficam o `accept` e, desde este ciclo, o
-- `textFormat`.
--
-- **Nulo nas duas é o estado dos quatro provedores atuais**, e continua sendo o
-- caso comum: quem fala por query string não declara corpo nenhum. É a presença
-- do corpo que faz o pedido ser `POST` — não há `method` separado, porque dois
-- campos que só variam juntos são dois jeitos de escrever a mesma coisa, e o
-- segundo é o que fica errado.

ALTER TABLE `media_type_providers` ADD `search_body` text;--> statement-breakpoint
ALTER TABLE `media_type_providers` ADD `detail_body` text;
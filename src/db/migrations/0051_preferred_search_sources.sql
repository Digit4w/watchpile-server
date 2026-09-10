-- Qual fonte cada usuário prefere para buscar cada tipo — preferência de
-- USUÁRIO (brief, 3.9 e 3.10), e o degrau que entra entre "o pedido explícito"
-- e "o efetivo" em `chooseSearchProvider`.
--
-- Não é `media_types.default_provider_slug`: aquela coluna é infraestrutura da
-- instância, escrita só pelo admin, e diz quem responde a busca NESTE SERVIDOR.
-- Esta diz com que fonte EU busco. As duas convivem, e a precedência as ordena.
--
-- A ausência é o padrão, como em `hidden_media_types`: sem linha significa
-- "nunca escolhi", e vale o efetivo. Nada a preencher — instalação existente
-- começa sem nenhuma linha, que é exatamente o comportamento de hoje.
CREATE TABLE `preferred_search_sources` (
	`user_id` integer NOT NULL,
	`media_type_slug` text NOT NULL,
	`provider_slug` text NOT NULL,
	PRIMARY KEY(`user_id`, `media_type_slug`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_type_slug`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`provider_slug`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade
);

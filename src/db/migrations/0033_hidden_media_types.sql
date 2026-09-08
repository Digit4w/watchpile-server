-- Que tipos de mídia cada usuário escondeu — preferência de USUÁRIO, o outro
-- objeto de "tipo de mídia" (brief, 3.9 e 3.12). Definir o tipo é vocabulário
-- da instância e mora em `media_types`; escolher quais eu vejo é de cada um.
--
-- A tabela guarda o que está ESCONDIDO, não o que está visível: o padrão é ver
-- tudo, então quem nunca abriu a tela não tem linha nenhuma e tipo criado
-- depois nasce visível pra todo mundo, sem semear nada.
--
-- Nada a preencher: instalação existente começa com todos os tipos visíveis,
-- que é exatamente o comportamento de hoje.
CREATE TABLE `hidden_media_types` (
	`user_id` integer NOT NULL,
	`media_type_slug` text NOT NULL,
	PRIMARY KEY(`user_id`, `media_type_slug`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_type_slug`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE cascade
);

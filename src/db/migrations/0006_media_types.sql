CREATE TABLE `media_type_names` (
	`media_type_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`plural` text NOT NULL,
	`progress_unit` text,
	PRIMARY KEY(`media_type_id`, `locale`),
	FOREIGN KEY (`media_type_id`) REFERENCES `media_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`icon` text NOT NULL,
	`asks_total` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_types_slug_unique` ON `media_types` (`slug`);--> statement-breakpoint
ALTER TABLE `settings` ADD `instance_language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
-- Os seis embutidos viram LINHAS, e é isto que "os seis são ponto de partida,
-- não teto" (brief 3.12) quer dizer na prática. Eles nascem iguais ao que o
-- usuário criaria: mesmo acervo de ícone, mesmo mapa por idioma, nenhum campo
-- que só eles tenham. Embutido com atalho faz o caminho do usuário apodrecer
-- (a mesma régua que 3.10 aplica a provedor).
--
-- Isto roda ANTES da recriação de `entries`. O drizzle-kit gerou a cópia das
-- obras primeiro, e ali a FK apontaria pra uma tabela vazia: com
-- `foreign_keys=OFF` a cópia passaria calada e o banco ficaria com obra
-- apontando pra tipo inexistente.
--
-- Os glifos são nomes do `lucide-react`, conferidos contra o pacote instalado.
-- Eles substituem os seis desenhados à mão em 29/08, e o raciocínio de silhueta
-- daquele dia sobrevive quase inteiro: `clapperboard` tem a faixa no topo,
-- `monitor` é o retângulo vazio com pé, e `sparkles` é a única forma não
-- retangular do trio "coisa que se assiste".
INSERT INTO `media_types` (`slug`, `icon`, `asks_total`) VALUES
	('movie', 'clapperboard', 0),
	('tv', 'monitor', 1),
	('anime', 'sparkles', 1),
	('manga', 'message-square', 1),
	('game', 'gamepad-2', 1),
	('book', 'book-open', 1);
--> statement-breakpoint
-- `progress_unit` nulo em `movie` e `game` por motivos DIFERENTES: filme não
-- conta nada (é 1/1), e jogo conta sem ter unidade natural — uns contam horas,
-- outros capítulos, outros conquistas. Impor "horas" decidiria pelo usuário.
INSERT INTO `media_type_names` (`media_type_id`, `locale`, `name`, `plural`, `progress_unit`)
SELECT `id`, 'en', 'Movie', 'Movies', NULL FROM `media_types` WHERE `slug` = 'movie'
UNION ALL SELECT `id`, 'pt-BR', 'Filme', 'Filmes', NULL FROM `media_types` WHERE `slug` = 'movie'
UNION ALL SELECT `id`, 'en', 'Series', 'Series', 'Episodes' FROM `media_types` WHERE `slug` = 'tv'
UNION ALL SELECT `id`, 'pt-BR', 'Série', 'Séries', 'Episódios' FROM `media_types` WHERE `slug` = 'tv'
UNION ALL SELECT `id`, 'en', 'Anime', 'Anime', 'Episodes' FROM `media_types` WHERE `slug` = 'anime'
UNION ALL SELECT `id`, 'pt-BR', 'Anime', 'Animes', 'Episódios' FROM `media_types` WHERE `slug` = 'anime'
UNION ALL SELECT `id`, 'en', 'Manga', 'Manga', 'Chapters' FROM `media_types` WHERE `slug` = 'manga'
UNION ALL SELECT `id`, 'pt-BR', 'Mangá', 'Mangás', 'Capítulos' FROM `media_types` WHERE `slug` = 'manga'
UNION ALL SELECT `id`, 'en', 'Game', 'Games', NULL FROM `media_types` WHERE `slug` = 'game'
UNION ALL SELECT `id`, 'pt-BR', 'Jogo', 'Jogos', NULL FROM `media_types` WHERE `slug` = 'game'
UNION ALL SELECT `id`, 'en', 'Book', 'Books', 'Pages' FROM `media_types` WHERE `slug` = 'book'
UNION ALL SELECT `id`, 'pt-BR', 'Livro', 'Livros', 'Páginas' FROM `media_types` WHERE `slug` = 'book';
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`rating` real,
	`notes` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_type`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_entries`("id", "user_id", "media_type", "title", "status", "rating", "notes", "progress", "total", "created_at", "updated_at") SELECT "id", "user_id", "media_type", "title", "status", "rating", "notes", "progress", "total", "created_at", "updated_at" FROM `entries`;--> statement-breakpoint
DROP TABLE `entries`;--> statement-breakpoint
ALTER TABLE `__new_entries` RENAME TO `entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
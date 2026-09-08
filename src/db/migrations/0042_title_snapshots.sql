-- **A obra deixa de depender do provedor estar de pé** — 07/09/2026.
--
-- `getEntryDetails` resolvia ao vivo a cada visita, com as 6h de
-- `provider_cache` como único amortecedor. Com o AniList fora, toda obra de
-- anime e mangá da biblioteca passou a mostrar recusa assim que a entrada
-- expirou — obra que é da pessoa e que este banco conhece pelo nome.
--
-- Esta tabela é a régua do cache de arte um nível acima (brief, 3.10): o que a
-- pessoa TEM não depende da CDN de terceiro daqui a dois anos. A arte já não
-- dependia; o resto da obra ainda dependia.
--
-- A chave é (tipo, provedor, id externo), a mesma de `art_cache` e de
-- `external_ids` desde a `0037` — sinopse e ano são fato do provedor, não dado
-- pessoal, então duas pessoas com o mesmo filme compartilham uma linha. O tipo
-- entra na identidade porque o id de um provedor é único DENTRO do tipo; esta
-- tabela nasce sabendo o que as duas vizinhas aprenderam doendo.
--
-- Sem backfill, e não há o que fazer: o snapshot só existe depois de o
-- provedor responder uma vez. Biblioteca antiga enche na próxima abertura de
-- cada obra, que é o mesmo enchimento do cache de arte.
--
-- Ver `src/db/schema/title-snapshots.ts` para por que não são colunas em
-- `entries` e para o que ela deliberadamente NÃO guarda.

CREATE TABLE `title_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`synopsis` text,
	`art` text,
	`total` integer,
	`subtype` text,
	`score` real,
	`votes` integer,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`media_type`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `title_snapshots_fetched_at_idx` ON `title_snapshots` (`fetched_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `title_snapshots_provider_external_id_media_type_unique` ON `title_snapshots` (`provider`,`external_id`,`media_type`);
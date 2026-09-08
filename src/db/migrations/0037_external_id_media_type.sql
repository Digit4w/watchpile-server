-- **O tipo faz parte da identidade externa** — 07/09/2026, medido (brief, 3.10).
--
-- O id de um provedor é único DENTRO do tipo, não entre tipos: no MyAnimeList,
-- `21` é o anime One Piece **e** o mangá Death Note; no TMDB, `1396` é Breaking
-- Bad em série e *Mirror* em filme. `external_ids` tratava `(provider,
-- external_id)` como identidade completa, e não era.
--
-- ── O que isso custava, e não era teórico ────────────────────────────────────
-- Um import do MyAnimeList de 426 obras entregou 422. Os quatro que faltaram —
-- Death Note, Beck, Hajime no Ippo e 666 Satan, todos mangá — foram lidos como
-- "já está na sua biblioteca" porque um ANIME tinha o mesmo número. Perda
-- silenciosa, com a tela afirmando o contrário: o resultado os contou como
-- pulados.
--
-- O repositório já conhecia a armadilha — foi ela que tornou `detail_path`
-- propriedade do PAR (tipo, provedor) em 01/09/2026 —, mas esta tabela ficou de
-- fora. Nunca doeu porque obra entrava uma de cada vez pela busca, que já sabe o
-- tipo; **o import é a primeira coisa que insere anime e mangá do mesmo provedor
-- no mesmo gesto.**
--
-- ── Por que COLUNA, e não um join com `entries` ──────────────────────────────
-- O valor é derivável — toda obra tem tipo —, e um join na consulta consertaria
-- a conciliação. O que ele NÃO conserta é `art_cache`, chaveado por `(provider,
-- external_id)` **sem referência a entrada**, de propósito, porque arte não é
-- dado pessoal. Lá não há de onde derivar, e é isso que prova que o tipo
-- pertence à IDENTIDADE, não à consulta.
--
-- > `art_cache` tem a MESMA colisão e **não é consertado aqui**: derrubar a
-- > `unique(provider, external_id)` dele exige reconstruir a tabela, e o
-- > backfill teria que atravessar `external_ids → entries`, sem resposta para
-- > linha órfã. É latente (precisa das duas obras com arte cacheada) e anterior
-- > ao import. Fica como ciclo próprio.
--
-- ── O backfill não pode errar ───────────────────────────────────────────────
-- O tipo de todo vínculo existente é o da obra dele — `external_ids` é dona por
-- transitividade. O `JOIN` é interno de propósito: vínculo órfão de obra não
-- existe (a FK é `cascade`), e se existisse não teria tipo que se pudesse
-- inventar.
--
-- A `unique(entry_id, provider)` CONTINUA — um vínculo por provedor por obra
-- segue certo. O que muda é a leitura, não a restrição.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_ids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`media_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`media_type`) REFERENCES `media_types`(`slug`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_external_ids`("id", "entry_id", "provider", "external_id", "media_type", "created_at")
SELECT `x`.`id`, `x`.`entry_id`, `x`.`provider`, `x`.`external_id`, `e`.`media_type`, `x`.`created_at`
FROM `external_ids` `x` JOIN `entries` `e` ON `e`.`id` = `x`.`entry_id`;--> statement-breakpoint
DROP TABLE `external_ids`;--> statement-breakpoint
ALTER TABLE `__new_external_ids` RENAME TO `external_ids`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `external_ids_entry_id_provider_unique` ON `external_ids` (`entry_id`,`provider`);

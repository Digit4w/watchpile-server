-- De qual vínculo ESTA obra fala, quando a dona dela discorda do padrão.
--
-- A FK vai escrita à mão porque o `drizzle-kit` emite `REFERENCES providers(slug)`
-- pelado num ADD COLUMN, sem as cláusulas que o schema declara — e schema e
-- migration discordando é o tipo de diferença que só aparece no dia em que
-- alguém renomeia um slug.
ALTER TABLE `entries` ADD `primary_provider` text
  REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE restrict;

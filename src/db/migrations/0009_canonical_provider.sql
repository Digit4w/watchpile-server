-- O tipo ganha um provedor CANÔNICO — de onde vêm título e campos quando duas
-- fontes discordam (brief, 3.10, 01/09/2026).
--
-- Ele NÃO é a lista de provedores do tipo: `media_type_providers` continua
-- muitos-para-muitos e diz quais são OPÇÃO. Esta coluna diz qual MANDA. São
-- perguntas diferentes, e por isso duas peças.
--
-- **Nulável e sem semeadura, de propósito.** A coluna guarda uma DECISÃO do
-- admin, e decisão só é necessária quando há ambiguidade: com um provedor
-- associado o canônico se resolve em leitura (`media-types.query.ts`). Semear
-- 'tmdb' em filme e série gravaria como escolha o que é só falta de
-- concorrente.

ALTER TABLE `media_types` ADD `default_provider_slug` text REFERENCES providers(slug);
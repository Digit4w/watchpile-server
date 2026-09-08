-- Caminho ALTERNATIVO no mapa de campos: uma lista de caminhos, tentada em
-- ordem até a primeira que dê valor viável.
--
-- O `description` do Open Library vem ora como `"texto"`, ora como
-- `{type, value}` — o provedor mudou de formato sem reescrever o acervo, e as
-- duas convivem lá hoje. Isso não é excentricidade dele: é o que acontece com
-- qualquer API que durou o bastante pra mudar de ideia sem quebrar cliente
-- antigo. O que varia não é o TIPO do campo, é ONDE ele está — e "onde" é
-- justamente o que o mapa já sabe dizer.
--
-- Vem numa migration nova e não editando a 0018 porque a 0018 JÁ FOI APLICADA:
-- reescrevê-la deixaria todo banco que já a rodou com o valor antigo e sem
-- nada dizendo isso. Gerado por `scripts/print-provider-seed.ts --update`.

UPDATE `media_type_providers` SET `search_path` = NULL, `field_map` = NULL, `detail_path` = NULL, `detail_field_map` = '{"externalId":"key","title":"title","art":"covers.0","synopsis":["description","description.value"],"links":[{"label":"Open Library","path":"key","template":"https://openlibrary.org{id}"}]}', `units_path` = NULL, `unit_map` = NULL WHERE `media_type_slug` = 'book' AND `provider_slug` = 'openlibrary';

-- As duas colunas que o VÍNCULO entre obras cobra da junção.
--
-- `provider_type_token` existe por um motivo só: resolver o tipo do nó de um
-- vínculo **sem mapa em código**. Um vínculo atravessa tipo — o `ADAPTATION` de
-- um anime aponta pra um mangá —, e a rota de detalhe (`/search/{provedor}/{id}
-- ?type=…`) precisa do nosso slug pra navegar. O provedor devolve o token dele
-- (`MANGA` no AniList, `manga` no Kitsu); a junção diz a que tipo aquele token
-- corresponde. Escrever `MANGA → manga` em TypeScript seria o
-- `if (slug === 'anilist')` que o brief 3.10 recusa, com outra roupa.
--
-- Nulo quer dizer que o provedor **não distingue**, e é o caso do IGDB: tudo
-- ali é jogo, e um vínculo nunca troca de tipo.
--
-- `relations_path` é `units_path` estendido ao mesmo problema: o Kitsu serve
-- relação num endpoint separado, enquanto IGDB e AniList a devolvem dentro do
-- detalhe que já foi buscado. **Nulo significa "leia do corpo do detalhe"**, e
-- não "não há vínculo" — quem diz que não há é a ausência de `relations` no
-- mapa de campos.

ALTER TABLE `media_type_providers` ADD `provider_type_token` text;--> statement-breakpoint
ALTER TABLE `media_type_providers` ADD `relations_path` text;
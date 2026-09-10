-- **O coletivo dos grupos é declarado no PAR** — 10/09/2026, decisão do dono.
--
-- O `name` de cada grupo já vinha do provedor, e a semente dizia por quê: *"é
-- ele quem sabe como o agrupamento daquele catálogo se chama... o produto nunca
-- decide como o agrupamento se chama"*. **A tela contradizia isso**: o título da
-- seção era `'Seasons'` escrito em código, para todo tipo de mídia.
--
-- Hoje ninguém vê o defeito, e medir mostrou por quê: **só o par `(tv, tmdb)`
-- mapeia `unitGroups`**. `Seasons` é correto para o único conjunto que existe.
-- Mas no dia em que um par de mangá agrupar, o cabeçalho diria "Seasons" sobre
-- uma lista de volumes — e a régua já estava escrita, faltava aplicá-la.
--
-- **Por que no par e não no tipo:** seria plausível pô-lo ao lado de
-- `progress_unit` — "mangá conta capítulos e agrupa em volumes" parece
-- propriedade do meio. Não é: um provedor pode agrupar mangá por ARCO, e o
-- rótulo do tipo mentiria sobre ele. Quem sabe como aquela resposta está
-- organizada é o par que a lê.
--
-- `json_set` em vez de reescrever `field_map` inteiro: a mudança é de um valor,
-- e reescrever o objeto todo é como uma migration apaga em silêncio um campo
-- que outra acrescentou.
UPDATE `media_type_providers`
  SET `field_map` = json_set(`field_map`, '$.unitGroups.label', 'Seasons')
  WHERE `media_type_slug` = 'tv'
    AND `provider_slug` = 'tmdb'
    AND json_extract(`field_map`, '$.unitGroups.path') IS NOT NULL;

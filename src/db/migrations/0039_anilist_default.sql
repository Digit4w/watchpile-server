-- O AniList volta a ser o padrão de `anime` e `manga` — 07/09/2026.
--
-- **Decisão do dono do projeto**, e ela é sobre QUALIDADE DE FONTE, não sobre
-- disponibilidade: o AniList é a melhor fonte para os dois tipos, e a API dele
-- estar fora é problema temporário do lado deles. A `0036` o havia trocado pelo
-- MyAnimeList algumas horas antes, e aquele `UPDATE` respondia a outra pergunta
-- — *"o que faz a busca funcionar hoje?"* —, que é a pergunta de um dia ruim, não
-- a de um produto.
--
-- ── O custo, e ele é imediato ───────────────────────────────────────────────
-- **O padrão é quem responde a busca.** Enquanto a API deles devolver 403 em
-- tudo — medido em 07/09/2026, em três formas de consulta diferentes, com o site
-- no ar —, buscar anime ou mangá vai **recusar**, e não degradar. O motivo
-- chegará como `provider-down`, que é neutro e diz "espere", que é a saída certa
-- (nada há para o admin arrumar: o `refusalOf` de hoje já manda `4xx` de
-- provedor sem credencial para `down`).
--
-- Quem quiser buscar nesse meio-tempo tem duas saídas na tela, e as duas são de
-- um clique: trocar a fonte dentro do próprio campo de busca — ela viaja na URL
-- e é por consulta —, ou trocar o padrão em `Settings › Media types ›
-- Search source`.
--
-- ── O que esta migration NÃO consegue distinguir ────────────────────────────
-- A `0036` foi guardada por `= 'anilist'` de propósito: assim ela trocava só a
-- escolha AUTOMÁTICA anterior e nunca a de um admin. Na volta essa precisão não
-- existe — um banco com `'mal'` pode ter chegado ali pela `0036` **ou** por um
-- admin que escolheu MyAnimeList de propósito nas horas entre as duas, e não há
-- coluna que separe as duas histórias.
--
-- **O custo foi apresentado e aceito pelo dono:** quem escolheu MAL de propósito
-- nesse intervalo perde a escolha em silêncio. A janela é de horas e o produto
-- não tem instalação além desta, o que torna o caso teórico hoje — mas ele é
-- exatamente o tipo de coisa que não é teórica na segunda instalação, e por isso
-- fica escrito aqui.
--
-- A régua que sobra: **guarda de migration não consegue ler intenção**. Quando
-- uma escolha automática e uma deliberada terminam no mesmo valor, a segunda
-- reescrita não tem como poupar a deliberada — e é isso que faz "só troca o que
-- era automático" ser uma promessa de mão única.
--
-- O `EXISTS` continua, e é a mesma proteção de sempre: uma instalação que não
-- tenha o AniList associado ao tipo não pode receber um padrão que aponta para
-- um provedor que não serve aquele tipo.
UPDATE `media_types` SET `default_provider_slug` = 'anilist'
WHERE `slug` IN ('anime', 'manga')
  AND `default_provider_slug` = 'mal'
  AND EXISTS (
    SELECT 1 FROM `media_type_providers`
    WHERE `media_type_slug` = `media_types`.`slug` AND `provider_slug` = 'anilist'
  );

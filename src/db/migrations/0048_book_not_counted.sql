-- **Livro deixa de contar** — 10/09/2026, decisão do dono.
--
-- É o terceiro tipo a sair do contador, e o que ele mostra é que a decisão de
-- 07/09 **não passou por ele**: a `0043` deu a `book` o `counts_progress = 1` do
-- default, e a `0044` tirou o de `game` sem revisitar o vizinho que contava
-- páginas. *Régua aprendida numa linha não viaja sozinha pras irmãs.*
--
-- **O argumento é o mesmo de filme:** livro comum se acompanha por status. Quem
-- conta página conta uma unidade que o produto não pede em lugar nenhum — e a
-- pergunta que sobra ("quantas páginas tem?") já tem resposta por OBRA, em
-- `entries.total`, que é opcional.
--
-- **A unidade sai junto, e é decisão de exibição, não de capacidade.** Com
-- `counts_progress = 0`, a linha de `/settings/media-types` mostraria `Pages`
-- ao lado de um tipo sem contador — um par que a tela não sabe explicar, e o
-- estado que a `0045` acabou de tirar do vocabulário. O admin que ligar o
-- contador de volta digita a unidade, que é campo de texto na folha; nenhuma
-- capacidade se perde.
--
-- **A guarda é o estado SEMEADO**, como na `0043` e na `0044`: `book` nasce
-- contando e com `Pages`/`Páginas`. Um admin que já tenha mexido em qualquer um
-- dos três decidiu alguma coisa sobre este tipo, e **migration não desfaz
-- decisão**. A ordem importa — as unidades saem enquanto o tipo ainda está no
-- estado semeado, senão a primeira instrução apagaria a guarda da segunda.
--
-- **E ela não consegue o que a `0043` conseguia**, pela parede de sempre
-- (`0039`, `0044`): um banco no estado semeado pode ser o semeado ou um admin
-- que o reproduziu de propósito. Guarda de migration não lê intenção.
--
-- **Nenhum dado de `entries` é tocado.** Quem estava em 233/480 páginas continua
-- com o número gravado; o que muda é que nenhuma peça de acompanhamento o
-- desenha. Apagar dado por causa de uma regra de tela seria irreversível.
UPDATE `media_type_names`
  SET `progress_unit` = NULL
  WHERE `media_type_id` = (
    SELECT `id` FROM `media_types`
      WHERE `slug` = 'book' AND `counts_progress` = 1
  )
  AND (
    (`locale` = 'en' AND `progress_unit` = 'Pages')
    OR (`locale` = 'pt-BR' AND `progress_unit` = 'Páginas')
  );
--> statement-breakpoint
UPDATE `media_types`
  SET `counts_progress` = 0
  WHERE `slug` = 'book' AND `counts_progress` = 1;

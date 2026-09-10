import { sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Estilo de autenticação que o cliente genérico sabe aplicar.
 *
 * **É união fechada de propósito.** O usuário escreve a DEFINIÇÃO do provedor
 * dele, não o código que autentica — se ele pudesse declarar um estilo novo, a
 * definição viraria plugin executável, que é exatamente o que o brief 3.10
 * recusa. Estilo novo é mudança de contrato, e é o certo: ele é infraestrutura
 * do produto, como o acervo de ícones.
 */
export type AuthStyle =
  /**
   * O provedor não pede nada.
   *
   * **Não é a ausência de auth, é uma declaração dela** — e a diferença
   * aparece na tela: com `none` o formulário de credencial não nasce, em vez de
   * nascer vazio esperando algo que ninguém vai preencher. O brief 3.10 já
   * listava AniList e Open Library com "nada para leitura pública"; até
   * 01/09/2026 o contrato não tinha como dizer isso, e o primeiro provedor sem
   * chave foi quem cobrou.
   */
  | { style: 'none' }
  /** A credencial vai num parâmetro de query — `?api_key=…`, o TMDB v3. */
  | { style: 'query-key'; param: string; credential: string }
  /** A credencial vai num header — `Authorization: Bearer …`. */
  | { style: 'header-key'; header: string; prefix?: string; credential: string }
  /**
   * OAuth client-credentials, o do IGDB pela Twitch: troca id + secret por um
   * token, e **guarda esse token** até perto de vencer.
   *
   * **Executado desde 02/09/2026**, com o provedor de jogos. O comentário
   * anterior dizia "troca antes de cada rajada", e isso estava errado sobre o
   * caso real: o token da Twitch vale ~60 dias (`expires_in` na casa dos cinco
   * milhões de segundos), então pedir um a cada busca bateria no endpoint deles
   * sem motivo. Quem guarda é `providers.token.ts`, em memória.
   *
   * **O secret NÃO é embarcado** (brief, 3.10). Os termos da Twitch são
   * literais — "never expose it to users, even in an obscured form" —, e o teto
   * de requisições é por `client_id`, então uma chave nossa na release seria o
   * mesmo orçamento dividido por todas as instalações. É o primeiro provedor
   * que nasce exigindo configuração do admin, e a busca nele recusa com
   * `not-configured` até que ele a preencha.
   */
  | {
      style: 'oauth-client-credentials'
      tokenUrl: string
      header: string
      prefix?: string
      /**
       * O header onde o próprio CLIENT ID viaja, ao lado do token.
       *
       * **Verificado ao vivo, sem precisar de credencial**: o 401 do IGDB
       * responde com a lista de dicas dele, e a primeira é literal — "Ensure
       * you are sending Authorization **and Client-ID** as headers". Um header
       * só não descrevia esse provedor, e essa era a peça que faltava no
       * estilo que estava declarado desde sempre.
       *
       * Opcional porque nem todo client-credentials repete o id: o padrão do
       * OAuth manda só o token, e o id ir junto é exigência de quem publica a
       * API — ou seja, propriedade do provedor, como todas as outras.
       */
      idHeader?: string
      credentials: { id: string; secret: string }
    }

/**
 * O teto de requisições DESTE provedor.
 *
 * **É propriedade dele, não constante nossa** (brief, 3.10). O TMDB tolera ~50
 * por segundo; o Jikan documenta 3 por segundo e 60 por minuto, que é uma ordem
 * de grandeza abaixo. Escrever isso numa tabela em código seria o
 * `if (slug === 'jikan')` que a primeira invariante proíbe — e escrever um
 * número só serviria ao mais permissivo, derrubando o mais estrito.
 *
 * Nulo cai no padrão conservador do limitador.
 */
export type RateLimit = {
  /** Sustentado. O Jikan é 60/min, então 1. */
  perSecond: number
  /** Rajada curta — a tela dispara busca a cada tecla, com debounce. */
  burst: number
}

/**
 * O prazo de quem não declara um — a calibragem do TMDB, que responde em menos
 * de um segundo e é o caso comum.
 *
 * Mora aqui e não no cliente genérico porque é o `DEFAULT` da coluna: o valor
 * que um provedor cadastrado sem prazo recebe é este, e ele fica **escrito na
 * linha dele** em vez de acontecer em código que ninguém lê.
 */
export const DEFAULT_TIMEOUT_MS = 10_000

/** Uma credencial que a definição declara precisar. */
export type CredentialSpec = {
  key: string
  label: string
  /** Onde o admin consegue essa credencial. Vira a dica embaixo do campo. */
  help?: string
}

/**
 * Uma opção do provedor — `nsfw`, `language`. **Não é credencial**: o valor é
 * legível por todos, só a escrita é do admin (brief, 3.10).
 */
export type OptionSpec =
  | { key: string; type: 'boolean'; label: string; default: boolean }
  | { key: string; type: 'string'; label: string; default: string }

/**
 * O CORPO de um pedido, quando o provedor não fala por query string.
 *
 * **União fechada por DIALETO, como `AuthStyle`** — 02/09/2026. O quinto e o
 * sexto provedores cobraram isto juntos e pelo mesmo motivo: o AniList é
 * GraphQL e o IGDB é apicalypse, e os dois só respondem a `POST` com corpo.
 * Até aqui todo provedor cabia em `GET` com query, e o cliente genérico não
 * sabia dizer outra coisa.
 *
 * **O dialeto é declarado e não deduzido**, porque o que muda entre os dois não
 * é só o `Content-Type`: é COMO o termo de busca entra no corpo sem quebrá-lo.
 * Em JSON quem escapa é o `JSON.stringify`; em apicalypse o termo vai dentro de
 * aspas e quem escapa somos nós. Um campo de texto cru com um "tipo" ao lado
 * empurraria essa diferença pra quem escreve a definição — e escapar errado
 * numa linguagem de consulta não é um resultado feio, é injeção.
 *
 * `{term}`, `{id}` e `{option:<chave>}` valem dentro do corpo, com o mesmo
 * sentido que já têm no caminho e na query.
 */
export type ProviderBody =
  /**
   * JSON — o AniList. O corpo é declarado como VALOR, não como string: os
   * marcadores ficam nas folhas de texto e a serialização acontece depois de
   * substituí-los, então aspas e quebra de linha dentro do termo saem escapadas
   * sem ninguém pensar nisso. É também o que deixa a query GraphQL legível na
   * semente, em vez de virar uma string JSON escapada à mão.
   */
  | { kind: 'json'; value: unknown }
  /**
   * Apicalypse — o IGDB. É `text/plain` com uma sintaxe própria
   * (`fields …; search "…"; limit 10;`), então o corpo é um molde de texto e o
   * termo entra escapado pras aspas que o cercam.
   */
  | { kind: 'apicalypse'; template: string }

/** Um endpoint da definição, relativo à `baseUrl`. */
export type EndpointSpec = {
  path: string
  /** Query fixa do endpoint. A busca acrescenta o termo por `queryParam`. */
  query?: Record<string, string>
  /**
   * O corpo, quando há um. **A presença dele é o que faz o pedido ser `POST`**
   * — não há um `method` separado, porque não existe endpoint de provedor que
   * seja `POST` sem corpo nem `GET` com um. Dois campos que só variam juntos
   * são dois jeitos de escrever a mesma coisa, e o segundo é o que fica errado.
   */
  body?: ProviderBody
}

export type ProviderEndpoints = {
  search: EndpointSpec & {
    queryParam: string
    /**
     * Onde a lista de resultados mora dentro do corpo.
     *
     * O TMDB põe em `results` e não declara nada; o Open Library põe em `docs`.
     * O fallback existia com um comentário dizendo "a definição podia declarar
     * isso, e um dia vai" — o dia foi 01/09/2026, e chegou pelo segundo
     * provedor, que é exatamente quando um fallback deixa de ser conveniência e
     * vira adivinhação.
     */
    resultsPath?: string
  }
  detail: EndpointSpec
  /**
   * O endpoint mais barato do provedor, batido pelo "testar conexão" (brief,
   * 3.10: validar no salvamento, não na primeira busca). Sem ele, chave errada
   * só aparece muito depois, dentro de uma busca, e se lê como "o provedor está
   * quebrado".
   */
  test: EndpointSpec
  /**
   * O `Accept` que ESTE provedor exige.
   *
   * **Descoberto rodando, em 02/09/2026**: o Kitsu devolveu **406** para todo
   * pedido, porque fala JSON:API e recusa o `application/json` que o cliente
   * mandava fixo. As sondas de verificação feitas com `curl` não pegaram — sem
   * `Accept` explícito o curl manda um curinga, que passa. **O que atravessa um
   * `curl` de conferência não é o que o nosso cliente manda.**
   *
   * Fica no plural do provedor e não por endpoint porque é propriedade do
   * dialeto dele: um provedor que fale JSON:API fala em todas as rotas.
   * Ausente cai em `application/json`, que é o que os outros três querem.
   */
  accept?: string
  /**
   * Em que formato ESTE provedor escreve a prosa dele.
   *
   * **Descoberto rodando, em 02/09/2026**: a sinopse do AniList vem com `<br>`
   * e `<i>` dentro, e a tela renderiza sinopse como texto puro — as tags
   * apareceriam literais na carta e na tela de detalhe. Pedir
   * `description(asHtml: false)` **não resolve**: verificado, ele devolve HTML
   * assim mesmo.
   *
   * Fica aqui pelo mesmo motivo que o `accept`: é propriedade do dialeto do
   * provedor, não de um endpoint — quem escreve a sinopse em HTML escreve em
   * todas as rotas. E é DECLARADO em vez de limpo sempre porque limpar a prosa
   * dos outros quatro, que já vem limpa, transformaria uma sinopse com `a < b`
   * em dano colateral silencioso.
   *
   * **Só a PROSA é convertida** — `synopsis`. Título e rótulo são
   * identificadores, não texto corrido: um provedor que pusesse tag no título
   * estaria dizendo outra coisa, e adivinhar qual não é trabalho do cliente
   * genérico.
   *
   * Ausente é `plain`, que é o que os outros quatro devolvem.
   */
  textFormat?: 'html'
}

/**
 * O mapa de campos: caminho no JSON do provedor → forma de `entries`.
 *
 * Cada valor é um caminho pontuado (`poster_path`, `images.jpg.large`), lido do
 * item de resposta. É o que permite provedor novo sem código novo.
 */
/**
 * Um caminho na resposta do provedor, ou uma LISTA deles tentada em ordem.
 *
 * A lista existe porque provedor que durou muda de formato sem reescrever o
 * acervo antigo: o `description` do Open Library vem ora como string, ora como
 * `{type, value}`, e as duas formas convivem lá hoje. Declarar
 * `['description', 'description.value']` diz isso sem `if` em código e sem um
 * "tipo" por campo — o que varia não é o tipo, é ONDE o valor está, e onde é o
 * que o mapa já sabe dizer.
 *
 * Ver `providers.client.ts`, `readPath`. `string` continua sendo a forma comum.
 */
export type FieldPath = string | string[]

/**
 * Como ler um VÍNCULO entre obras do mesmo provedor — 02/09/2026.
 *
 * ── O que generaliza, e o que não ──────────────────────────────────────────
 * O `parent_game` do IGDB parecia um campo dele. Medido, é o **caso degenerado**
 * de um conceito que três dos seis têm — e os outros dois têm em forma mais
 * rica:
 *
 * | Provedor | Onde | O que devolve |
 * | --- | --- | --- |
 * | IGDB | `parent_game` | **um** vínculo, tipo implícito |
 * | AniList | `relations.edges[]` | `ADAPTATION`, `PREQUEL`, `SEQUEL` + nó |
 * | Kitsu | endpoint separado | `role` + destino, ligados por id |
 *
 * Modelar "pai" caberia no IGDB e jogaria fora o que os outros dois já
 * entregam — seria refeito no primeiro anime. Então é **lista com tipo**, e o
 * IGDB é uma lista de um.
 *
 * ── Objeto único conta como lista de um ────────────────────────────────────
 * `parent_game` não é array, e exigir que fosse obrigaria a definição a mentir
 * sobre a resposta. Quem lê aceita os dois, que é a mesma tolerância de
 * `FieldPath` aceitar string ou lista.
 */
export type RelationMap = {
  /** Onde a lista mora. Objeto único é lida como lista de um. */
  path: FieldPath
  /**
   * Onde o ITEM nomeia a relação — `relationType` no AniList, `attributes.role`
   * no Kitsu. Passa por `subtypeLabel`, porque `ADAPTATION` e `adaptation` são
   * o mesmo fato escrito por dois catálogos.
   */
  kind?: FieldPath
  /**
   * O token da relação quando o provedor **não a nomeia** — o `parent_game` do
   * IGDB tem um sentido só, e a definição o declara.
   *
   * **É token, não copy.** Ele passa pelo mesmo `subtypeLabel` que normaliza o
   * `ADAPTATION` do AniList, e por isso não fura a regra de que frase escrita no
   * servidor é copy de tela: o que viaja é vocabulário do catálogo, como já
   * viaja em `subtype`.
   */
  kindConst?: string
  id: FieldPath
  title: FieldPath
  art?: FieldPath
  year?: FieldPath
  /**
   * O formato da data do vínculo, quando ele não começa pelo ano.
   *
   * **Ele existe porque o defeito voltou por outra porta.** O `first_release_date`
   * do IGDB é timestamp Unix, e a primeira versão deste módulo tinha um `yearOf`
   * PRÓPRIO, que lia quatro dígitos e devolvia o ano **1487** — o mesmo erro que
   * `FieldMap.yearFormat` já tinha corrigido no mapa principal, reaparecendo
   * porque havia duas contas da mesma coisa de novo.
   */
  yearFormat?: FieldMap['yearFormat']
  /**
   * Onde o item diz de que TIPO ele é — `node.type` no AniList (`ANIME` /
   * `MANGA`), o `type` do recurso no Kitsu.
   *
   * **Ausente quer dizer "o mesmo tipo da obra"**, que é o caso do IGDB: tudo
   * ali é jogo, e um vínculo nunca troca de tipo. O token é resolvido contra
   * `media_type_providers.provider_type_token` — ou seja, contra DADO, e não
   * contra um mapa `MANGA → manga` escrito em código.
   */
  typeToken?: FieldPath
  /**
   * Onde o item aponta para o recurso INCLUÍDO, em JSON:API.
   *
   * ── Por que a junção existe, e por que ela é do DIALETO ────────────────────
   * O Kitsu devolve a relação e a obra em listas separadas: `role` fica em
   * `data[]` e o destino em `included[]`, ligados por `{type, id}`. Ler isso é
   * uma **junção**, e o leitor de caminho pontuado anda em objeto — ele não casa
   * referência.
   *
   * JSON:API é um **padrão**, não uma esquisitice de um provedor, e este mesmo
   * provedor já declara falar o dialeto em `endpoints.accept`. A junção é a
   * outra metade dessa declaração, e vale para qualquer provedor JSON:API que
   * venha depois.
   *
   * **Quando ela está presente, muda de onde os campos são lidos**: `kind` sai
   * do item (é a relação), e `id`, `title`, `art`, `year` e `typeToken` saem do
   * recurso resolvido (é a obra). Sem ela, tudo sai do item.
   */
  includeRef?: FieldPath
  /** Onde mora a lista de incluídos. Ausente cai em `included`, o do padrão. */
  includePath?: FieldPath
}

export type FieldMap = {
  externalId: FieldPath
  title: FieldPath
  year?: FieldPath
  /**
   * Em que formato o provedor escreve a data de onde o ano sai.
   *
   * Ausente é o caso comum e quer dizer "começa com o ano" — `1999-10-15`,
   * `1999`, `2023-04`. Os cinco primeiros provedores cabem nisso.
   *
   * **O IGDB não cabe, e o modo de falhar é o pior possível**: ele devolve
   * `first_release_date` como **timestamp Unix**, e ler os quatro primeiros
   * dígitos de `1487894400` dá o ano **1487** — um número plausível, na coluna
   * certa, sem erro nenhum. Ausência declarada não serviria aqui: o dado existe
   * e está certo, é a leitura que precisava saber o formato.
   *
   * Fica no mapa de campos, ao lado do `year` que ele descreve, porque é
   * propriedade do CAMPO e não do provedor — nada garante que um provedor com
   * duas rotas escreva a data igual nas duas, e o mapa já é por par.
   */
  yearFormat?: 'unix-seconds'
  total?: FieldPath
  art?: FieldPath
  synopsis?: FieldPath
  /**
   * O que a obra é DENTRO do tipo dela — 02/09/2026.
   *
   * Um anime é `TV`, `ONA` ou `Movie`; um mangá é `Manga` ou `One Shot`; um
   * jogo é `Main Game`, `Mod` ou `Update`. **Quatro dos seis provedores têm**,
   * com quatro nomes diferentes — `format` no AniList, `subtype` no Kitsu,
   * `type` no Jikan, `game_type.type` no IGDB —, e é isso que faz disto
   * vocabulário e não campo a serviço de um deles.
   *
   * ── O defeito que ele conserta ──────────────────────────────────────────
   * A busca por "hollow knight" no IGDB devolve **duas linhas com o título
   * idêntico**: o jogo e um Mod chamado igual. Sem o subtipo, nada na tela as
   * separa, e quem procura escolhe no escuro.
   *
   * **A saída não é filtrar.** Cortar por tipo tiraria o mod e a DLC — o que
   * parece limpeza —, mas tiraria junto remaster, port e expansão standalone,
   * que são obras que alguém legitimamente acompanha. Busca que esconde o que
   * existe é pior que busca com uma linha a mais, e quem decide qual é a obra
   * certa é quem procurou (design system, seção 5). Conferido contra o
   * `research/yamtrack`: ele também não filtra, e mostra o formato como dado.
   *
   * O valor passa por `subtypeLabel` antes de sair, porque o que os provedores
   * devolvem vai de rótulo humano (`Main Game`) a enum de máquina
   * (`ONE_SHOT`).
   */
  subtype?: FieldPath
  /**
   * Quais tokens de `subtype` deste par são SIGLAS.
   *
   * ── Por que a lista é DADO, e por que ela mora aqui ─────────────────────────
   * `subtypeLabel` sabe de sublinhado e de caixa, e não sabe de anime: pra ele
   * `tv` é uma palavra de duas letras como outra qualquer, e vira `Tv`. Uma
   * lista de siglas dentro dele seria vocabulário de um domínio entrando numa
   * função que é genérica de propósito — o mesmo `if (slug === …)` que o brief
   * 3.10 recusa, escrito de outro jeito.
   *
   * **Então quem declara é o provedor** (decisão do dono, 08/09/2026), e esta é
   * a quinta propriedade a fazer o caminho *o que pertence ao provedor se
   * declara* — depois do teto de requisições, do dialeto (`accept`), do prazo e
   * do `provider_type_token`. Com aquele ela divide mais que o caminho: nos dois
   * a **tradução** é dado, e não código.
   *
   * **Fica no `field_map` e não numa coluna nova**, ao lado do campo que ela
   * explica — exatamente como `yearFormat` mora ao lado de `year`. O `field_map`
   * já é do PAR com queda pro provedor, que é a granularidade certa: no AniList
   * os formatos de anime (`TV_SHORT`) e os de mangá (`ONE_SHOT`) são catálogos
   * diferentes.
   *
   * ── O que MEDIR mudou, e ele mudou o recorte inteiro ───────────────────────
   * A suposição era que quatro provedores precisariam da lista. Medido em
   * 08/09/2026: **o Kitsu manda `TV` e `OVA` em MAIÚSCULA** e já sai certo pela
   * regra genérica, e **o mangá do MyAnimeList não tem sigla nenhuma**
   * (`light_novel`, `manga`, `manhwa`, `one_shot`). Sobra o **anime do
   * MyAnimeList** — medido, `tv`, `ona`, `tv_special` — e o **anime do AniList**,
   * que não pôde ser medido (403 desde 07/09) e sai do enum documentado deles:
   * `TV` sozinho já passa, mas `TV_SHORT` parte em duas palavras e a regra de
   * sigla não alcança valor composto.
   *
   * ── Errar por omissão é o estado de hoje; errar por inclusão é quase
   * impossível ───────────────────────────────────────────────────────────────
   * Token que falta na lista continua saindo como sai hoje. Token a mais só
   * estraga se o provedor usar aquela palavra como palavra comum — e `tv`,
   * `ova`, `ona` não são palavra comum em catálogo nenhum destes.
   *
   * A comparação é sem caixa: o provedor pode mandar `TV` ou `tv`, e é a mesma
   * sigla.
   */
  subtypeAcronyms?: string[]
  /**
   * Os VÍNCULOS desta obra com outras do mesmo provedor. Ver {@link RelationMap}.
   *
   * Ausente nos provedores que não têm o conceito — TMDB, Open Library e Jikan
   * —, e ausente também no mapa de BUSCA de quem tem: puxar relação para cada um
   * de vinte resultados é resposta enorme para uma tela que não a mostra.
   */
  relations?: RelationMap
  /**
   * As RECOMENDAÇÕES desta obra — 03/09/2026.
   *
   * **A mesma forma do vínculo, e isso foi MEDIDO, não suposto.** `RelationMap`
   * já descrevia tudo que os três provedores com o conceito devolvem:
   *
   *   TMDB     `recommendations.results[]`   via `append_to_response`
   *   AniList  `recommendations.edges[]`     `sort: RATING_DESC` obrigatório
   *   IGDB     `similar_games[]`             dez, fixos
   *
   * Nenhum campo novo, e por isso o mapa é reusado em vez de copiado — duas
   * formas para o mesmo desenho é como uma fica pra trás.
   *
   * ── Por que é campo SEPARADO de `relations`, então ─────────────────────────
   * Porque o significado é outro, e a tela precisa da diferença. Um vínculo é
   * FATO — isto *é* a prequela daquilo, e o provedor está afirmando. Uma
   * recomendação é OPINIÃO, com cauda longa: o TMDB tem 538 delas para um
   * filme. Misturar as duas numa lista só apagaria a distinção justamente onde
   * ela é o conteúdo.
   *
   * ── `kind` fica NULO, e é de propósito ────────────────────────────────────
   * Nenhum dos três nomeia a relação, porque não há relação a nomear.
   * `kindConst: 'Recommended'` seria o servidor escrevendo copy de tela — a
   * régua que este repo já pagou quatro vezes. Quem nomeia a seção é a tela,
   * que é quem fala o idioma de quem lê.
   *
   * Ausente nos que não têm o conceito: Kitsu (`404` no endpoint), Open Library
   * e Jikan. E ausente no mapa de BUSCA de todos, pelo mesmo motivo de
   * `relations` — vinte resultados não mostram recomendação.
   */
  recommendations?: RelationMap
  /**
   * A nota do PROVEDOR e quantos votaram — contexto, nunca dado da obra.
   *
   * `entries.rating` é a nota de QUEM USA, e as duas moram lado a lado na tela
   * justamente porque são coisas diferentes: uma se edita, a outra se lê. Não
   * guardamos a do provedor em coluna nenhuma — ela vem no detalhe, como a
   * sinopse, e envelhece junto com ele.
   */
  score?: FieldPath
  votes?: FieldPath
  /**
   * Links para fora — IMDb, TVDB, Wikidata.
   *
   * **É contexto do provedor, não `external_ids`.** A nossa tabela guarda o id
   * de um PROVEDOR que este servidor conhece, com FK e tudo (brief, 3.10);
   * IMDb e Wikidata não são provedores nossos, e criar linhas pra eles seria
   * inventar provedor que ninguém configurou. Isto vem no detalhe e envelhece
   * com ele, como a sinopse.
   *
   * `template` recebe o valor cru em `{id}` — o mesmo molde de `art_template`,
   * e pelo mesmo motivo: montar a URL é conhecimento do provedor. Sem molde, o
   * valor já é URL absoluta.
   */
  links?: { label: string; path: FieldPath; template?: string }[]
  /**
   * Onde estão os GRUPOS de unidades na resposta de detalhe (brief, 3.10).
   *
   * **Não se chama "temporada" de propósito.** O que generaliza entre os
   * provedores é *partes numeradas, opcionalmente agrupadas*: o TMDB agrupa
   * episódios por temporada, o Jikan devolve episódio numa lista plana, mangá
   * tem capítulo agrupável por volume, e jogo e livro não têm nada. Assar
   * "season" no schema traria de volta o "seis de tudo" que a 3.12 recusou —
   * `episodes` guardando capítulo no dia do mangá.
   *
   * "Unidade" é o vocabulário que o modelo JÁ tem: `media_types.progress_unit`
   * diz se aquilo se chama episódio, capítulo ou página, e marcar uma unidade
   * vista **é** mover o contador em uma unidade (brief, 3.11).
   *
   * **O rótulo do grupo vem do PROVEDOR**, não de nós: o TMDB manda
   * `name: "Season 1"` junto. É o que dispensa o produto de decidir como se
   * chama o agrupamento de cada mídia — cada catálogo se nomeia, no idioma que
   * a opção do provedor pediu.
   *
   * Ausente é o caso comum e legítimo: provedor sem grupos, ou sem unidades
   * nenhuma. A tela então não desenha faixa nem lista.
   */
  unitGroups?: {
    /** Caminho do array de grupos dentro da resposta de detalhe. */
    path: FieldPath
    /** Caminhos DENTRO de um item do array. */
    number: FieldPath
    name: FieldPath
    count?: FieldPath
    /** A arte do grupo — o pôster da temporada, a capa do volume. */
    art?: FieldPath
    /**
     * Como o CONJUNTO de grupos se chama, no plural — 10/09/2026.
     *
     * ── Por que ele é declarado, e não escrito na tela ────────────────────
     * O `name` acima já dizia que **o produto nunca decide como o agrupamento
     * se chama** — é o provedor que escreve "Season 1". A tela contradizia
     * isso: o título da seção era `'Seasons'` em código, para todo tipo de
     * mídia. Hoje ninguém vê o defeito porque **só o par `(tv, tmdb)` mapeia
     * `unitGroups`**, medido — mas no dia em que um par de mangá agrupar, o
     * cabeçalho diria "Seasons" sobre uma lista de volumes.
     *
     * ── Por que no PAR e não no tipo ─────────────────────────────────────
     * Seria plausível pô-lo em `media_types` ao lado de `progress_unit`:
     * "mangá conta capítulos e agrupa em volumes" parece propriedade do meio.
     * Só que **não é** — um provedor pode agrupar mangá por ARCO, e o rótulo
     * do tipo mentiria sobre ele. Quem sabe como aquela resposta está
     * organizada é o par que a lê, e é ele que já declara `path`, `number` e
     * `name`. Quinta propriedade a fazer o caminho *o que pertence ao par se
     * declara*.
     *
     * ── Ausente é legítimo ───────────────────────────────────────────────
     * Sem ele a tela **não inventa** um coletivo: a lista mostra os nomes que
     * o provedor deu, e eles já se explicam. É o mesmo espírito de
     * `attribution` nulo — a ausência é uma afirmação, não uma lacuna.
     *
     * **É a única string de UI que vive na definição de um provedor**, e isso
     * é peso: ela não passa pelo catálogo de i18n, como `attribution` também
     * não passa. A diferença é que `attribution` é do provedor por licença, e
     * esta é copy — fica registrado como custo assumido, não como descuido.
     */
    label?: string
  }
}

/**
 * O mapa de uma UNIDADE — um episódio, um capítulo.
 *
 * Mora na junção `(tipo, provedor)` e não no provedor, pelo mesmo motivo de
 * `search_path`: o TMDB serve filme e série pelo mesmo provedor, e só série
 * tem unidades. Um mapa por provedor descreveria um dos dois e mentiria sobre
 * o outro.
 */
export type UnitMap = {
  number: FieldPath
  title?: FieldPath
  synopsis?: FieldPath
  art?: FieldPath
  date?: FieldPath
  runtime?: FieldPath
}

/**
 * Um provedor de metadados — **registro de dados, não plugin executável**
 * (brief, 3.10, 30/08/2026).
 *
 * URL base, estilo de auth, endpoints e mapa de campos são lidos por **um
 * cliente genérico**. O servidor não executa código de terceiro, não tem
 * sandbox e não cobre scraping — custo assumido, contra o modelo do Suwayomi
 * (`.apk` na JVM), que é o preço de herdar um ecossistema que não temos.
 *
 * **O TMDB embutido é uma linha desta tabela, semeada, igual à que o usuário
 * escreveria.** Não há caminho especial em código pra ele, e isso não é
 * elegância: se o embutido passa por um atalho, a definição do usuário vira
 * cidadão de segunda e ninguém percebe que quebrou.
 *
 * **O `slug` é a chave estrangeira, e não o `id`** — mesma decisão de
 * `media_types`, e aqui ela tem uma razão a mais: `external_ids.provider` já
 * guarda `'tmdb'`, `'anilist'` e afins como texto. Apontar a FK pro slug faz o
 * enum virar tabela **sem reescrever uma linha de dado**.
 */
export const providers = sqliteTable('providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Estável e imutável. Alvo da FK de `external_ids` e da junção. */
  slug: text('slug').notNull().unique(),
  /**
   * Nome próprio, e por isso **não é mapa por idioma** — ao contrário do nome
   * do tipo de mídia (brief, 3.12). "TMDB" e "AniList" se escrevem igual em
   * qualquer catálogo; traduzir marca seria inventar trabalho e errar.
   */
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  /**
   * **Atribuição obrigatória na UI quando o provedor exige** — é condição de
   * uso do TMDB, não cortesia (brief, 3.10). Fica na definição porque é
   * propriedade do provedor, não do nosso layout: um provedor que o usuário
   * cadastre pode não exigir nenhuma, e a tela lê o campo em vez de saber de
   * cor quais exigem.
   */
  attribution: text('attribution'),
  /**
   * Como transformar o que o `field_map` chama de `art` numa URL de imagem —
   * `https://image.tmdb.org/t/p/w342{path}`, com `{path}` recebendo o valor
   * cru que o provedor devolveu.
   *
   * **Fica na definição porque é conhecimento do provedor**, e escrevê-lo no
   * cliente seria o `if (slug === 'tmdb')` que o brief 3.10 recusa: o TMDB é
   * uma linha, não um caminho em código. Um provedor que já devolva URL
   * absoluta não precisa de molde, e por isso a coluna é nulável — sem molde e
   * com valor relativo, `art` volta nulo, e a tela cai no ladrilho com a
   * inicial em vez de desenhar uma imagem quebrada.
   *
   * **O tamanho está embutido no molde de propósito.** `w342` é o degrau do
   * TMDB que atende a carta de 133–150px numa tela 2×; escolher o tamanho aqui
   * é o que evita a UI ter que saber o vocabulário de cada CDN. Quando houver
   * mais de um tamanho na tela, o molde ganha um símbolo — não a UI ganha um
   * `if`.
   */
  artTemplate: text('art_template'),
  auth: text('auth', { mode: 'json' }).notNull().$type<AuthStyle>(),
  /** O teto de requisições do provedor. Nulo cai no padrão do limitador. */
  rateLimit: text('rate_limit', { mode: 'json' }).$type<RateLimit>(),
  /**
   * Quanto tempo ESTE provedor tem para responder, em milissegundos.
   *
   * **É propriedade dele, pela mesma razão que `rate_limit` e
   * `endpoints.accept` são** (brief, 3.10): quanto um provedor demora é fato
   * dele, não constante nossa. O prazo era `AbortSignal.timeout(10_000)`
   * repetido em cinco lugares, calibrado sem ninguém dizer contra o quê — e o
   * Kitsu o estourou no dia em que entrou: a busca dele leva **6 a 12s**
   * (detalhe e unidades ficam em ~0,5s), então parte das buscas voltava como
   * `unreachable`, que é a mesma resposta de rede fora. Um provedor lento se
   * lia como um provedor quebrado.
   *
   * **Um prazo, não um por endpoint.** A granularidade por rota é vocabulário
   * que nada hoje pede: quem estoura é a busca, e um provedor que precise de
   * 30s pra buscar não é prejudicado por poder gastar 30s num detalhe que
   * responde em 0,5.
   *
   * **`NOT NULL` com `DEFAULT`, e não nulável como `rate_limit`.** A diferença
   * é onde o valor efetivo é legível: o limitador tem um padrão conservador
   * que só se descobre lendo o código dele, e aqui o número aparece na linha
   * do provedor, que é onde o admin vai procurá-lo no dia em que a definição
   * for editável. Os {@link DEFAULT_TIMEOUT_MS} continuam sendo a calibragem
   * do TMDB, que é o caso comum.
   */
  timeoutMs: integer('timeout_ms').notNull().default(DEFAULT_TIMEOUT_MS),
  endpoints: text('endpoints', { mode: 'json' })
    .notNull()
    .$type<ProviderEndpoints>(),
  fieldMap: text('field_map', { mode: 'json' }).notNull().$type<FieldMap>(),
  /**
   * O que a definição PRECISA — `[{key:'api_key'}]` no TMDB, `[]` no AniList.
   * **O formulário do Settings é gerado a partir daqui**, e é isso que impede
   * estilo de auth novo de virar migration (brief, 3.10).
   */
  credentials: text('credentials', { mode: 'json' })
    .notNull()
    .$type<CredentialSpec[]>()
    .default(sql`'[]'`),
  options: text('options', { mode: 'json' })
    .notNull()
    .$type<OptionSpec[]>()
    .default(sql`'[]'`),
  /**
   * Os valores das credenciais, por chave.
   *
   * **Write-only na API, e é essa a proteção — não há criptografia em repouso**
   * (brief, 3.10, com a tabela dos três lugares onde a chave de criptografia
   * poderia morar e por que nenhum serve num self-hosted). O `GET` devolve
   * `configured: true` e, no máximo, os últimos caracteres.
   *
   * A chave viaja dentro do `.db` do backup, e o README precisa dizer isso onde
   * fala de backup: quem publica uma cópia do banco publica a credencial junto.
   */
  credentialValues: text('credential_values', { mode: 'json' })
    .notNull()
    .$type<Record<string, string>>()
    .default(sql`'{}'`),
  /** Os valores das opções. Legíveis por todos; só admin escreve. */
  optionValues: text('option_values', { mode: 'json' })
    .notNull()
    .$type<Record<string, string | boolean>>()
    .default(sql`'{}'`),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * O cache de resposta de provedor — **requisito, não otimização** (brief,
 * 3.10).
 *
 * A chave é da INSTÂNCIA, então o rate limit é compartilhado por todo mundo que
 * usa aquele servidor: um usuário importando uma coleção grande gasta o
 * orçamento de todos. É isso que promove o cache e o limitador a requisito.
 *
 * **A credencial NÃO entra na chave**, e isso é as duas coisas ao mesmo tempo:
 * correção — rotacionar a chave não deve invalidar um cache de respostas que
 * continuam válidas — e segurança, porque a chave viaja na query do TMDB e
 * gravá-la aqui a copiaria pra uma segunda tabela do banco.
 *
 * **As OPÇÕES entram**, e isso não contradiz o brief. O que ele decidiu é que
 * elas são da instância pra que a chave não se multiplique **por usuário**;
 * sendo constantes entre usuários, keyar pela query resolvida continua dando
 * uma entrada por consulta — e é o que mantém o cache honesto quando o admin
 * troca o idioma dos metadados.
 */
export const providerCache = sqliteTable(
  'provider_cache',
  {
    providerSlug: text('provider_slug')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** Caminho + query resolvida, sem a credencial. Ver acima. */
    requestKey: text('request_key').notNull(),
    /** O corpo cru da resposta. Mapear é do cliente, não do cache. */
    body: text('body').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    /**
     * Quando esta entrada deixa de valer. Coluna e não constante: provedor
     * diferente merece validade diferente, e um dia ela sai da definição.
     */
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.providerSlug, table.requestKey] })],
)

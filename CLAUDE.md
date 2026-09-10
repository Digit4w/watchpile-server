# Watchpile — Server

API HTTP do Watchpile e, em produção, também quem serve o build do cliente. Processo Node puro: não conhece o Docker, não conhece o Electron, não conhece o React.

Guia da pasta macro: `../CLAUDE.md`. Fonte da verdade: `../watchpile-design-brief.md`.

## Stack

| Camada | Escolha |
| --- | --- |
| Framework HTTP | Hono (adapter Node) |
| ORM | Drizzle |
| Banco | SQLite via `better-sqlite3` |
| Runtime | **Node** |
| Package manager / dev runner | Bun (opcional) |
| Empacotamento | Docker (container único) + Electron — os dois implementados, nenhum publicado |

### Bun é ferramenta, não runtime

```
bun install   ✅  package manager
bun run dev   ✅  dev runner
bun:sqlite    ❌  API exclusiva — usar better-sqlite3
Bun.serve     ❌  usar Hono com adapter Node
```

O motivo é o Electron, que embute Node: API exclusiva do Bun não funciona dentro do app empacotado (brief, 3.2). Isto não é preferência, é requisito de portabilidade — e é o tipo de coisa que só quebra meses depois, na hora de empacotar.

## Estrutura

```
server/
├── src/
│   ├── app.ts          # monta o Hono, registra rotas, chama configureOpenAPI
│   ├── index.ts        # entrypoint Node — startServer(), agnóstico de ambiente
│   ├── env.ts          # validação de env (override, nunca requisito)
│   ├── lib/
│   │   ├── create-app.ts         # createRouter() / createApp()
│   │   ├── configure-open-api.ts # registra /doc + /reference (Scalar)
│   │   ├── types.ts              # AppBindings, AppOpenAPI, AppRouteHandler<R>
│   │   └── errors.ts             # notFound + onError centrais
│   ├── db/
│   │   ├── client.ts    # instância Drizzle + SQLite, cria o diretório, liga WAL
│   │   ├── schema/      # uma tabela por arquivo — vazio até o modelo de dados existir
│   │   └── migrations/  # geradas por drizzle-kit
│   ├── middlewares/
│   │   └── pino-logger.ts
│   ├── routes/          # rota que não pertence a uma feature (ex.: health-check)
│   └── features/        # um domínio por pasta — ver "Estrutura de uma feature" abaixo
├── test/
│   ├── repositories/    # fake in-memory — só para features com repository.ts
│   └── factories/
├── scripts/
│   ├── validate-commit-msg.sh
│   ├── seed-demo.ts               # `bun run db:seed` — dado falso pra desenvolvimento
│   └── prepare-electron-dist.mjs  # copia migrations pra dist-electron/ (não é .ts, tsc não copia)
├── electron/
│   └── main.ts      # wrapper — único arquivo que importa 'electron'
├── build/            # ícones do electron-builder — gerados de design/brand/icon.svg
│   ├── icon.icns icon.ico
│   └── icons/*.png
├── client-dist/       # staging do build do client pro Docker — vazio no repo (.gitkeep), nunca comitado com conteúdo
├── docker/
│   └── entrypoint.sh  # troca pra PUID/PGID antes do CMD (server/CLAUDE.md, "O container é interface")
├── .github/workflows/
│   └── build.yml       # valida Docker multi-arch + Electron nos 3 SOs, não publica ("Plano de distribuição")
├── Dockerfile
├── .dockerignore
├── compose.yaml
├── README.md            # face pública, em INGLÊS — é o CANÔNICO
├── README.pt-BR.md      # a tradução, que corre atrás
├── biome.json
├── lefthook.yml
├── vitest.config.ts
├── drizzle.config.ts
├── tsconfig.electron.json        # typecheck do wrapper (electron/ + src/ juntos)
├── tsconfig.electron.build.json  # build de verdade, emite pra dist-electron/
└── package.json
```

### Estrutura de uma feature

Organização **por feature**, não por camada técnica pura — `auth`, `piles`,
`entries`, `home-widgets` (os que existem em 28/08/2026), mais `media`, `users`
e `providers` quando chegarem, carregam junto tudo que lhes pertence:

```
features/<feature>/
├── <feature>.entity.ts             # tipo de domínio — type simples, não classe rica
├── <feature>.repository.ts         # interface — só quando isolar o use-case compensar
├── <feature>.repository.drizzle.ts # implementação concreta
├── <feature>.use-cases.ts          # recebem o repository por parâmetro, nunca importam Hono/Drizzle
├── <feature>.routes.ts             # createRoute() + schema Zod (via drizzle-zod da tabela)
├── <feature>.handlers.ts
├── <feature>.index.ts              # createRouter().openapi(routes, handlers)
└── <feature>.test.ts               # e2e — bate na app real + SQLite real
```

A regra que liga as duas peças móveis: **a interface de repository e o teste
unitário isolado (`test/repositories/in-memory-<feature>-repository.ts` +
`<feature>.use-cases.spec.ts`) nascem juntos, e só quando há lógica de domínio
real para isolar do banco** — cálculo de progresso a partir do log de eventos é
o exemplo canônico. CRUD simples (criar pile, adicionar item) não ganha
interface nem spec unitário: o `<feature>.test.ts` batendo direto no SQLite já
cobre o risco real, que está no schema, não na orquestração. Não é preguiça,
é a mesma régua nos dois lados — se o custo de isolar do banco não se paga,
duplicar a cobertura também não paga.

`use-case` nunca importa Hono nem Drizzle diretamente, só a interface do
repository quando ela existir. Isso é barato de manter e é o que permite testar
regra de negócio (ex.: "correção de progresso é evento novo, nunca `UPDATE`")
sem subir SQLite.

## As duas regras que governam este repositório

### 1. `startServer()` não sabe onde está rodando

```ts
// o que muda entre Docker e Electron é o entrypoint, não isto
export async function startServer(): Promise<number>
```

Nada de `process.env.DOCKER`, nada de import de `electron`, nada de caminho relativo assumindo a estrutura do container. Quem sabe onde está é quem chama.

### 2. Path do banco e porta são configuráveis

```ts
const dbPath = process.env.WATCHPILE_DB_PATH ?? <default>
const port   = Number(process.env.PORT ?? 0)
```

No Docker, o path é um volume. No Electron, seria `app.getPath('userData')`. Porta hardcoded em `3000` colide na máquina do usuário — e usuário de homelab tem muita coisa na 3000 (brief, 3.4).

Essas duas decisões custam zero agora e evitam reescrita depois. Código que as viole é para ser apontado, não commitado.

## Banco

```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const sqlite = new Database(dbPath)
export const db = drizzle(sqlite)
```

`better-sqlite3` é **síncrono** — vantagem no main process do Electron: sem callbacks, sem race condition. Drizzle por cima dá schema tipado, migrations por CLI e um caminho de saída para Postgres trocando praticamente só o driver (brief, 3.3).

### Migrations

Migration gerada pelo `drizzle-kit` e a alteração em `src/db/schema.ts` **andam no mesmo commit**. Um sem o outro produz um histórico que não reproduz o banco.

### Seed de desenvolvimento

`bun run db:seed` (29/08/2026) enche o banco com obras e pilhas de mentira, pra
ter o que olhar enquanto as telas são construídas — o provedor de metadados
(3.10) não existe, então não há catálogo de verdade para trazer.

| Comando | O que faz |
| --- | --- |
| `bun run db:seed` | Cria obras e pilhas. Não faz nada se já houver obra |
| `bun run db:seed --reset` | Apaga as obras e pilhas do usuário antes |
| `bun run db:seed --home` | **Também refaz a home**: apaga os widgets e cria um de cada tipo |

`--home` é uma flag separada porque APAGA o layout que o usuário arrumou na
tela, e isso não é efeito colateral aceitável de "quero ver umas obras".

Não é migration nem fixture de teste: escreve no banco de `WATCHPILE_DB_PATH`,
roda à mão, e se recusa a rodar com `NODE_ENV=production`. Os testes têm o
próprio banco e não passam por aqui.

As obras são títulos reais de propósito, e a lista inclui os casos que quebram
layout: título de 41 caracteres, total desconhecido (`null`, o "12 / ?" da
seção 3.11), progresso na casa dos milhares, e os cinco status — inclusive
`dropped`, que quase nunca é testado.

### O arquivo `.db` nunca vai para o git

Ele contém a biblioteca inteira do usuário e, quando houver auth, os hashes de senha. Isso vale para `*.db`, `*.db-wal` e `*.db-shm`.

## Serve a API e o cliente

Por padrão o mesmo processo responde por duas coisas:

- `/api/*` → rotas do Hono
- resto → arquivos estáticos do build do Vite, com fallback para `index.html`
  (rota de SPA) — exceto sob `/api/*`, que nunca cai nesse fallback e segue
  para o 404 JSON normal

É o que permite o container único (brief, 3.1). Em desenvolvimento, o Vite sobe separado com o seu próprio dev server, e o cliente aponta para a URL da API.

Duas env vars controlam isso, ao estilo Suwayomi (`server.webUIEnabled`) — override, nunca requisito, como todo o resto de `env.ts`:

| Env var | Default | Efeito |
| --- | --- | --- |
| `WATCHPILE_SERVE_CLIENT` | `true` | `false` desliga o static serving inteiro — sobra só a API |
| `WATCHPILE_CLIENT_DIST_PATH` | `./client-dist` | onde o build do Vite foi colocado, relativo ao cwd do processo |

Implementado em `src/lib/configure-client-serving.ts`, chamado por `app.ts`
depois de toda rota registrada — é isso que garante que rota real sempre
vence o fallback do SPA, não a ordem de registro por si só.

Como o `client/dist` chega nesse caminho, sem monorepo: decidido em
"Plano de distribuição", mais abaixo.

## O contrato é gerado, não escrito

Não há monorepo, e não vai haver — é decisão do dono do projeto (brief, 3.7). O que
liga os dois repos é um contrato **gerado**:

```
Zod (aqui)  ──>  openapi.json (aqui, commitado)  ──>  tipos no cliente (lá, gerados)
```

- Rota se declara com **`@hono/zod-openapi`**: o mesmo schema Zod valida a requisição
  em runtime e descreve a rota no spec. Uma definição, dois usos
- **`openapi.json` é commitado neste repo.** É o contrato público — a mesma coisa que
  um cliente de terceiro consumiria. Ele é artefato: se o diff dele não aparecer junto
  com a mudança de rota, a geração não rodou
- **Nunca escrever à mão a interface que o cliente vai usar.** Se você se pegar
  fazendo isso, o gerador está sendo contornado

## Progresso: contador + log append-only

Brief, 3.11. A obra guarda o contador; cada mudança vira uma linha no log, com data.

Três regras que a implementação precisa respeitar, e que são fáceis de violar sem
perceber:

- **O log é append-only.** Desfazer é inserir evento com delta negativo. Nunca
  `UPDATE`, nunca `DELETE` — é isso que mantém o histórico honesto
- **`occurred_at` ≠ `created_at`.** O import grava com data retroativa; sem os
  dois campos, a estatística de quem migrou nasce toda no dia da migração
- **O contador é derivável do log, mas não é derivado em leitura.** Ele existe
  justamente para a UI não somar o log a cada render. Quem escreve no log escreve no
  contador, na mesma transação — `better-sqlite3` é síncrono, então isso é barato
- **O log é de PROGRESSO, e só.** Movimentação de coleção não entra: entrar numa
  pilha, sair dela, ser fixada. Poluir o log com isso estragaria exatamente a
  estatística que ele existe pra sustentar. A regra fica concreta em
  `remove_when_completed` (brief, 3.17) — ele apaga uma linha de `pile_entries`
  e **não escreve evento nenhum**

## Customização de pilha: dois campos que são comportamento, não conteúdo

Brief, 3.17, estendido em 31/08/2026 ao desenhar `/piles/:id`. Além de `name`,
`description` e a capa em BLOB, a pilha ganha:

| Coluna | O que faz |
| --- | --- |
| `remove_when_completed` | Obra marcada como `completed` sai da pilha sozinha |
| `pinned_at` | Nulável, e o `NULL` já é o não-fixado — ordena por si só, mais barato que booleano + coluna de ordem |

Três invariantes que a implementação não pode furar:

- **Nenhum dos dois cria um tipo de pilha.** Mesma invariante que a 3.12 protege
  nos tipos de mídia: a diferença é **dado numa linha**, nunca tabela ou classe
  nova. Desligar `remove_when_completed` devolve uma pilha comum sem migrar nada
- **Ele apaga associação, nunca a obra.** Mexe em `pile_entries`; a linha de
  `entries` — progresso, nota, log — fica inteira. Furar isso perde dado do
  usuário em silêncio
- **A capa chega já redimensionada, e o servidor NÃO normaliza dimensão**
  (31/08/2026). Quem corta e reduz é o navegador; aqui a validação é de **tipo e
  tamanho em bytes**, e é ela que protege o banco. O motivo não é elegância e sim
  empacotamento: `sharp` seria um segundo módulo nativo além do `better-sqlite3`,
  dobrando a superfície do `bun run electron:rebuild` em toda release. Custo
  assumido: um cliente que não seja o nosso pode subir 4000×4000 dentro do teto
  de bytes

## `.partial()` não desfaz `.default()`

Aprendido em 28/08/2026, gravando dado errado. Um schema de corpo com
`.default()` nos campos, reusado como `.partial()` para o PATCH, **continua
aplicando os defaults** quando a chave está ausente — então um PATCH que só
manda `filter` grava `w: 4, h: 4` por cima do layout que o usuário arrastou.

A regra: **create e patch são schemas separados.** Um campo base sem default,
o create estendendo com os defaults, o patch usando o base em `.partial()`.
Ver `features/home-widgets/home-widgets.routes.ts`.

Vale para qualquer PATCH parcial daqui pra frente, não só o de widget: o
sintoma é sempre o mesmo — mexer num campo apaga outro que ninguém tocou.

## Auth: multiusuário, e o servidor sobe sem env

Brief, 3.9. **Nada que o servidor precisa para subir vem de variável de ambiente** —
env é override, nunca requisito. É essa regra que faz o mesmo binário servir Docker e
Electron, onde ninguém edita `.env`.

| O que | De onde vem |
| --- | --- |
| Primeiro admin | Wizard de primeiro uso: banco sem usuário → toda requisição cai nessa rota |
| Segredo de sessão | Gerado na primeira vez que é necessário, persistido em `settings` |
| Sessão | Cookie assinado (`hono/cookie`) guardando um token opaco validado contra a tabela `sessions` — revogável de verdade, não JWT |
| Novos usuários | **Não existem — e é mais forte que "fechado por padrão"** (conferido em 03/09/2026): não há rota de registro NEM de criação por admin, então toda instalação tem exatamente um usuário. `settings.registration_open` é **coluna morta**: está na tabela desde a primeira migration e nenhuma linha de código a lê. É isso que deixa o nível de USUÁRIO do wizard (nome de exibição, avatar) sem como ser exercitado — ele espera este caminho existir (brief 3.9) |

No Electron, o processo main pode abrir a janela já autenticada como dono da
instalação; quem chega pela rede faz login normal. O servidor é o mesmo — muda quem o
entrypoint considera confiável.

### Onde passa a linha entre admin e usuário

Brief, 3.9, decidido em 30/08/2026: **infraestrutura da instância é do admin;
conteúdo é do usuário.** Provedor inteiro (definição, credencial e opções), tipo
de mídia e os avisos sobre essas coisas são do admin; obra, pilha, widget, Home,
progresso e log são do usuário. A regra existe para não responder "quem
configura isto?" de novo a cada feature.

**A guarda EXISTE, e nasceu com a primeira rota de admin.**
`src/middlewares/admin.ts`, criada junto da tela de tipos de mídia —
`users.is_admin` já estava no schema desde a primeira migration e
`getSessionUser` já o trazia, então não houve migration. **Esconder o item na
navegação do cliente não é proteção**: o cliente é agnóstico e qualquer um fala
HTTP com esta API.

Ela depende de `sessionMiddleware` ter rodado antes — é ele quem popula
`c.get('user')` —, e **separa 401 de 403 de propósito**: sem sessão o cliente
manda pro login, com sessão e sem cargo ele diz "isto é do admin deste
servidor". Mandar a segunda pessoa pro login diria que ela entrou errado, quando
ela entrou certo.

**Onde ela está ligada, e como:** `media-types.index.ts` gateia **por método**
(`GET` aberto, escrita de admin), porque a lista alimenta os chips de
`/library`, o selo da carta e a folha de obra — gatear a leitura deixaria o app
sem vocabulário pra quem não é admin. `providers.index.ts` gateia `/:slug` e
`/:slug/*`. As duas escolhas estão comentadas no lugar em que valem, porque são
o tipo de coisa que alguém "conserta" achando que foi descuido.

**"Tipo de mídia" são dois objetos, e só um é de admin — 31/08/2026** (brief
3.12). *Definir* o tipo — nome, ícone, unidade de progresso, se conta progresso
— é vocabulário da instância, e é o que precisa da guarda. *Escolher quais tipos eu
vejo* é preferência de exibição do usuário e não muda dado nenhum. Confundir os
dois põe guarda de admin em cima de uma preferência, ou deixa vocabulário aberto
a qualquer um.

**E o segundo objeto foi CONSTRUÍDO em 04/09/2026:** `src/features/preferences/`,
com `GET` e `PUT` em `/api/preferences/media-types`, mais a tabela
`hidden_media_types` (`0033`). Feature própria, e não uma rota dentro de
`media-types`, justamente pra não pendurar um campo por usuário dentro de um
objeto da instância — é onde as próximas preferências vão morar. Quatro
invariantes:

- **A tabela guarda o que está ESCONDIDO.** O padrão é ver tudo, então quem
  nunca abriu a tela não tem linha nenhuma e **tipo criado depois nasce visível
  pra todo mundo**. Guardar os visíveis obrigaria a semear uma linha por
  (usuário, tipo) na criação do tipo, e um tipo novo apareceria escondido pra
  quem já existia — o oposto do que o admin quis ao criá-lo
- **A preferência recorta o que é OFERECIDO, nunca o que existe** (decisão do
  dono). Ela some dos controles que oferecem tipo como escolha; **a obra que já
  existe de um tipo escondido continua visível**. Nenhuma consulta de `entries`
  olha pra esta tabela, e é assim que a contagem de uma pilha continua batendo
  com o que se vê
- **A escrita substitui o conjunto inteiro**, porque a tela é a lista toda —
  mesma régua do mapa de nomes do tipo. Dois toggles em sequência não podem se
  cruzar numa ordem que deixe o banco dizendo o que ninguém escolheu
- **Esconder TODOS é 400.** Sem nenhum tipo visível, a folha de criar obra fica
  sem o que oferecer e a busca fica sem escopo — beco de onde só se sai voltando
  a esta tela. É o "pelo menos um" do passo de instância, pelo mesmo motivo, e a
  tela anuncia a recusa antes do clique

**O tipo diz se há o que CONTAR, e só isso — 07/09/2026** (brief 3.12;
migrations `0043` a `0045`). `media_types.counts_progress`, e nada mais.

**Ele passou por três formas no mesmo dia.** O campo era `asks_total` (`0006`) e
respondia duas perguntas: filme tinha `0` porque não há o que contar, um webnovel
teria o mesmo `0` porque conta e não sabe o fim. A `0043` separou os objetos; a
`0045` **removeu** o que sobrou, porque *"o formulário pergunta o total?"* já
tinha resposta — o campo de total é opcional, e em branco produz o mesmo `NULL`.
O `false` dele só tirava a capacidade de registrar um total conhecido.

**A régua que fica: separar um campo que responde duas perguntas nem sempre dá
dois campos.** Às vezes a segunda resposta já existe um nível abaixo — aqui,
`entries.total`, que é por OBRA.

Quatro coisas que valem ao mexer nisto:

- **As migrations guardam pelo estado SEMEADO.** A `0043` desliga `movie` só
  enquanto `asks_total` era o `0` da semente; a `0044` desliga `game` só enquanto
  ele estava em `(1, 1)`. Admin que mexeu ali decidiu alguma coisa, e migration
  não desfaz decisão. **A da `0044` é mais fraca**, porque o estado semeado é
  alcançável de volta e nenhuma coluna separa as duas histórias — mesma parede da
  `0039`, *guarda de migration não lê intenção*
- **Nenhum dado de `entries` é tocado, e o import não muda.** É regra de
  EXIBIÇÃO: obra com progresso gravado mantém o número, e `progress` continua
  sendo escrito pra qualquer tipo
- **Mudar status nunca escreveu progresso, e continua não escrevendo.** Marcar
  `completed` num tipo 1:1 não inventa um `+1` que a pessoa não fez — o log é de
  progresso e só (brief, 3.11)
- **Há uma terceira pergunta que NÃO é do servidor:** `entries.total === 1`
  também não tem o que contar, em tipo nenhum. É de exibição pura e mora no
  cliente (`domain/shows-counter.ts`); aqui nada muda, e `total` continua sendo
  dado do usuário. **`1` e `null` são opostos** — num não há o que contar, no
  outro há e não se sabe quanto

**Apagar tipo em uso recusa com a contagem.** O admin pode tentar apagar um tipo
que obras de OUTRO usuário usam; a resposta é recusa com quantas obras o usam, e
não cascade. Migrar as obras para outro tipo antes de apagar **fica como
pendência** — reescreve dado de quem não pediu, e depende da central de
notificações, que não existe.

**O que a migration dos tipos obriga.** Os seis embutidos viram linhas semeadas, e
cada uma carrega o que hoje está espalhado em código: o ícone, o rótulo da unidade
de progresso e `counts_progress`. `entries.media_type` vira FK na maior
tabela do schema — é a migration mais cara de adiar.

**`settings.instance_language` nasce na migration de tipos — 31/08/2026**, com
default `en` e **sem UI**. Ele é o degrau 2 da queda de idioma abaixo, e regra
que a implementação não consegue cumprir é regra falsa. Quem o preenche
é o wizard de primeiro uso, **construído em 03/09/2026** e mergeado em 04/09 —
`POST /api/setup/instance`, em `src/features/setup/` (brief 3.9).

**O acervo de ícones é `z.enum` no contrato, não string livre.** 94 glifos em
`src/features/media-types/media-types.icons.ts`, curados medindo a 12px sobre o
selo de vidro. Duas coisas saem do enum de uma vez: a escrita recusa glifo
inexistente, e **o cliente recebe a lista pelos tipos gerados** — sem rota só
pra listar ícone e sem segunda cópia à mão (brief, 3.7). Na RESPOSTA o campo é
`string`, não o enum: um banco semeado por versão mais nova pode ter glifo que
este binário não conhece, e 500 por isso seria pior que devolver o nome.
Ampliar o acervo é mudança de contrato, e é o certo — ele é infraestrutura do
produto, não conteúdo de usuário.

**Os seis embarcados têm uma fonte VIVA, e a migration é o retrato congelado
dela — 31/08/2026.** `src/features/media-types/media-types.templates.ts` é o
módulo que `GET /api/media-types/templates` serve e que `Add type` lê pra
preencher a folha. Ele não é a segunda cópia à mão que o brief 3.7 proíbe:
migration não se reescreve, então `0006_media_types.sql` continua sendo o que aquele dia gravou, e
daqui pra frente quem manda é o módulo. **O que impede os dois de divergirem é um
teste**, que compara o módulo com o que um banco recém migrado contém, campo por
campo. A rota é **do admin**, sob a mesma guarda de escrever — template só serve
pra criar tipo —, e cai sob `router.use('/:slug', adminMiddleware())` por casar o
padrão de um segmento, o que está declarado em `media-types.index.ts` em vez de
acontecer por acaso.

**Provedores são semeados sempre, tipos não — e o verbo do lado dos tipos mudou
em 03/09/2026.** A migration `0006` insere os seis **incondicionalmente**, e
migration não se reescreve: num banco recém migrado o wizard encontra os seis já
lá. Então ele **apaga os não escolhidos** em vez de semear (brief 3.9) — o que
mantém intacto o teste que congela `MEDIA_TYPE_TEMPLATES` contra um banco recém
migrado, e é seguro porque no wizard não há obra e a recusa por contagem não tem
como disparar. Provedor é definição de **instância** e não pertence a tipo
nenhum (a associação é opcional e muitos-para-muitos, 3.10). Provedor semeado sem
tipo a que se ligar fica **ocioso, não quebrado** — nada no servidor precisa
tratar isso como erro.

**O nome do tipo é um mapa por idioma — 31/08/2026** (brief 3.12). Nome, plural
e rótulo da unidade de progresso são **texto** e vão por idioma; ícone e "pergunta
total" não. Escrever exige **um** idioma preenchido, não
todos. A leitura cai numa cadeia de três degraus — leitor, **instância** (não a
língua-base do produto) e primeiro preenchido —, e o terceiro é o que impede
string vazia num servidor monolíngue. Os seis semeados nascem com os dois idiomas
preenchidos e saem do catálogo de copy do cliente.

**O aviso de chave embarcada é NOTIFICAÇÃO de instância mais ESTADO na linha do
provedor — 31/08/2026** (brief 3.10). A notificação é o evento, nasce no primeiro
boot e é dispensável; o estado é descrição da linha e some sozinho quando a
instalação sai da chave embutida. São coisas diferentes e o servidor precisa das
duas: um evento em `notifications` com audiência `instance`, e um campo derivado
no `GET` do provedor dizendo de onde a credencial veio (env, arquivo de secret ou
literal embutido).

**A audiência de notificação é campo, não cargo.** `instance | user`: "esta
instalação usa a chave embarcada" é da instância e só o admin vê; "o import
terminou" é de quem importou. Escrever a regra curta "notificação é de admin"
erra no segundo caso.

**E o MECANISMO fechou em 05/09/2026, desenhando `/notifications`** (brief 3.9).
Três coisas que o schema precisa sustentar, e nenhuma é de aparência:

- **Chave de dedupe.** A notificação nasce uma vez por **condição**, não uma por
  boot — senão dispensar é desfeito no próximo restart do container, e um sinal
  que volta sozinho ensina a ser ignorado
- **Dispensa automática quando a condição se resolve.** "IGDB needs an API key"
  sai do painel quando a chave entra e **fica no histórico**: o evento aconteceu.
  Não é conceito novo, é o mesmo `dismiss` — resolver a condição *é* terminar com
  ela. Vale só pra notificação nascida de condição; "o import terminou" não tem o
  que resolver
- **Lido e dispensado são dois estados, não um.** Lido zera o contador do sino;
  dispensado tira do painel e mantém na rota. Sem a distinção, `/notifications`
  não mereceria endereço próprio — seria o painel com rolagem

**O emissor do primeiro ciclo é o de INSTÂNCIA**, porque é o único fato já
detectado: `providers.credentials.ts` resolve `source` em `none` | `embedded`, e
o teto do cache de arte acontece na gravação. Update de obra depende de
reconsultar provedor, que não existe; o import é o item seguinte da fila.

### O escopo por usuário já está em pé — e o que o mantém assim

Conferido em 30/08/2026. `entries`, `piles` e `home_widgets` têm `user_id`, e
**toda** consulta filtra por ele. O padrão que se copia ao escrever feature
nova, e que não tem middleware forçando:

- **Todo handler faz `c.get('user')` e devolve 401 antes de tocar no banco.** Não
  há guarda automática: esquecer a linha abre a rota
- **Toda cláusula `where` carrega `eq(<tabela>.userId, user.id)`** — inclusive
  no `update` e no `delete`, e não só no `select` que os precede
- **`userId` sai da resposta** (`const { userId: _userId, ...entry }`). É dado
  interno; não vaza pela API
- **Tabela de junção não tem dono, então a guarda é do pai.** `pile_entries`,
  `widget_piles` e `widget_entry_order` são alcançadas por `ownsPile`,
  `ownsEntry` e `findWidget(id, userId)`, **sempre antes** da escrita
- **Recusa é 404, não 403** ("Pile not found"). 403 confirmaria que a linha do
  outro usuário existe
- **`event_log` e `external_ids` não têm `user_id`** — pendem de `entries` com
  `onDelete: 'cascade'`. São donos por transitividade, e a consequência é da
  rota de histórico que ainda vai nascer: ela **tem que passar por `entries`**
  para saber de quem é a linha, porque a tabela sozinha não responde isso

**O que falta é teste, não código.** Há caso de outro usuário em
`entries.test.ts`, `piles.test.ts` e `home-widgets.test.ts`, mas
**`piles.entries.test.ts` não tem nenhum**: as guardas de `pile_entries` estão
escritas e não estão provadas.

### A obra pode nascer dentro de uma pilha — 01/09/2026

`POST /api/entries` aceita **`pileIds` opcional** (brief, 3.17), e as três
escritas — `entries`, `external_ids` e `pile_entries` — vão na **mesma
transação**. Escolher a pilha na folha é o mesmo gesto de adicionar a obra; uma
obra que nascesse fora da pilha escolhida seria um acerto pela metade, sem nada
na tela dizendo qual metade falhou.

- **A regra de entrar e sair de pilha mora em `piles.membership.ts`**, não na
  feature de obra — mesmo argumento de `piles.auto-remove.ts`: quem sabe onde
  uma obra se encaixa numa pilha é a pilha. Sem isso, a conta do índice
  fracionário existiria em dois handlers
- **Posição é o fim da pilha.** Append nunca esgota a precisão, e é por isso que
  este caminho não precisa do rebalanceamento que o arrasto precisa
- **Pilha desconhecida é 400 ANTES de a transação abrir** — nenhuma obra chega a
  existir. Pilha de outra pessoa recebe a **mesma** resposta: distinguir "não
  existe" de "não é sua" deixaria descobrir o acervo alheio por tentativa
- **Id repetido no corpo é o mesmo pedido, não dois.** O par (pilha, obra) é
  único no schema, e recusar `[3, 3]` viraria uma falha que a tela teria de
  explicar sem ter como
- **Nascer `completed` dentro de uma pilha que se esvazia sozinha não tira a
  obra dela.** As duas coisas foram pedidas no mesmo gesto, e o gatilho do
  auto-remove é a **escrita** do status — a mesma leitura que o `PATCH` já fazia

**E `updated_at` da pilha se move quando ela ganha ou perde obra.** Isso estava
furado: só o auto-remove carimbava, então uma pilha ficava parada na ordem
"Recently updated" no caminho mais usado e só subia ao se esvaziar sozinha.
Recusa não carimba — um 404 não tocou a pilha. **Reordenar ficou de fora**: a
composição não muda, só a ordem, e se isso conta como "atualizada" é outra
pergunta.

## Provedores de metadados

Brief, 3.10.

### O que já está construído — 31/08 e 01/09/2026

**A configuração E o motor**, em `src/features/providers/` e
`src/features/search/`. O que falta do 3.10 é o **cache de arte em disco**, e do
lado do cliente a tela de Settings e o buscar-ao-adicionar.

| Peça | Onde |
| --- | --- |
| `providers` + `media_type_providers` | `src/db/schema/providers.ts` |
| `external_ids.provider` como FK | `src/db/schema/external-ids.ts` |
| Migration com o TMDB semeado | `0007_providers.sql` |
| A cadeia de precedência da credencial | `providers.credentials.ts` |
| O literal embarcado | `providers.embedded.ts` — **vazio no repositório desde 08/09/2026**; quem preenche é `scripts/embed-credentials.mjs`, rodado pelo CI a partir de secrets |
| Montagem de requisição a partir da definição | `providers.auth.ts` |
| `GET /api/providers`, `PATCH /:slug`, `POST /:slug/test` | `providers.routes.ts` |
| O cliente genérico | `providers.client.ts` |
| Limitador (balde de fichas, em memória) | `providers.limiter.ts` |
| Cache de resposta com validade | `providers.cache.ts` + tabela `provider_cache` |
| `GET /api/search?type=&q=` | `src/features/search/` |
| O molde da URL de arte (`art_template`) | `providers.client.ts` + `0010_provider_art_template.sql` |

**Seis invariantes que o próximo ciclo não pode furar:**

- **O TMDB é uma LINHA, não um caminho em código.** `providers.seed.ts` é a
  fonte viva e a migration é o retrato congelado dela, com um teste comparando
  campo por campo — mesma forma de `media-types.templates.ts`. Escrever um
  `if (slug === 'tmdb')` em qualquer lugar desfaz a decisão inteira
- **A FK aponta pro `slug`**, e é isso que fez o enum virar tabela sem
  reescrever dado: as linhas já guardavam `'tmdb'` como texto
- **O segredo nunca sai.** O `GET` devolve `configured` e os últimos quatro
  caracteres. **A mensagem de erro de rede é fixa**, e não a do `Error`: a URL
  montada carrega a chave na query quando o estilo é `query-key`, que é o do
  TMDB — repetir o erro seria o segredo vazando por um endpoint de diagnóstico
- **O `PATCH` MESCLA credencial, ao contrário do mapa de nomes de um tipo, que
  substitui.** A assimetria é deliberada: lá substituir é o que torna apagar uma
  tradução possível; aqui obrigaria a tela a reenviar segredos que ela nunca
  recebeu. **String vazia é o que apaga uma credencial**
- **`POST /:slug/test` responde 200 mesmo quando o provedor recusa a chave.** A
  requisição nossa deu certo; 4xx faria o cliente dizer "não foi possível
  alcançar o servidor", que é a frase errada pra uma chave errada
- **Ler é de todo mundo; escrever é do admin.** A leitura fica aberta porque a
  **atribuição** é condição de uso e renderiza pra qualquer um, e porque saber
  que um tipo não tem provedor é o que deixa a busca dizer isso em voz alta

### O cache de arte — construído em 01/09/2026

`GET /api/entries/{id}/art`, em `src/features/art/`. **Cache de leitura**: em
disco serve; fora, busca no provedor, grava e serve. Sem job e sem varredura —
o descarte acontece na gravação, pelo mesmo motivo.

| Peça | Onde |
| --- | --- |
| O índice do que está em disco | `src/db/schema/art-cache.ts` + `0011_art_cache.sql` |
| A regra pura de descarte (LRU) | `art.eviction.ts`, com testes |
| Disco + teto + índice | `art.store.ts` |
| Resolver a URL no provedor e baixar | `art.fetch.ts` |
| A rota | `art.routes.ts` + `art.handlers.ts` |
| `art` na obra, e a projeção compartilhada | `entries/entries.public.ts` |

**Sete invariantes:**

- **Enche na primeira vez que a arte é PEDIDA**, não ao adicionar a obra:
  adicionar não pode esperar a rede, e buscar em segundo plano pediria uma fila
  que este servidor não tem. A promessa é *"a arte que você já viu abre
  offline"*
- **A URL sai do endpoint `detail` da definição**, nunca de coluna nova. Coluna
  seria dado do provedor desnormalizado aqui dentro, que envelhece quando o
  pôster muda e que a obra vinculada **depois** não teria. A resposta do detalhe
  passa pelo mesmo `provider_cache` da busca
- **A permissão é da OBRA; o arquivo é da INSTÂNCIA.** A rota é por `entries`
  porque é ela que tem dono; a chave do arquivo é (provedor, id externo) porque
  arte não é dado pessoal — e é isso que faz o teto valer pro servidor em vez de
  por conta
- **Nome de arquivo é HASH**, não id saneado. O id vem de terceiro e pode trazer
  barra ou `..`; hash não tem caractere de saída no alfabeto, então a travessia
  vira impossível por construção em vez de uma lista de coisas a escapar
- **Ler marca como usado.** Sem isso `last_used_at` é a data de gravação com
  outro nome, e a obra que se abre toda semana sai junto com a que nunca se
  abriu. `atime` não serve: `noatime` é comum em NAS caseiro
- **Linha sem arquivo se apaga sozinha.** Quem faz backup copiando só o `.db`
  restaura o índice sem os arquivos, e o cache diria "tenho" pra sempre
- **Toda falha responde 404**, e é decisão: o alvo é um `<img src>`, o navegador
  não lê corpo de erro, e o que a tela faz em qualquer caso é o mesmo. O motivo
  vai pro log

**A projeção da obra deixou de ser copiada à mão em DEZ lugares**
(`entries.public.ts`). É a mesma jogada de `piles.public.ts` e pelo mesmo
motivo: acrescentar campo derivado a dez destructuring soltos é como um deles
fica pra trás — e o que fica pra trás não quebra teste nenhum, só devolve menos.
As fontes de arte de uma lista inteira resolvem em **uma consulta**, nunca uma
por linha.

### As unidades de uma obra — 01/09/2026

`src/features/providers/providers.units.ts` mais `titles.routes.ts`. **Não se
chama "episódio"** (brief, 3.10): o que generaliza é *partes numeradas,
opcionalmente agrupadas*, e "unidade" é o vocabulário que
`media_types.progress_unit` já tinha.

- **Não há tabela de unidade, e não vai haver.** A lista é apresentação do
  contador: marcar a unidade `n` é levar o progresso até `n`, num evento só do
  log append-only
- **`detail_path`, `units_path` e `unit_map` são da JUNÇÃO**, como `search_path`
- **Os grupos saem da resposta de DETALHE** que já foi buscada — nenhuma ida à
  rede a mais —, e o `name` deles é o do provedor
- **404 quando o par não declara unidades**, sem tocar no provedor: filme não
  tem episódio, e a pergunta não faz sentido

**O defeito que isto corrigiu, e ele era antigo:** o endpoint de detalhe era do
PROVEDOR, e o TMDB lê `/movie/{id}` e `/tv/{id}`. Pedir o detalhe de uma série
trazia o filme de mesmo id, e **o cache de arte tinha o mesmo defeito**, latente
por só ter sido exercido com filme. O teste que congela a semente contra a
migration comparava só `search_path` e `field_map`; passou a comparar campo a
campo, porque retrato que confere metade do rosto não é retrato.

**Quatro invariantes que o motor acrescentou — 01/09/2026:**

- **O "como" de uma busca é do PAR (tipo, provedor), não do provedor.** O TMDB
  obriga: `/search/movie` e `/search/tv` devolvem campos diferentes pra mesma
  ideia. `media_type_providers` carrega `search_path` e `field_map`; nulo cai no
  do provedor
- **Opção chega ao provedor por `{option:<chave>}` no endpoint**, mesmo
  templating do `{id}`. O lugar de cada opção é propriedade do ENDPOINT, não do
  formulário — é isso que impede opção nova de virar migration
- **A credencial NÃO entra na chave do cache.** Correção (rotacionar a chave não
  invalida resposta válida) e contenção (no TMDB a chave viaja na query, e
  keyar por ela a copiaria pra uma segunda tabela). As OPÇÕES entram, e isso não
  contradiz o brief: o que ele decidiu é que elas não se multiplicam **por
  usuário**
- **Salvar configuração de provedor esquece o cache dele.** `language` muda
  literalmente o que volta; servir a resposta antiga faria o admin achar que
  salvar não teve efeito
- **O molde da URL de arte é da DEFINIÇÃO, não do cliente — 01/09/2026** (brief,
  3.10). O TMDB devolve `/abc.jpg`, que nenhuma tela renderiza; montar a URL é
  conhecimento do provedor, e escrever isso no cliente seria o
  `if (slug === 'tmdb')` que a primeira invariante proíbe. `art_template` fica na
  mesma prateleira de `search_path` e `field_map`, `{path}` recebe o valor cru, e
  **o tamanho mora dentro do molde**. Provedor que já devolve URL absoluta não
  precisa de molde; **relativo sem molde vira nulo, nunca imagem quebrada**

**A busca não mente sobre por que não achou.** Tipo sem provedor é **503 com
`reason`**, nunca lista vazia — e tipo que não existe é **404**, checado antes,
porque slug com erro de digitação não pode se ler como "falta configurar um
provedor". Os **seis** motivos apontam pra saídas diferentes: admin, chave, ou
só esperar — eram cinco até 02/09/2026, quando `provider-error` virou
`provider-refused` e `provider-down`.

**Fora de escopo por decisão, e não por esquecimento:** criar e apagar provedor.
O v1 é só TMDB e ele é semeado; validar uma definição inteira vinda de fora é
outra superfície. O `ON DELETE restrict` de `external_ids` já está lá porque
apagar provedor levaria junto a informação de que uma obra é `tmdb/550`.

### O Kitsu, e o que o quarto provedor cobrou — 02/09/2026

`providers.seed.ts`, mais `0021_kitsu.sql` e `0022_jikan_name.sql`. **Anime e
mangá saem do Kitsu**, com o Jikan continuando associado como alternativa.

O Jikan caiu, e não do jeito que a issue dele diz. Medido: `/anime/{id}`
responde 200 e **todo o resto devolve 504** — busca de anime, busca e detalhe de
mangá, `/anime/{id}/episodes`, e o `test` da própria definição. Só o detalhe de
anime está de pé, o que o torna inalcançável na prática.

**Uma peça nova no contrato, e ela não é caso especial:**

- **`endpoints.accept`** — o `Accept` que o provedor exige. O Kitsu fala JSON:API
  e responde **406** ao `application/json` que `prepareRequest` mandava fixo.
  Mora no plural do provedor porque é propriedade do dialeto dele, e **não é
  coluna nova**: `endpoints` já era JSON

**Quatro invariantes que o próximo provedor não pode furar:**

- **Ausência declarada é resposta, não lacuna.** `score` e `votes` ficam fora do
  Kitsu porque a escala dele é 0–100 contra 0–10 dos outros, e o contrato não tem
  vocabulário de escala; mapear assim mesmo poria "88.8" onde a obra do TMDB
  mostra "8.9". Mangá fica sem `units_path` porque `/manga/{id}/chapters` devolve
  capítulo sem título e sem data — e aqui a ausência é **escolha**, não falta de
  endpoint, ao contrário do Jikan
- **O teto de paginação é do provedor e vai no caminho.** `page[limit]=20` viaja
  dentro do `units_path` porque 20 é o máximo dele: `40` e `100` devolvem
  `data: []` — zero itens, sem erro, que é a forma mais silenciosa de falhar
- **Teto de requisições auto-imposto quando o provedor não publica um.** Omitir
  cairia no padrão do limitador, que é 20/s calibrado pelo TMDB e generoso demais
  pra um serviço de comunidade. Quando o provedor não diz, quem declara é a nossa
  contenção
- **Nome identifica, atribuição credita.** `Jikan (MyAnimeList)` duplicava dentro
  do nome o que `attribution` já dizia, e o custo aparecia na tela: a 12px ele
  ocupa 114px contra 28–73 dos outros e espremia o nome do TIPO no menu de
  escopo. `0022_jikan_name.sql` encurta pra `Jikan`; `attribution` não muda

**E o primeiro padrão gravado.** `anime` e `manga` ganharam
`default_provider_slug = 'kitsu'`. Isso **não** contradiz a `0009`, que deixou a
coluna sem semeadura de propósito: ela dizia que "decisão só é necessária quando
há ambiguidade", e a ambiguidade nasceu agora — sem padrão, o desempate por
slug entregaria a busca ao provedor em 504. O `UPDATE` é guardado por `IS NULL`
(decisão do admin não se sobrescreve num upgrade) e por `EXISTS` sobre a junção.

### O corpo do pedido entra na definição — 02/09/2026

`providers.body.ts`, `0024_provider_post_body.sql`, `0025_anilist.sql`. **O
AniList é o QUINTO provedor, e o primeiro que fala por `POST`.** Ele estava fora
desde o começo por um motivo só: GraphQL é POST com corpo, e o cliente genérico
não sabia dizer outra coisa.

| Peça | Onde |
| --- | --- |
| A união fechada por dialeto | `ProviderBody` em `db/schema/providers.ts` |
| A montagem do corpo, com escape | `providers.body.ts` + `.spec.ts` |
| O corpo do PAR | `search_body` / `detail_body` na junção |
| HTML virando texto | `providers.text.ts` + `.spec.ts` |

**Seis invariantes:**

- **A presença do corpo é o que faz o pedido ser `POST`.** Não há `method`
  separado: não existe endpoint de provedor que seja POST sem corpo nem GET com
  um, e dois campos que só variam juntos são dois jeitos de escrever a mesma
  coisa — o segundo é o que fica errado
- **O dialeto é declarado, e quem escapa é ele.** `json` serializa com
  `JSON.stringify` depois de substituir, então aspas e quebra no termo saem de
  graça; `apicalypse` interpola em texto e o escape é nosso. Um campo de texto
  cru com um "tipo" ao lado empurraria essa diferença pra quem escreve a
  definição, e **escapar errado numa linguagem de consulta não é resultado feio,
  é injeção**
- **Em JSON o marcador é a FOLHA INTEIRA, nunca interpolado.** `{id}` é sintaxe
  válida de GraphQL — `query { Media(id: 1) {id} }` tem `{id}` literal dentro —,
  e substituir por texto trocaria a *seleção de campo* pelo id da obra. Exigir a
  folha completa torna a colisão impossível por construção, e não custa nada: em
  GraphQL o dado do usuário vai em `variables`, que é sempre folha
- **O CORPO entra na chave do cache.** Com `POST` a URL para de identificar a
  consulta — o AniList atende tudo em `POST /`. Sem isso a primeira busca
  responderia por todas as seguintes, que é **o defeito mais silencioso
  possível**: resultados plausíveis para a palavra errada, sem erro nenhum. Vai
  como hash, e **só quando há corpo**, senão toda chave já gravada mudaria
- **O corpo é do PAR quando o par declara um.** Mesma régua de `search_path` e
  `detail_path`: no AniList o endereço é `/` pra tudo, e quem separa anime de
  mangá é a variável `type` dentro do corpo. Verificado ao vivo — pedir um id de
  anime com `type: MANGA` devolve **404**, e o motor devolve `not-found`
- **`endpoints.textFormat` diz em que formato a PROSA dele vem**, ao lado do
  `accept` e pelo mesmo motivo: é propriedade do dialeto. A sinopse do AniList
  tem `<br>` e `<i>`, e **`asHtml: false` não resolve** — verificado, volta HTML
  das duas formas. **Só a prosa é convertida**; título e rótulo são
  identificadores, não texto corrido. E é declarado em vez de limpo sempre
  porque limpar a prosa dos outros quatro transformaria uma sinopse com `a < b`
  em dano colateral silencioso

**Duas ausências declaradas no AniList**, as duas já conhecidas: `score`/`votes`
fora pela escala 0–100 (a **segunda** ocorrência da mesma ausência, o que a
promove de caso a padrão e diz que o vocabulário de escala é decisão esperando
dono), e **sem `units_path`** porque ele devolve só a contagem (brief, 3.10).

**As unidades continuam sendo `GET`, e isso é ausência declarada** — não há
`units_body`, porque nenhum provedor de corpo tem lista de unidades. Vocabulário
não exercitado é o que nasce errado.

**O teto dele é MEDIDO, não lido.** `x-ratelimit-limit: 30` — trinta por minuto,
0,5/s — enquanto a documentação fala em 90. **Quando os dois discordam vale o
observado**, que é o que a instalação vai encontrar. Primeiro `perSecond`
fracionário; o balde de fichas já era ponto flutuante.

**E o teste que congela a semente ganhou as duas colunas novas.** Ele passou
verde sem conferi-las — exatamente a lacuna que deixou `detail_path` nascer
torto em 01/09/2026, num teste cujo comentário já dizia "campo a campo, e
todos". Retrato que confere metade do rosto não é retrato, e a metade que falta
é sempre a recém-chegada.

### O IGDB, e o primeiro OAuth executado — 02/09/2026

`providers.token.ts`, `0026_igdb.sql`. **O sexto provedor, e o primeiro que
nasce exigindo configuração do admin.** Ele usa o degrau do corpo (`0024`) pelo
outro dialeto — apicalypse — e executa o `oauth-client-credentials`, que estava
declarado desde a `0007` e nunca tinha rodado.

| Peça | Onde |
| --- | --- |
| O cache de token, em memória | `providers.token.ts` + `.spec.ts` |
| O segundo header (`Client-ID`) | `AuthStyle.idHeader` |
| O ano em timestamp | `FieldMap.yearFormat` + `yearOf` |
| O escape por marcador | `providers.body.ts`, `comoToken` |

**Sete invariantes:**

- **O token se guarda, e em MEMÓRIA.** Medido ao vivo: `expires_in` volta
  **5.327.537 segundos**, 61,7 dias. Pedir um por busca bateria na Twitch por um
  valor que não muda em dois meses. Em memória pelo motivo do limitador (um
  processo só, brief 3.1) **mais um que o limitador não tem**: o token é derivado
  do segredo, e gravá-lo faria uma segunda cópia de material secreto viajar
  dentro do `.db` do backup
- **`401` na consulta joga o token fora.** Sem isso, um token revogado do lado
  deles continuaria "válido" aqui por dois meses — toda busca voltaria 401 e o
  "testar conexão" diria que está tudo bem, porque a credencial de fato está
  certa. **Não há repetição automática**, e é escolha: repetir esconderia do log
  que a primeira falhou
- **`idHeader` é exigência DELE, não do OAuth**, e foi descoberto **sem
  credencial nenhuma**: o 401 do IGDB responde com uma lista de dicas cuja
  primeira é literal — *"Ensure you are sending Authorization and Client-ID as
  headers"*. Bater no endpoint sem chave é uma sonda barata que descreve o
  contrato
- **Recusa na troca de token NÃO é `not-configured`.** As duas credenciais estão
  preenchidas e quem recusou foi o provedor; mandar "falta configurar" levaria o
  admin a um formulário cheio sem dizer o que está errado nele. Vira
  `provider-refused` na busca e uma frase própria no "testar conexão", que é
  onde ela é mais útil — validar credencial é literalmente o que aquele botão
  existe pra fazer
- **`yearFormat` existe porque o modo de falhar era o pior possível.**
  `first_release_date` é timestamp Unix, e ler os quatro primeiros dígitos de
  `1431993600` daria o ano **1431** — plausível, na coluna certa, sem erro
  nenhum. Ausência declarada não serviria: o dado existe e está certo, era a
  leitura que precisava saber o formato. **E as duas `yearOf` viraram uma**: a
  busca lia por regex e o detalhe por `slice(0,4)`, respondendo igual para
  `1999-10-15` — que é como duas contas da mesma coisa convivem até uma precisar
  mudar
- **Em apicalypse o escape depende de ONDE o marcador está.** `{term}` mora
  entre aspas e leva escape de aspas; `{id}` fica **solto** em `where id = {id}`,
  e ali o valor **é** a sintaxe: `1 | id = 2` reescreve a consulta sem ter uma
  aspa sequer pra escapar. Fora de `[A-Za-z0-9_.-]` o valor sai vazio e o
  provedor recusa com `4xx` — ruidoso, que é o certo, porque um id assim não
  pode ter vindo dele. É a régua de `pathWithId` no corpo
- **O `fetchImpl` e o `timeoutMs` seguem para a TROCA DE TOKEN.** Sem repassá-los
  aos quatro chamadores, o estilo usaria o `fetch` global — e o sintoma foi um
  teste com dublê **batendo no provedor de verdade** e voltando `400 invalid
  client`. Injeção que não alcança o caminho novo não é injeção

**O secret NÃO é embarcado, e é decisão do dono do projeto** (brief, 3.10). A
cláusula da Twitch é literal contra, e o teto é por `client_id` — uma chave nossa
na release seria 4 req/s divididas por todas as instalações. Consequência
assumida: buscar jogo numa instalação recém-criada recusa com `not-configured`,
e a tela manda o admin pra Settings.

**A ausência declarada, pela TERCEIRA vez:** `score`/`votes` fora, porque
`total_rating` é 0–100 contra os 0–10 do TMDB. Depois do Kitsu e do AniList,
três ocorrências fazem "falta vocabulário de escala" virar pendência com dono.

**Duas coisas medidas que contradizem o que se supõe:** ele **não devolve header
de rate limit** — os 4/s são da documentação, não observados, ao contrário do
AniList, onde o header desmentiu a doc. E o detalhe volta como **array de um
elemento**, o que é o `0.` no `detail_field_map`; o leitor de caminho pontuado
atravessa índice numérico sem código novo, porque array em JavaScript é objeto
com chave de texto.

**Nada de `where game_type = 0;` na busca**, e foi medido: o filtro tira o port
de Vita e a DLC de "hollow knight", o que parece melhora — mas tira junto
remaster, port e expansão standalone, que são obras que alguém legitimamente
acompanha. Busca que esconde o que existe é pior que busca com um item a mais.

### O SUBTIPO no mapa de campos — 02/09/2026

`field_map.subtype`, `providers.text.ts`, `0027_provider_subtype.sql`. **O que a
obra é DENTRO do tipo dela** — `TV`, `Mod`, `One Shot` —, e o que conserta a
busca por "hollow knight" devolvendo duas linhas com o título idêntico.

**Quatro dos seis provedores têm o conceito**, com quatro nomes: `game_type.type`
(IGDB), `format` (AniList), `attributes.subtype` (Kitsu), `type` (Jikan). TMDB e
Open Library ficam nulos. É isso que o faz vocabulário e não campo a serviço de
um provedor.

**Cinco invariantes:**

- **A saída não é filtrar.** Cortar por `game_type` tiraria mod e DLC, mas
  tiraria junto remaster, port e expansão standalone. Busca que esconde o que
  existe é pior que busca com uma linha a mais, e quem decide qual é a obra certa
  é quem procurou
- **Constante de catálogo se NORMALIZA; frase do provedor vem CRUA.** `Season 1`
  é copy dele e passa direto; `ONE_SHOT`, `manga` e `Main Game` são enums do
  catálogo, e crus apareceriam os três na mesma linha. A régua anterior ("o
  rótulo do grupo vem do provedor") parecia cobrir isto e não cobre
- **`subtypeLabel` não sabe de provedor nenhum** — sabe de sublinhado e de caixa.
  Um `{ ONE_SHOT: 'One shot' }` por provedor seria o `if (slug === …)` do brief
  3.10 escrito de outro jeito
- **A regra de sigla só vale para valor de UMA palavra**, e um teste cobrou:
  `ONE_SHOT` parte em `ONE` e `SHOT`, e as duas passam sozinhas, dando `ONE
  SHOT`. Sublinhado já declara o valor composto, e composto não é sigla
- **O IGDB e o AniList precisam PEDIR o campo**, então `endpoints` mudou junto de
  `field_map`. Sem isso o mapa apontaria pra um campo ausente e o subtipo viria
  nulo **em silêncio** — nada acusa

**Não vai pra `entries`**: é contexto do provedor, como ano, sinopse e arte, e
envelhece com a resposta de detalhe.

### O VÍNCULO entre obras — 02/09/2026

`field_map.relations`, `providers.relations.ts`, `0028_relation_columns.sql` +
`0029_provider_relations.sql`. **Lista com tipo**, e o `parent_game` do IGDB é
uma lista de um — três dos seis provedores têm o conceito, e medir isso mudou o
recorte antes da primeira linha de código.

**Seis invariantes:**

- **Não é `external_ids` nem `links`.** Aponta pra outra obra do MESMO catálogo,
  que a tela abre sem sair do produto, e por isso carrega provedor, id externo
  **e tipo**. Não vira linha em tabela nenhuma
- **`provider_type_token` traduz, e a tradução é DADO.** Um vínculo atravessa
  tipo, e a rota precisa do nosso slug; o provedor devolve o dele (`MANGA`,
  `manga`) e a junção diz a que tipo corresponde. Nulo = o provedor não
  distingue, que é o IGDB
- **`relations_path` é `units_path` estendido.** Nulo significa "leia do corpo do
  detalhe", **não** "não há vínculo" — quem diz que não há é a ausência de
  `relations` no mapa
- **A junção JSON:API é do DIALETO.** `includeRef` declara a ligação, e o par
  `{tipo, id}` é a chave inteira: em JSON:API o id é único dentro do tipo, então
  um `anime` 8 e um `manga` 8 convivem. Com junção, `kind` sai do item e o resto
  do recurso resolvido
- **Vínculo pra tipo que a instalação não tem cai fora**, porque não é navegável.
  E **`relations` não entra em mapa de BUSCA**: vinte resultados não mostram
  vínculo, e puxá-lo infla a resposta por nada
- **Falha na segunda requisição NÃO derruba o detalhe.** Vínculo é contexto; a
  obra é o ponto da tela. Degrada pra lista vazia, que é o que o provedor sem o
  conceito já entrega

**E o defeito que voltou por outra porta:** o módulo nasceu com um `yearOf`
próprio e devolveu o ano **1487** do timestamp do IGDB — a mesma falha que
`yearFormat` tinha corrigido horas antes, no mesmo dia, e cuja correção foi
justamente unificar duas cópias de `yearOf`. **Módulo novo é onde a regra
recém-aprendida não chegou.**

### As RECOMENDAÇÕES, e o que medir antes economizou — 03/09/2026

`field_map.recommendations`, `0031_provider_recommendations.sql`. **A mesma forma
do vínculo, num campo à parte** (brief, 3.10) — e a fila pedia dois provedores,
mas medir achou **três**: TMDB (via `append_to_response`), AniList e IGDB. Kitsu
responde `404` no endpoint; Open Library e Jikan não têm o conceito.

**Nenhum campo novo, nenhuma coluna nova.** `RelationMap` já descrevia tudo, e a
migration só reescreve `endpoints` e `field_map` dos três — gerada por
`scripts/print-provider-seed.ts <slug> --update`, como manda a régua da semente.

**Seis invariantes:**

- **`mapRelations` recebe o MAPA, não o `field_map`.** Antes lia
  `fieldMap.relations` por dentro, o que a prendia a um conceito só. A
  alternativa era uma segunda função idêntica, que divergiria no tratamento de
  item nulo — que é onde as duas mais se parecem
- **`kind` é nulo em toda recomendação, e fica.** `kindConst: 'Recommended'`
  seria copy de tela nascendo aqui, pela **quinta** vez neste repo. Quem nomeia a
  seção é a tela, que sabe o idioma de quem lê
- **O TMDB pega carona no detalhe** em vez de usar
  `/movie/{id}/recommendations`, que existe. O endpoint separado custaria coluna
  nova na junção (o caminho é por par), segunda ida à rede e segunda entrada de
  cache — três coisas pro mesmo JSON. **Custo medido e assumido:** o detalhe de
  uma série vai de 5,5 KB a 19,5 KB em `provider_cache`, e não dá pra pedir menos
- **O TMDB dispensa `provider_type_token`**, que segue nulo na junção dele.
  Conferido nos dois pares: `/movie/…` só devolve `movie`, `/tv/…` só `tv`.
  Ausente quer dizer "o mesmo tipo da obra", que é a resposta certa quando o
  endpoint já é do tipo — o caso do IGDB
- **Não há `recommendationsBody` nem `recommendations_path`**, e é ausência
  declarada: os três entregam no corpo do detalhe. Provedor que um dia sirva em
  endereço próprio abre eixo novo e se declara, como `relations_path` fez pelo
  Kitsu. Vocabulário não exercitado é o que nasce errado
- **O teto é do provedor.** Pede-se dez onde dá (AniList `perPage`), aceitam-se
  os dez fixos do IGDB e os vinte do TMDB, que não aceita tamanho de página. A
  assimetria é honesta; um número nosso seria calibrado por ninguém

**Duas coisas que só a rede disse, e as duas estão na semente comentadas:**
`pageInfo` dentro de `recommendations` derruba o AniList com **500** (o `sort`
não — isolado um pedido por vez), e **sem `sort: RATING_DESC` a ordem não é a de
relevância** — medido, os três primeiros voltam com `rating` 298, 254 e 1172.

**Os testes congelam a forma MEDIDA de cada provedor**, e não o mapeador, que já
estava coberto: é a definição descrevendo o que o provedor de verdade devolve que
um refactor da semente pode quebrar em silêncio, porque nada mais lê aqueles
caminhos.

### O MyAnimeList, o SÉTIMO provedor — 07/09/2026

`0036_mal.sql`. **O primeiro desde o TMDB que carrega `score`**, e a definição
inteira foi **medida** contra a API real — a referência oficial deles não traz uma
amostra de resposta sequer (`node` aparece zero vezes no texto renderizado), então
o envelope só era conhecido por wrappers da comunidade, e escrever `field_map` a
partir disso seria modelar de terceira mão.

- **`mean` é 0–10**, a mesma escala do TMDB. Kitsu, AniList e IGDB ficaram sem
  `score` porque a deles é 0–100 — a ausência declarada três vezes não virou
  regra, virou pendência, e este provedor mostra por quê
- **Zero é DESCONHECIDO em `num_chapters`.** Berserk (`currently_publishing`)
  devolve 0, Monster (`finished`) devolve 162. O mapeador já lia zero como
  ausente, então nada precisou mudar — mas é o tipo de coisa que só medir diz
- **`auth.idHeader` não serve aqui: é `header-key` puro.** `X-MAL-Client-ID`
  sozinho, sem OAuth, é o que a leitura pública pede. O par OAuth existe pra
  perfil privado e é outra decisão (3.10, "token de conta de usuário")
- **Teto de 3/s é contenção NOSSA.** Ele não manda header de rate limit nem
  documenta um — mesma régua do Kitsu: quando o provedor não diz, quem declara é
  a nossa contenção
- **A marca dele NÃO entra na tela, e é o contrato que diz.** A seção 17 do
  *API License and Developer Agreement* proíbe incluir as marcas deles em "Your
  Applications", e a única exceção (3(a)(xiii)) é usá-las **para atribuir a
  fonte**, com uma FRASE como exemplo. Daí `attribution` em texto e o ladrilho da
  tela ficar na inicial — o fallback que o design system já previa ao decidir
  marca de terceiro
- **Ele virou o PADRÃO de `anime` e `manga` com o `UPDATE` guardado por
  `= 'anilist'`** — trocando só a escolha automática anterior, nunca a de um
  admin —, e **o padrão voltou pro AniList horas depois** (`0039`, decisão do
  dono). As duas migrations respondem perguntas diferentes: a `0036` respondia
  *"o que faz a busca funcionar hoje?"*, a `0039` responde *qual é a melhor
  fonte*. Enquanto o 403 deles durar, buscar anime e mangá **recusa** com
  `provider-down` — neutro, "espere" —, e as duas saídas de um clique seguem na
  tela: trocar a fonte dentro do campo de busca (por consulta, viaja na URL) ou
  trocar o padrão em Settings.

  **A volta não consegue o que a ida conseguia**, e isso é régua: um banco com
  `'mal'` pode ter chegado ali pela `0036` **ou** por um admin que escolheu de
  propósito no intervalo, e nenhuma coluna separa as duas histórias. **Guarda de
  migration não lê intenção** — quando a escolha automática e a deliberada
  terminam no mesmo valor, a reescrita seguinte não tem como poupar a deliberada

**O Client ID é EMBARCADO, e é decisão do dono contra a minha recomendação.** O
contrato deles proíbe compartilhar o Client ID em três frases, a mais forte sendo
*"must use the Client ID as your sole means of accessing the API"*. Registrado
aqui porque quem ler a semente vai encontrar a chave e precisa saber que ela está
lá sabendo do custo, não por descuido.

### O prazo de resposta é da DEFINIÇÃO — 02/09/2026

`providers.timeout_ms`, `0023_provider_timeout.sql`. **Quanto um provedor demora
é fato dele, não constante nossa** — é a mesma prateleira de `rate_limit` (o
teto é do provedor) e de `endpoints.accept` (o dialeto é do provedor).

Era `AbortSignal.timeout(10_000)` repetido em **cinco** lugares — busca,
detalhe, unidades, testar conexão e a imagem do cache de arte —, calibrado
contra o TMDB sem ninguém dizer contra o quê. O Kitsu o estourou no dia em que
entrou: a busca dele leva 6 a 12s medidos, então parte das buscas voltava como
`unreachable`, que é a **mesma** resposta de rede fora — provedor lento se lia
como provedor quebrado, e a tela oferecia "tente de novo" pra uma coisa que ia
demorar igual na segunda vez.

- **`NOT NULL` com `DEFAULT 10000`, e não nulável como `rate_limit`.** A
  diferença é onde o valor efetivo é legível: o padrão do limitador só se
  descobre lendo o código dele, e este número o admin vai procurar na linha do
  provedor no dia em que a definição for editável. Os 10s continuam sendo a
  calibragem do TMDB, que é o caso comum — os três primeiros ficam nele
- **Um prazo, não um por endpoint.** Quem estoura é a busca; detalhe e unidades
  ficam em ~0,5s. Granularidade por rota é vocabulário que nada hoje pede, e um
  provedor que precisa de 30s pra buscar não é prejudicado por poder gastar 30s
  num detalhe que responde rápido
- **A imagem do cache de arte usa o MESMO prazo**, mesmo saindo de outra CDN. O
  campo separado que se justificaria ali teria um valor só, calibrado por
  ninguém — que é exatamente o defeito que este ciclo veio tirar
- **Testar conexão usa o prazo da definição, e aqui isso é mais que coerência:**
  diagnosticar com prazo menor que o da busca diria "demorou demais" a um
  provedor que busca bem
- **O teste afirma a PROCEDÊNCIA, não o número.** Um teste contra 10s teria
  passado antes e depois; o que se prova é que a busca de um provedor que
  declara 50ms desiste em milissegundos

### A busca diz o que falhou, e falha nossa não se disfarça — 02/09/2026

Duas más atribuições, as duas no cliente genérico, e as duas faziam a busca
culpar quem não tinha culpa.

**`4xx` e `5xx` viraram motivos diferentes.** `provider-error` saiu do enum de
`GET /api/search` e deu lugar a **`provider-refused`** (o provedor recusando o
NOSSO pedido — há o que arrumar) e **`provider-down`** (ele falhando do lado
dele — há o que esperar). O endpoint de TESTE já fazia essa distinção, então a
busca era a metade que tinha ficado para trás: ela respondia "refused the
search" ao **504** que o Jikan passou a devolver em tudo.

> **Corrigido em 07/09/2026: o status era um PROXY.** A pergunta que a divisão
> faz — *há o que arrumar?* — continua certa; `4xx` versus `5xx` era só o jeito
> barato de respondê-la, e ele falha quando o provedor **não declara credencial
> nenhuma**. O AniList desativou a própria API e passou a devolver 403 em tudo,
> e a tela oferecia `Open providers` a um admin que ia conferir configuração
> correta. `refusalOf` (em `providers.client.ts`) manda `4xx` de provedor sem
> credencial pra `provider-down`; **com** credencial nada muda, porque ali a
> chave existe, foi enviada e foi recusada. O contrato não mudou — o enum já
> tinha os dois.

- **A distinção viaja como `reason`, não como status.** A tela tira **três**
  coisas dele — o título, o tom e o botão de Settings —, e um motivo só a
  obrigaria a reabrir o status para decidir as três. **Onde o servidor decide, a
  tela lê a decisão**
- **`provider-down` é `condition` no cliente, não `failure`**, e isso afia a
  régua da gravidade: o que separa os dois grupos é **se há o que arrumar**, não
  quem falhou. O provedor cair do lado dele é falha dele, e a resposta de quem lê
  é a mesma do `rate-limited` — esperar. `danger` fica onde alguém tem trabalho
- **`titles` NÃO foi dividido.** O enum de detalhe continua com `provider-error`,
  por escopo: a tela de detalhe não oferece o botão de configuração, então a
  distinção não muda nada lá ainda

**E o `catch` passou a embrulhar a REDE, e só ela.** Ele embrulhava o
`writeCache` junto, então falha nossa de banco saía como `unreachable` — o
provedor tinha respondido, e a tela dizia que ele não podia ser alcançado. Foi o
que custou tempo no ciclo do Kitsu, com a FK de `provider_cache`.

- **Estava em três lugares**, não um: busca, detalhe e unidades. `art.fetch.ts`
  já estava certo, porque só rede mora dentro do `try` dele
- **Em `providers.detail.ts` ele dava DUAS respostas ao mesmo corpo.** O
  `JSON.parse` também estava dentro: corpo malformado vindo do cache devolvia
  `provider-error`, e o mesmo corpo vindo da rede devolvia `unreachable`. O
  motivo dependia de por onde a resposta passou
- **Falha de banco SOBE e vira 500 com stack no log**, em vez de virar uma
  recusa 503 de mentira. Custo assumido: um lock transiente do SQLite derruba uma
  busca que funcionou
- **O teste afirma a PROCEDÊNCIA.** Ele chama `searchProvider` com uma definição
  que **não está na tabela** — a FK de verdade, não uma simulada — e exige que a
  promessa **rejeite**. Um teste que apontasse para o 503 teria passado antes e
  depois

### Vincular obra existente, e a obra escolhendo a fonte — 02/09/2026

`entries.links.routes.ts` / `.handlers.ts`, mais `0030_entry_primary_source.sql`.
`GET`, `POST` e `DELETE` em `/api/entries/{id}/links`, e `PUT
.../{provider}/primary`. É o que tira o único conserto que existia pra anexar
metadados a uma obra antiga — apagar e re-adicionar, que leva progresso e log.

**O provedor padrão do tipo SAIU da escolha da obra**, por decisão do dono. `sourceOf`
tem dois degraus: `entries.primary_provider`, depois o vínculo **mais antigo**.
Os três motivos estão no `sourceOf`; o que decide é a régua de 30/08 — qual
provedor responde a **busca** é infraestrutura do admin, de qual vínculo **esta
obra** fala é conteúdo do usuário.

**E o que sobrou ficou, com outro nome — 02/09/2026** (3.10). A pergunta do dono
era se o campo ainda se justificava com um consumidor só; a resposta é que **sem
ele o desempate é o alfabeto, e alfabeto muda sozinho** — um provedor novo de
slug anterior trocaria a fonte de busca de um tipo sem ninguém pedir. O par de
nomes é o mesmo dos vínculos: **`default_provider_slug` é a escolha crua**
(coluna inalterada, sem migration) e **`effectiveProviderOf` → `effectiveProvider`
é o resolvido**. `canonicalProviderOf` e `canonicalProvider` não existem mais —
é mudança de contrato, então cliente e servidor sobem juntos.

**Sete invariantes:**

- **Criar NÃO promove.** O vínculo mais antigo continua falando, e é isso que
  faz a fonte efetiva mudar **só por ato explícito** — sinopse e arte não são
  reescritas sob a mão de ninguém. A troca silenciosa deixou de existir em vez
  de passar a ser avisada
- **O provedor precisa servir o TIPO da obra**, senão 400. Não é zelo: o id só é
  legível dentro do par, e `1396` é Breaking Bad em série e outro filme em
  filme. Um vínculo fora do par nasceria ilegível
- **Override órfão é IGNORADO, nunca fatal.** É o estado que sobra quando o
  vínculo sai por fora da rota (`db:seed`, acerto manual). Devolver nulo
  apagaria arte e sinopse de uma obra que tem vínculo
- **Desvincular limpa o override** quando ele apontava pra ali. `sourceOf` já o
  ignoraria, então isto não muda o que a tela vê agora — muda depois:
  revincular aquele provedor o promoveria sozinho, honrando uma escolha desfeita
- **`chosen` acompanha `effective` no contrato.** "Fala daqui porque foi o
  primeiro" e "fala daqui porque eu mandei" são estados diferentes, e o segundo
  é o que resiste a desvincular o vizinho
- **`primaryProvider` NÃO sai na forma pública da obra** (`entries.public.ts`).
  A forma útil já viaja em `/links`; a coluna crua seria uma segunda maneira de
  perguntar o mesmo, e sozinha responde errado — slug fora dos vínculos é
  ignorado por `sourceOf`
- **`?source=` no cache de arte**, porque o endereço resolvia sempre pelo
  efetivo e devolvia o pôster de outro provedor. Passa como se fosse o override,
  o que reusa a cadeia inteira em vez de escrever uma segunda escolha — e herda
  de graça o "vínculo que a obra não tem é ignorado"

### O resto, que ainda é intenção registrada

- **A chave é da INSTÂNCIA**, uma por instalação — **não** em `users`, e **não**
  em `settings`: ela mora junto do registro do provedor (ver abaixo), porque uma
  coluna por provedor não escala quando o usuário inventa o dele (3.10, decidido
  em 30/08/2026). Quem configura é o admin — e **provedor inteiro é do admin**,
  definição, credencial e opções (3.9). O rate limit é compartilhado por quem usa
  aquele servidor, o que promove limitador e cache de resposta a requisito
- **A chave está dentro do `.db`**, e o backup documentado é copiar esse arquivo
  (3.1). Quem publicar uma cópia do banco publica a chave junto — o README
  precisa dizer isso onde fala de backup
- **`external_ids` é tabela** (**tipo**, provedor, id externo, obra). A mesma obra
  existe em mais de um provedor, e provedor novo não pode virar migration de
  coluna. **O tipo entrou em 07/09/2026** (`0037`) porque o id de um provedor é
  único DENTRO do tipo — ver "A identidade externa carrega o TIPO", abaixo
- **A junção diz quem é OPÇÃO; o tipo diz quem responde a BUSCA — 01/09/2026,
  reduzido em 02/09** (3.10). `media_type_providers` continua N:N e responde
  "quais provedores servem este tipo"; `media_types.default_provider_slug`
  responde "qual deles responde a busca". **Nulo é legítimo** — é o estado de
  quase todos os tipos. A relação seguiu N:N contra a fonte única do
  Yamtrack porque fonte única não resolve **cobertura**, e manhwa e webnovel são
  onde isso morde primeiro
- **Uma busca = um tipo = UM provedor — 01/09/2026** (3.10), fechado desenhando
  `/search`. O padrão responde, e a tela diz quem respondeu e oferece trocar de
  fonte. **A concatenação sai do handler**: ela devolve a mesma obra duas vezes,
  com ids externos diferentes, numa lista sem ranking comum — indistinguível do
  certo enquanto todo tipo tiver um provedor só, e quebrada no primeiro que tiver
  dois. Mesclar caiu por resolver o problema errado: a relação é N:N porque
  manhwa e webnovel são onde nenhum catálogo cobre bem, e ali trocar de fonte é o
  gesto real. **`GET /api/search` ganha `provider` opcional**, com precedência
  `provider` explícito > padrão > o único associado — e, sem padrão com dois
  associados, o **primeiro por slug**, ordenado, senão a fonte trocaria sozinha
  entre duas consultas iguais. A regra é pura e testada
  (`search.provider-choice.ts`), e difere de `effectiveProviderOf` de propósito:
  lá a pergunta é "quem o admin ELEGEU?", aqui é "quem responde ESTA busca?",
  e a tela nomeia quem respondeu e oferece trocar. **Construído em 01/09/2026**,
  junto com `owned` (a duplicata anunciada antes do clique) e `sources`
- **Frase escrita aqui é COPY DE TELA, e chave nenhuma entra nela — 01/09/2026.**
  A recusa dizia `No provider is set up for "manga"`, com o slug onde ia o
  rótulo; é a quarta ocorrência do mesmo padrão neste repo. O servidor não
  resolve o nome sem saber o idioma de quem lê, então o slug **sai da frase** em
  vez de ser resolvido nos dois lados — quem nomeia o tipo é a tela. O nome do
  PROVEDOR continua entrando, e é por isso que `frase()` tem o mapa `nomes`
- **Duplicata se avisa, não se proíbe no schema — 01/09/2026** (3.10). O
  resultado de busca que o usuário já tem volta marcado, e a comparação é contra
  os `external_ids` das obras **daquele usuário**. O único de banco continua
  `(obra, provedor)`: um único em `(usuário, provedor, id externo)` exigiria
  `user_id` denormalizado aqui, e esta tabela é dona **por transitividade** de
  propósito. A guarda no handler é a rede pra duas abas clicando junto
- **Provedor é definição declarativa — 30/08/2026** (3.10). Registro de dados
  (URL base, estilo de auth, endpoints, mapa de campos) lido por **um cliente
  genérico**. O TMDB embutido é uma definição semeada, **não** um caminho
  especial em código: embutido com atalho faz o provedor do usuário virar
  cidadão de segunda
- **E cadastrar provedor vai ter TRÊS degraus, que convivem — 02/09/2026**
  (3.10). Declarativo (hoje), **definição de scraping** (seletor CSS no lugar de
  caminho JSON, o modelo Cardigann do Prowlarr — 547 sites sem executar código) e
  **plugin**, neste último caso **no mesmo processo e sem isolamento**. A costura
  é `providers.kind`, e tudo depois do provedor já é agnóstico de como a
  requisição aconteceu. **Não é mais verdade que "nada de código de terceiro"** —
  é verdade que ele fica **desligado por padrão**, só o admin instala, e a copy
  do consentimento diz que a biblioteca de **todos os usuários da instância**
  entra no alcance. Duas consequências pra este repo: o degrau 3 **anula o
  argumento que dispensava criptografia em repouso** (a credencial write-only na
  API deixa de ser fronteira quando há código no processo), e sandbox está
  recusado com motivo — `isolated-vm` não é N-API e recompilaria por ABI, WASM
  obrigaria o autor a escrever Rust
- **O produto embarca chave padrão** (3.10, revertido em 30/08/2026). Precedência
  **env > arquivo de secret (`*_FILE`) > literal embutido**, e o Settings avisa
  enquanto a instalação estiver na embutida. Se ela for suspensa, sai numa
  release e o produto degrada pra "configure a sua". **v1 é só TMDB**, que é o
  caso sem cláusula explícita nos termos. **A decisão sobre o IGDB fechou em
  02/09/2026: NÃO embarcar** — o texto da Twitch é literal contra, e o teto é por
  `client_id`, então uma chave nossa seria 4 req/s divididas por todas as
  instalações. Ele é o primeiro provedor que nasce exigindo Settings
- **A definição declara duas listas: credenciais e opções.** Credencial é
  write-only e só admin escreve; opção (`nsfw`, `language`) tem valor legível.
  As duas geram formulário sozinhas, e é isso que impede opção nova de virar
  migration. **`nsfw` é da instância** (30/08/2026), porque configuração de
  provedor é inteira do admin — e por isso ele **não** entra na chave do cache de
  resposta. Se algum dia virar por usuário, entra: senão a busca sem filtro de um
  é servida a outro
- **Token de conta de USUÁRIO é outra coisa, e a política fechou em 07/09/2026**
  (3.10). Perfil privado no AniList e no MAL exige OAuth, e o que volta é
  credencial **da pessoa**, não da instância. **Authorization Code, e o token é
  GUARDADO** — import agendado roda sem ninguém presente, então token descartado
  não serviria; e Implicit Grant *com* armazenamento junta o risco dos dois
  fluxos sem o benefício de nenhum. **Guardado em CLARO**: as três portas da
  tabela de 30/08 continuam fechadas (a terceira com mais força — job agendado
  roda sozinho), e Fernet derivado do segredo de sessão é o teatro que aquela
  tabela nomeia, porque o segredo mora no mesmo `.db`. O que paga a conta é
  **revogação a um clique** (desconectar APAGA a linha) e o **aviso de backup
  mudando de texto**: o `.db` deixa de conter só as chaves do admin. Dos três
  argumentos de 30/08, "só admin escreve" é o que CAI. **App OAuth não se
  embarca** — o `redirect_uri` fica na aplicação e cada instalação tem um
  endereço; Client ID de leitura pública viaja, par OAuth não
- **Credencial mora junto do registro do provedor**, e a definição declara quais
  ela precisa — o formulário do Settings é gerado a partir dessa declaração.
  **Sem criptografia em repouso, e é decisão registrada** (3.10 tem a tabela com
  os três lugares onde a chave de criptografia poderia morar e por que nenhum
  serve num self-hosted): o que protege é a credencial ser **write-only na API**
  — o `GET` devolve `configured: true`, nunca o segredo —, só admin escrever, e
  o README avisar que a chave está dentro do `.db`. Validar no salvamento, não
  na primeira busca; e env override tem que aparecer na tela e desabilitar o
  campo, senão o usuário edita e nada acontece
- **Duas migrations que este ciclo traz:** `external_ids.provider` deixa de ser
  enum e vira FK pra `providers`; `entries.media_type` deixa de ser enum e vira
  FK pra `media_types`. A ligação tipo↔provedor é **tabela de junção** — o TMDB
  serve filme e série, um anime pode querer AniList e TMDB. **A associação é
  opcional**: tipo sem provedor é legítimo, e quem busca nele recebe erro
  explicativo, nunca lista vazia
- **Limitador por provedor + cache de resposta com validade — requisito, não
  otimização.** Importar coleção grande sem isso é a forma mais rápida de tomar
  bloqueio, e a chave única por instância piora a conta: quem importa gasta o
  orçamento de todo mundo que usa aquele servidor
- **Arte EMPRESTADA vs. ADQUIRIDA — 01/09/2026** (brief, 3.10). Resultado de
  busca é **hotlink** e arte de obra vai pro cache: a exigência de offline segue
  o **objeto**, não a tela. As três razões do cache (offline/LAN, não vazar a
  biblioteca, não depender da CDN) são todas sobre a obra que a pessoa TEM;
  nenhuma vale pra um resultado que vive segundos numa tela que já depende do
  provedor pra existir. O que decide é se o objeto sobrevive ao fechamento da
  tela — e cachear busca gastaria disco com obra que ninguém adicionou
- **Capa de pilha NÃO entra nesse cache — ela vai como BLOB no banco** (brief,
  3.17, 29/08/2026). A regra é **regenerável vai pro disco com teto,
  insubstituível vai pro banco**: arte de obra o provedor devolve, capa que o
  usuário subiu não. Quem faz backup copiando o `.db` — que é o público inteiro,
  pela promessa da 3.1 — perderia as capas em silêncio se elas estivessem no
  volume. Isso não abre precedente pro contrário: cache no banco é o que faz um
  SQLite de 200MB virar um de 8GB
- **`piles` ganha `description` nulável** (brief, 3.17). E **não** ganha marca de
  pile de sistema: a direção foi revertida em 29/08/2026 — toda pilha é do
  usuário e apagável, sem exceção no handler de delete
- **`field_map` e `endpoints.query` são DUAS contas da mesma coisa, e a segunda é
  MUDA — 09/09/2026** (brief, 3.10). O primeiro diz o que LER da resposta, o
  segundo diz o que PEDIR. Quando o primeiro cresce sem o segundo, **o defeito não
  tem como aparecer**: caminho ausente devolve nulo, e nulo é estado legítimo em
  quase todo campo do mapa. No MyAnimeList isso escondeu **três** coisas por
  meses — a busca não pedia total em tipo nenhum (o que tornava **inerte** o
  conserto do mesmo dia que fazia o total chegar até a tela), o detalhe de mangá
  não pedia `num_chapters`, e não pedia `related_manga`, então **mangá nenhum
  jamais mostrou um vínculo**: a seção existia e nunca teve o que renderizar.
  **`query` é do PROVEDOR** e o conteúdo dele era anime-only, enquanto um
  comentário na semente afirmava que *"os dois pares trazem o seu `fields`"* —
  **esse mecanismo não existe**: o par sobrescreve `path` e `body`, nunca `query`.
  A saída é a **união no provedor** (`0047`, decisão do dono), medida: o MAL
  ignora em silêncio o campo que não se aplica ao tipo. Coluna de query no par
  seria a **quinta** propriedade a fazer o caminho *o que pertence ao par se
  declara*, e é o certo no dia em que um segundo provedor precisar — hoje só o MAL
  usa `fields` com mais de um tipo. **Comentário que descreve um mecanismo
  INEXISTENTE é pior que comentário desatualizado:** o desatualizado contradiz o
  código e alguém tropeça; este afirmava que o problema já estava resolvido, então
  ninguém foi conferir
- **O import do MAL passou a trazer o TOTAL, e o argumento que o descartava tinha
  ENVELHECIDO — 09/09/2026** (brief, 3.12). O leitor escrevia `total: null` com um
  comentário dizendo que pedi-lo custaria `fields` em toda página *"para um dado
  que a tela de detalhe busca quando precisa"* — mas **a tela de detalhe não é
  mais o único lugar que mostra o total**, e o `12 / ?` da 3.11 é o estado de *não
  se sabe*, **não de *não pedimos***. O custo estava superestimado: `fields` é
  query string, não uma requisição a mais. `fields=list_status,num_episodes` em
  anime e `,num_chapters` em mangá, com **zero lido como DESCONHECIDO** — medido:
  *One Piece* em exibição devolve `0` e *Monster*, terminado, devolve 162. O
  `paging.next` devolve o `fields` inteiro de volta, então a segunda página não
  perde o campo. **A metade retroativa não precisou de código:** `overwriteState`
  já escreve `total`, então re-importar com `Overwrite` conserta a biblioteca que
  nasceu sem denominador
- **Um relato pode ser a ponta de um defeito estrutural — 09/09/2026.** O relatado
  era `Year unknown` em toda carta de recomendação do MAL, e escrever `year` no
  mapa o teria fechado deixando os três acima de pé. **O que separa os dois é
  MEDIR em vez de consertar o sintoma**, que é a régua daquele provedor desde
  07/09: a referência oficial dele não traz uma amostra de resposta sequer, e a
  sub-seleção (`recommendations{node{start_date}}`) só se sabe que funciona
  batendo nela
- **v1 tem só TMDB** (filmes e séries). Os outros entram um por vez (3.12)

## O banco em WAL, e import em lotes

`better-sqlite3` é síncrono: cada query bloqueia o event loop. Irrelevante no uso
normal de um homelab; **não** irrelevante ao importar milhares de itens, que congela o
servidor inteiro.

Ligue WAL, e qualquer operação em lote — import, backfill de metadado, limpeza de
cache — roda em pedaços, cedendo o loop entre eles.

## Contrato HTTP: quebrar aqui quebra instalações

Servidor e cliente são repositórios independentes, atualizados por gente que não necessariamente atualiza os dois juntos. Mudança incompatível numa resposta ou num path **exige** footer `BREAKING CHANGE:` no commit, com instrução de migração.

Vale a mesma cautela do ponto de vista de terceiros: o modelo "servidor conhecido, clientes quaisquer" (Suwayomi) é decisão de arquitetura do brief (3.7). A API é interface pública, não detalhe interno.

**`GET /api/entries` não pagina, e isso é escopo assumido** (brief, 3.12): a rota
devolve a biblioteca inteira numa resposta só. `?q=` (busca por título) e `?sort=`
existem desde 29/08/2026; paginação não. Quando ela entrar, o array vira envelope com
total — ou seja, é exatamente o tipo de mudança que o parágrafo acima descreve, e por
isso a decisão é de uma vez, junto com `/piles`, e não rota a rota.

**O import está CONSTRUÍDO, com as TRÊS fontes escritas — 07/09/2026**
(brief, 3.12), em `src/features/import/`. Ele deixou de ser "v2" e virou o ciclo
aberto em 06/09.

| Peça | Onde |
| --- | --- |
| `import_jobs` | `db/schema/import-jobs.ts` + `0035_import_jobs.sql` |
| O executor em lotes | `import.runner.ts` |
| O aplicador (a conciliação) | `import.apply.ts` |
| A fonte CSV, e o parser RFC 4180 | `import.csv.ts` |
| A fonte MyAnimeList, MEDIDA contra a API real | `import.mal.ts` |
| A fonte AniList, escrita SEM medir (ver abaixo) | `import.anilist.ts` |
| `GET /status`, `POST /csv`, `POST /mal`, `POST /anilist`, `POST /{id}/cancel` | `import.routes.ts` |
| O vocabulário (`kind`, nunca frase) | `import.types.ts` |

**As TRÊS fontes estão ligadas desde 07/09/2026** — o AniList foi o último, por
decisão do dono, e ele estava desligado por uma **constante**, não por uma
checagem: `available: false, reason: 'unverified'` era cautela de quem escreveu a
fonte sem poder medi-la, e nada ali reagia à API deles voltar. O primeiro import
real passa a ser a medição, e **o modo de falha a vigiar é o zero calado** — se a
leitura do envelope estiver errada, o job termina com "0 adicionadas" em vez de
erro. `unverified` fica no contrato **sem emissor**, e volta no dia em que um
import real provar que a leitura está errada.

**As duas fontes de rede nasceram com procedências DIFERENTES, e a diferença
está escrita no topo de cada arquivo.** O MyAnimeList foi **medido** contra a API
real com um Client ID de verdade — 426 obras de um perfil, 366 anime e 60 mangá,
os quatro caminhos de falha conferidos —, e a doc oficial não traz uma amostra de
resposta sequer, então medir era a única forma de conhecer o envelope. O AniList
**não foi medido**: eles desativaram a própria API em 07/09/2026 — 403 em toda
forma de consulta, com o site no ar, o que também derruba a busca de `anime` e
`manga` no app —, e a fonte foi escrita a partir da documentação deles mais o
`anilist.py` do Yamtrack. A forma da consulta é confiável (GraphQL é validado por
inteiro pelo servidor deles); o que pode estar errado é a LEITURA do envelope, e
verificar é um passo só no dia em que a API voltar. Por isso ela chega à tela
como `unverified`, e não escondida.

O que o servidor construiu, com a régua de cada peça na fonte:

- **Três fontes:** `anilist` e `mal` por **nome de usuário** (perfil público —
  sem OAuth e sem credencial por usuário), `csv` por **arquivo**. O parser é o
  que muda entre elas; ler, conciliar e aplicar é o mesmo caminho
- **A conciliação é a chave `(tipo, provedor, id externo)`**, e `external_ids`
  **não** a tinha — esta linha dizia que sim, e era falso até `0037` (07/09/2026,
  ver abaixo). Id que bate casa; **id que não bate NÃO descarta a obra** — ela
  entra com o vínculo que veio e fica com um em vez de dois. Sem casamento por
  título (3.10 já o recusou por nome)
- **`Skip` ou `Overwrite`, escolhido por quem importa.** `Overwrite` substitui
  **status, progresso e o vínculo da fonte**, e nunca apaga a linha de `entries`:
  pilhas, nota, notas, `event_log` e os outros vínculos não vêm no import e não
  podem sair por causa dele
- **Job em segundo plano, em lotes, um por vez.** O `better-sqlite3` é síncrono
  (ver riscos, acima), então o laço precisa ceder o event loop entre lotes. O fim
  emite **notificação de audiência `user`** — o primeiro emissor de usuário que o
  app tem, e o degrau neutro do contador existe desde 06/09 sem uso
- **Escreve obra, status e progresso atual**, com um evento por obra em
  `event_log` de origem `import` e `occurred_at` retroativo. Nota, datas e
  rewatch ficam de fora
- **Id de MAL se pendura no `jikan`.** Se o import de MAL entra, o Jikan não pode
  ser removido da semente, mesmo com a API dele em 504 — sem ele o id não tem FK
  onde morar. **Decidido em 07/09/2026:** o MAL entra pela API oficial, com
  chave EMBARCADA (decisão do dono, contra a minha recomendação — o contrato
  deles proíbe compartilhar o Client ID em três frases, e a mais forte é
  *"must use the Client ID as your sole means of accessing the API"*), e um
  provedor `mal` novo é semeado servindo import **e** busca de `anime` e `manga`

**Quatro invariantes que a implementação fixou, e que não se descobrem lendo o
brief:**

- **`unmatched` é declaração da FONTE, não conta do aplicador.** É "a fonte tinha
  como trazer mais identidade e não trouxe" — no AniList, `idMal` nulo; no CSV,
  linha sem id. Um cálculo genérico ("menos de dois vínculos") chamaria de
  incompleto todo CSV bem preenchido. Ele é **recorte de `added`**, então os
  quatro contadores não somam `processed`
- **A conciliação casa por QUALQUER um dos ids que vieram.** Uma obra adicionada
  pela busca do AniList tem o id dele; a mesma obra vindo de um import de MAL traz
  o `idMal`. Casar por um id só faria a segunda entrar duplicada
- **"Uma importação por vez" é da INSTALAÇÃO e mora num índice único parcial.**
  O limite é do recurso, não da pessoa. E ele exige quem o limpe: uma linha
  `running` cujo processo morreu é reconciliada **na leitura**, contra o conjunto
  de jobs que este processo está de fato executando — constraint sem faxina é
  cadeado, não garantia
- **O executor cede o event loop entre lotes, e `applyAll` é `async` por isso.**
  Uma função síncrona não tem como ceder: enfileirar a cessão num encadeamento de
  promessas faz o laço rodar até o fim e só então descarregar. Quatro testes caem
  quando isso é desfeito, o do `Stop` entre eles — porque com o laço bloqueando o
  pedido de cancelar nunca chega a ser escrito

### A cláusula 5 do AniList, e a decisão de MANTER — 08/09/2026

Lida do fonte da doc deles (`docs/guide/terms-of-use.md`; `anilist.co/terms` e
`docs.anilist.co` respondem 403, o mesmo bloqueio da API):

> Use of the AniList API within competing, non-complementary services of the same
> nature is prohibited. This includes, but is not limited to, anime and manga
> list or tracker services. The restriction applies to all data provided through
> the API, including both user data and media data.

**É cláusula de USO, não de segredo** — as outras da tabela do brief falam de
guardar credencial, esta fala de quem pode consumir. Watchpile é literalmente o
que ela nomeia, e a última frase alcança o **provedor** (`0025`, e ele é o padrão
de `anime`/`manga` pela `0039`) **e** a fonte de import (`import.anilist.ts`) de
uma vez, porque cobre `media data` e `user data`.

**Decisão do dono: MANTER os dois**, com o motivo de que o Yamtrack também
consome a API deles — o que confere, já que a nossa fonte saiu do `anilist.py`
dele. **A recomendação registrada era a contrária**, e o que ela pesava é o
ALCANCE: enquanto o produto roda só na máquina do dono, a definição é uma linha
num banco local; publicada a imagem, ela roda na instalação de terceiros. Ver o
brief 3.10 para o texto inteiro.

**A marca deles nunca esteve em questão** — os termos da API não dizem nada sobre
logo, ícone ou trademark, ao contrário do MyAnimeList. Só o NOME do aplicativo é
regulado, e nada ali nos alcança.

### O EXPORT fecha o laço, e as duas destrutivas — 07/09/2026

`src/features/export/`, `DELETE /api/entries` e `src/features/storage/`
(brief, 3.12). O servidor passou a emitir o que ele mesmo aceita.

| Peça | Onde | Audiência |
| --- | --- | --- |
| `GET /api/export/entries.csv` | `src/features/export/` | Usuário |
| `DELETE /api/entries` | `entries.handlers.ts`, `removeAll` | Usuário |
| `GET /api/storage`, `DELETE .../provider-cache`, `DELETE .../art-cache` | `src/features/storage/` | **Admin, caminho inteiro** |

**Seis invariantes:**

- **O teste que importa é um CICLO.** Exportar, importar de volta num acervo
  vazio, comparar. Um teste que só olhasse a string emitida congelaria a nossa
  opinião sobre o formato — e ela pode estar errada dos dois lados ao mesmo tempo,
  que é exatamente o que o ciclo não deixa acontecer
- **Feature própria, espelhando `/api/import`.** O recurso é um ARQUIVO — formato,
  cabeçalho de download, contrato com o importador —, e nada disso pertence ao
  CRUD da entidade
- **Sem paginação e sem streaming**, e é decisão de tamanho: uma obra é ~80 bytes,
  e a maior biblioteca real que este projeto viu tem 426. Caminho de fundo é o que
  a 3.1 recusa, pelo mesmo motivo do cache de arte não ter job
- **Sem filtro de tipo escondido.** A preferência recorta o que é OFERECIDO, nunca
  o que existe — um export que sonegasse obras de um tipo escondido produziria
  backup incompleto **sem dizer**, que é a pior forma de errar num arquivo que
  existe pra não perder nada
- **Apagar leva mais do que o nome diz, e por cascade:** `event_log`,
  `external_ids`, `pile_entries` e `widget_entry_order`. **As pilhas ficam,
  vazias.** Um `DELETE` só, e o resto é o schema — escrever as quatro limpezas à
  mão seria a segunda declaração que fica pra trás na quinta tabela
- **Uma tranca que o próprio chamador abre não é tranca.** Nada de `?confirm=` nem
  contagem esperada no corpo: o único cliente que existe passaria os dois
  automaticamente. **A confirmação mora na TELA**, com a contagem à vista. E é
  **200 e não 204**, porque o número apagado é a resposta que a tela mostra —
  contar antes correria com a escrita

**A guarda de `storage` cobre a feature INTEIRA**, e não por método como em
`media-types`: lá a leitura fica aberta porque a lista de tipos alimenta os chips
de `/library` e o selo da carta. Aqui não há consumidor além da seção — quanto o
cache ocupa é fato sobre a MÁQUINA de quem hospeda.

**São DOIS caches e uma terceira coisa que NÃO se apaga.** `provider_cache` guarda
as RESPOSTAS (TTL de 6h) e `art_cache` os ARQUIVOS (teto e LRU); `title_snapshots`
fica, porque ele existe pra tela sobreviver ao provedor cair. As duas formas de
uso viraram **dois schemas** no contrato, e não um com campos opcionais: um conta
respostas e se limita por validade, o outro conta arquivos e se limita por
tamanho.

### A identidade externa carrega o TIPO — 07/09/2026

`external_ids.media_type`, FK pra `media_types` (`0037`). O id de um provedor é
único **dentro** do tipo, não entre tipos: no MyAnimeList `21` é o anime *One
Piece* e o mangá *Death Note*; no TMDB `1396` é *Breaking Bad* em série e outro
filme em filme. A tabela tratava `(provedor, id externo)` como identidade
completa, e não é.

**Medido:** um import de 426 obras entregou 422 — Death Note, Beck, Hajime no
Ippo e 666 Satan, todos mangá, lidos como "já está na sua biblioteca" porque um
anime tinha o mesmo número, e contados como **pulados** no resultado.

- **O `unique(obra, provedor)` continua.** Um vínculo por provedor por obra segue
  certo; o que mudou é a leitura, não a restrição
- **Coluna e não `JOIN` com `entries`.** O valor é derivável e o join consertaria
  a conciliação — mas não conserta `art_cache`, chaveado por (provedor, id
  externo) **sem referência a obra**, de propósito. Lá não há de onde derivar, e é
  isso que prova que o tipo pertence à identidade
- **`art_cache` tinha a MESMA colisão, fechada horas depois pela `0038`.** Esta
  linha dizia "ciclo próprio, latente"; as duas metades caíram no mesmo dia. O
  aquecimento do import o tornou alcançável (ele percorre anime e mangá do mesmo
  provedor no mesmo gesto), e a resposta pra linha órfã é a natureza da tabela:
  **cache se joga fora**. Ver "O cache de arte é chaveado por TIPO", abaixo

> **A régua não era nova, e é esse o ponto.** "O id é único dentro do tipo" fez
> `detail_path` ser propriedade do PAR em 01/09 e está escrita no vínculo entre
> obras. Faltou levá-la às outras tabelas com a mesma forma de chave — e nunca
> doeu porque obra entrava uma de cada vez pela busca, **que já sabe o tipo**. O
> import é a primeira coisa que insere anime e mangá do mesmo provedor no mesmo
> gesto.

### A arte ESPERA pela ficha, e o cache de arte é chaveado por TIPO — 07/09/2026

Três peças do mesmo conserto, e o que o abriu foi uma biblioteca recém importada
abrindo com um terço das cartas em branco.

**O limitador ganhou espera** (`reserveToken` / `awaitToken`). Ele recusava e
nunca esperava, e o comentário dele explicava por quê — do outro lado há uma
caixa de busca que dispara de novo na próxima tecla. **Esse argumento é da
busca**, e valia pra todo mundo; do outro lado da arte há um `<img>`, que não
tenta de novo e não lê corpo de erro.

- **A ficha se RESERVA.** Vinte pedidos que dormem o mesmo tanto acordam juntos e
  brigam pela mesma ficha. Debitar na hora — as fichas vão a negativo, porque são
  do futuro — é o que ordena a fila pela chegada
- **O orçamento de espera é NOSSO** (5s em `art.fetch.ts`), ao contrário do prazo
  e do teto, que são do provedor: ele mede quanto aceitamos segurar uma conexão
  nossa esperando cota
- **Quem desiste não gasta ficha**, senão o pedido seguinte paga a fila de quem saiu
- **`takeToken` continua existindo** e é `reserveToken` com orçamento zero — uma
  conta só, porque duas contas da mesma coisa é como uma fica pra trás

**`art_cache` ganhou `media_type`** (`0038`), pelo mesmo motivo de `external_ids`
na `0037`: o id de um provedor é único DENTRO do tipo. O que o tirou de latente
foi o aquecimento, que percorre anime e mangá do mesmo provedor no mesmo gesto.

- **O tipo entra no NOME DO ARQUIVO e no `ETag`, não só no índice.** O nome é o
  hash da chave; duas chaves com o mesmo nome se sobrescrevem no disco. E sem o
  `ETag`, o navegador serviria do cache dele a arte de um pro outro — o conserto
  pararia no banco
- **Linha que o backfill não classifica se JOGA FORA**, e é a natureza da tabela
  que autoriza: cache. Caem as sem vínculo e as com vínculos de mais de um tipo
  pro mesmo (provedor, id), que são a colisão em si
- **`hasArt` existe e não é `readArt`**: ler CARIMBA `last_used_at`, e o
  aquecimento não é leitura de ninguém — carimbar ali diria que a instalação
  inteira acabou de ser visitada, empurrando pra fora do cache exatamente a arte
  que alguém vinha vendo

**E o cache se AQUECE sozinho pra quem ganha vínculo** (`art.warm.ts`), em três
chamadores: o import (depois de fechar o job), a obra criada com fonte
(`entries.handlers.ts`) e a obra que ganha vínculo depois
(`entries.links.handlers.ts`). Nasceu no import e saiu de lá no mesmo dia, porque
o buraco que ele fecha não é volume — é o intervalo entre **ter** a obra e
**olhar** pra ela, e nele quem abre o app sem internet vê ladrilho de obra salva
faz semanas.

- **Nada espera por ele.** `warmArtInBackground` dispara e não é aguardado; o
  `201` de criar sai antes de a arte existir, e os dois pontos novos têm teste
  afirmando esse par. O `catch` é obrigatório — sem dono, uma rejeição vira
  `unhandledRejection` e mata o processo por causa de um pôster
- **No import ele roda DEPOIS do job**, senão o contador ficaria parado em
  `426 / 426`, a notificação mentiria e uma CDN fora do ar reprovaria um import
  que deu certo
- **Falha não vira nova tentativa**, e a rede de segurança é o caminho sob
  demanda, que roda quando alguém finalmente olhar a carta
- **Fica de fora quem não tem de onde tirar:** obra sem vínculo com provedor
  segue no ladrilho, com ou sem rede

**A promessa mudou junto:** era *"a arte que você já viu abre offline"*, virou
*"a arte da sua biblioteca abre offline"*. Frase que descreve um mecanismo que
mudou não é conservadora — é falsa do outro lado.

## O container é interface com o usuário

Brief, 5.1. Para o público de homelab, o `Dockerfile` e o `compose.yaml` são a primeira
tela do produto. O que não pode faltar:

- **Não rodar como root**, com `PUID`/`PGID`. Sem isso o `.db` e o cache de arte nascem
  de `root` no volume, e o dono da máquina não consegue nem fazer backup
- **Migration roda no start do container.** Atualizar é `docker compose pull && up -d`,
  e nada além disso. Passo manual de migration é passo que alguém pula
- **`HEALTHCHECK`**, senão container travado aparece saudável no Dockge e no Portainer
- **Um volume só**, `/data`, com o banco e o cache de arte dentro. O cache precisa
  persistir junto, senão reconstrói a cada recriação do container
- **`TZ` respeitado** — "assisti hoje" e o log dependem disso
- **Imagem amd64 + arm64.** Boa parte desse público roda em Raspberry Pi
- **Log em stdout**, tag `:x.y.z` além de `:latest`

**Backup é comando documentado, não `cp`.** Com WAL ligado, copiar o arquivo com o
servidor rodando pode render banco corrompido ou sem as transações do WAL. O caminho é
`VACUUM INTO` ou a API de backup do SQLite — e isso vai no README, porque é a diferença
entre o usuário ter e não ter backup.

## Electron

`electron/main.ts` é o único arquivo que importa `electron`. Adiantado em relação
à ordem da seção 8 do brief (que colocava isso por último, "só depois do core
maduro") — decisão explícita do dono do projeto, ciente do risco de retrabalho
enquanto client e schema ainda mudam toda semana.

```ts
app.whenReady().then(async () => {
  process.env.WATCHPILE_DB_PATH ??= join(app.getPath('userData'), 'watchpile.db')
  process.env.PORT ??= '0'
  process.env.WATCHPILE_CLIENT_DIST_PATH ??= /* client-dist embutido, ou o repo irmão em dev */

  const { startServer } = await import('../src/index.js')
  const port = await startServer()
  createWindow(port)
})
```

`startServer()` continua sem saber que está rodando dentro do Electron — só
recebe env var diferente antes de subir, mesma regra de sempre (`WATCHPILE_DB_PATH`
vira `app.getPath('userData')`, `PORT=0` deixa o SO escolher, e
`WATCHPILE_SERVE_CLIENT` nem precisa ser setado porque o default já é `true`).

**Rodar em dev:** `bun run electron:dev` — usa `tsx/esm` via `NODE_OPTIONS`
para o Electron carregar `electron/main.ts` direto, sem precisar compilar
antes (a mesma resolução de módulo do `bun run dev`, então
`../src/index.js` resolve pro `src/index.ts` normalmente). Fora de
`app.isPackaged`, `WATCHPILE_CLIENT_DIST_PATH` aponta pro `../../client/dist`
do repo irmão.

**Módulo nativo: o `better-sqlite3` NÃO precisa mais ser recompilado, e isso
foi medido em 02/09/2026.** Ele é **N-API** desde a v9 (`node-addon-api`,
`NAPI_VERSION=10` no `binding.gyp`), e a N-API é **ABI-estável através de
versões de Node e de Electron** — ao contrário da API do V8, que é o que
obrigava a recompilar. Medido: o mesmo `prebuilds/darwin-arm64.node` carrega e
consulta no Node 22 local (`modules=127`) **e** no Electron 44 (`modules=149`,
Node 24), sem rebuild nenhum.

Por isso `electron-builder.config.mjs` tem **`npmRebuild: false`**. Com o padrão
(ligado), todo empacotamento recompila do fonte em cada runner da matriz, o que
exige `node-gyp`, Python e um compilador C++ nos três SOs — e é essa a
superfície que este arquivo chamava de "o ponto que mais quebra em CI".
Conferido no pacote de verdade: `build/Release/` não existe dentro do `.app`, os
oito prebuilds viajam junto (`darwin`, `linux`, `linuxmusl`, `win32` ×
`arm64`/`x64`) e o `node-gyp-build` escolhe o certo em tempo de execução.

O script `electron:rebuild` **fica**, como rede de segurança para o dia em que
uma dependência nativa **não** for N-API. A distinção é a que importa ao
escolher módulo nativo novo: N-API viaja, API do V8 recompila. O `isolated-vm`,
por exemplo, mexe em isolates e por isso **não** é N-API — o que o torna caro
aqui de um jeito que o `better-sqlite3` não é (mais).

**Em aberto, de propósito:** empacotamento de verdade com `electron-builder`
(ícone, `productName`, `appId`, alvo `.exe`/`.dmg`/`.AppImage` — brief, seção
5). O `electron-builder` já é devDependency, mas não configurado — isso é
decisão de quando a distribuição virar prioridade, não parte do wrapper em
si. Como o `client-dist` embutido chega no pacote final: decidido em "Plano
de distribuição", a seguir.

## Plano de distribuição

Decisão de 25/08/2026, registrada aqui porque é sobre **como este repositório
libera versões**, não sobre arquitetura do produto (isso já está no brief,
seção 5). `server/README.md` é a face pública disso — o que muda de "build
local" pra "baixe e rode" quando cada peça existir.

**Como o `client/dist` chega no artefato final, sem monorepo:** build
multi-repo no CI do server, não download em runtime. `.github/workflows/build.yml`
(25/08/2026) faz checkout dos dois repos lado a lado, builda o `watchpile-client`,
e embute o `dist/` resultante na imagem Docker (`server/client-dist/`, sempre
existe no repo via `.gitkeep`, populado antes do `docker build`) e no pacote
do `electron-builder` (`extraResources`, mesmo mecanismo de
`../client/dist` que o dev local já usa). Local, o mesmo fluxo tem nome:
`bun run electron:build` faz tudo — builda o client, compila o wrapper, copia
migrations, empacota — num comando só (`server/README.md`, "Desktop").

**CI valida sempre; publica release só a partir da `main`.** Decisão de
26/08/2026. O workflow builda a imagem Docker (sem `push` — isso continua só
validação) e empacota o Electron. **Só push na `main`** cria uma GitHub Release
de verdade, com os três instaladores anexados — `dev` recebe muito update pra
justificar uma release por push.

**O que roda antes da `main` foi enxugado em 29/08/2026, e por dois motivos
concretos.** Até então todo PR pra `dev` rodava a matriz inteira e subia ~384 MB
de instalador com 7 dias de retenção. Isso estourou duas contas do plano
gratuito: os 500 MB de armazenamento de Actions — e quando ele estoura, o job
**falha no upload**, deixando o CI vermelho por motivo nenhum, que foi
exatamente o que aconteceu — e os minutos, porque runner macOS conta 10x e
sozinho respondia por ~70% de cada run (~43 min faturáveis, contra ~2000/mês de
cota).

| | PR e `dev` | `main` |
| --- | --- | --- |
| Electron | só `ubuntu-latest` | matriz nos três SOs |
| Docker | só `linux/amd64`, sem QEMU | multi-arch, com QEMU |
| Artefato | nenhum | os instaladores, que viram release |

Mudança só em Markdown não dispara nada (`paths-ignore`).

O que se perde: quebra de empacotamento específica de macOS ou Windows passa a
aparecer só na promoção pra `main` — foi assim que o bug do `shell: bash` no
runner Windows apareceu, em 27/08. É o preço aceito, e a matriz completa
continua guardando a `main`, que é de onde sai release.

O empacotamento local (`bun run electron:build`) e o do CI escrevem em
`builds/<mac|windows|linux>/<preview|stable>/`, não mais `release/` —
`electron-builder.config.mjs` resolve plataforma (`process.platform`) e canal
(branch atual: `main` → `stable`, qualquer outra → `preview`, via
`GITHUB_REF_NAME` no runner ou `git rev-parse` localmente). Mesma pasta,
mesma lógica, os dois lados.

**A versão passou a significar alguma coisa em 08/09/2026: `0.1.0`, marcada
como pre-release** (decisão do dono). O run number **saiu da tag** — ele
existia enquanto o `package.json` estava em `0.0.0` e a tag precisava de algo
que a diferenciasse, e com a versão significando algo quem decide que há
release nova é ELA.

> **Uma release por VERSÃO, não por push**, e a consequência é assumida:
> repromover a `main` sem subir a versão **atualiza** os artefatos da release
> existente em vez de criar outra. Cortar release nova é subir o
> `package.json` — que é o gesto que declara que mudou o que o testador está
> rodando.

**`0.x` já é o contrato legível por máquina de "quebra sem aviso"**, e o
`prerelease: true` é o legível por humano; empilhar `-alpha.1` diria a mesma
coisa uma terceira vez. O que justifica os dois é que **não há teste de
upgrade de migration entre versões** — e é isso, não a quantidade de
features, que define o risco de quem já tem centenas de obras importadas.

`softprops/action-gh-release` cria a release; o job que publica
(`publish-release`) depende dos três legs da matriz `electron` terem
terminado, pra anexar os três instaladores numa release só, sem race entre
eles.

**Secret `CLIENT_REPO_TOKEN` configurado** (fine-grained PAT, só
`Contents: Read-only` em `watchpile-client`) nas Settings → Secrets and
variables → Actions → Repository secrets do repo `watchpile-server`, desde
25/08/2026 — era o bloqueio manual que impedia o checkout cross-repo no CI;
já resolvido.

**Primeira promoção de verdade, 27/08/2026.** Até então nem `watchpile-server`
nem `watchpile-client` tinham sido promovidos de `dev` pra `main` — a `main`
do client seguia parada no terceiro commit do projeto, bem antes do fix que
vendoriza `tokens.css` (client, PR #6). Promover o server sozinho expôs isso:
o checkout cross-repo do CI usa a mesma branch dos dois lados quando não há
PR (`github.base_ref || github.ref_name`), então o build do client quebrou
importando `../../../design/tokens.css` — caminho que só existe na máquina
de dev. Corrigido promovendo `watchpile-client` também (client, PR #8),
primeira vez que a `main` de lá existe de verdade — os dois repos agora
promovem `dev` → `main` juntos, não só o server.

O resto do pipeline só foi validado ao rodar contra `main` pela primeira
vez — PR e push em `dev` não exercitam o job `publish-release`, que só
dispara nessa branch. Quatro bugs apareceram, dois deles latentes desde a
introdução do workflow (PR #5, 25/08) e nunca notados porque ninguém tinha
chegado até `main`:

| Bug | Desde quando | Corrigido em |
| --- | --- | --- |
| `electron-builder` detecta `CI=true` e tenta publicar sozinho, trava sem `GH_TOKEN` | PR #5 (latente) | PR #8, `--publish never` |
| Step `resolve channel` em bash quebra no runner Windows (default é pwsh) | Este pipeline (PR #6) | PR #8, `shell: bash` explícito |
| Checkout do job `publish-release` sem `path: server` — `working-directory: server` apontava pro nada | Este pipeline (PR #6) | PR #10 |
| Glob `**/*.exe` subia binários de dentro de `win-unpacked/` (`Watchpile.exe`, `elevate.exe`) como asset de release | Este pipeline (PR #6) | PR #12, glob restrito a `*/*/*.ext` |

A primeira release publicada (`v0.0.0-20`) carregava esse último bug — apagada
manualmente (release + tag) depois do fix. `v0.0.0-24` foi a primeira release
limpa: um instalador por plataforma, sem sobra.

Descartada a alternativa do Suwayomi (`WEB_UI_CHANNEL`, download da UI numa
release separada em runtime): decoupla os ciclos de release de verdade, mas
troca um artefato autocontido por uma dependência de rede no primeiro boot —
contra o espírito de "container único, `docker compose up` e acabou" (brief,
3.1/5.1). Pode ser revisitado se o build multi-repo virar gargalo real de CI.

**Registro das imagens Docker: GHCR agora, Docker Hub quando deixar de ser
versão de teste** — decisão do dono, 08/09/2026, e ela **corrige o que esta
linha dizia** desde 25/08.

O argumento original continua de pé e é o que garante o destino final: o
Docker Hub é o que o público de homelab espera achar num README. O que mudou é
a FASE. O GHCR entra agora porque **não pede credencial nova** — o
`GITHUB_TOKEN` já existe no runner, e a imagem nasce ao lado do repositório que
a produz; publicar no Docker Hub exigiria um secret a mais para uma versão que
ainda vai quebrar sozinha.

Imagem: `ghcr.io/digit4w/watchpile`, com **duas tags** — `:x.y.z` é o que
se fixa num `compose.yaml` que não pode mudar sozinho, `:latest` é o que o
README manda copiar. Quem hospeda escolhe entre as duas, e a escolha é sobre
atualizar.

**Escopo atual: a `main` publica os DOIS — a Release com os instaladores e a
imagem no GHCR.** O caminho do Electron está testado de ponta a ponta desde
27/08/2026; o do GHCR entrou em 08/09 junto com o corte da `0.1.0`.

**Os repositórios deixam de ser privados nesse mesmo movimento** (decisão do
dono, 08/09/2026), e o motivo não é conveniência: o produto é **AGPL-3.0**, e
distribuir a imagem a quem não tem como obter o fonte é problema de licença,
não de comodidade. Pacote de GHCR nasce privado quando o repo é privado, então
as duas coisas andam juntas por construção — e a alternativa (pacote público
sobre repo privado) é tecnicamente possível e é justamente a que a AGPL não
deixa.

> **Uma consequência de mão única, registrada porque não tem volta:** abrir o
> repositório publica o histórico inteiro, e a chave embarcada do MyAnimeList
> (`providers.embedded.ts`) está nele desde 07/09/2026. Ela já era decisão do
> dono contra a recomendação registrada; o que muda com o repo público é o
> ALCANCE, não a decisão.

**O que faltava decidir FECHOU.** Em 26/08/2026: gatilho é push na `main` (não
tag), e a matriz de SOs do Electron é o runner de cada plataforma nativa, sem
cross-compile. Em 08/09/2026, com o corte da `0.1.0`: **começa em `0.x`**, os
repositórios **ficam públicos**, e o **Docker Hub espera** deixar de ser versão
de teste.

**Segue em aberto, e é o que a palavra "alpha" existe pra cobrir: não há teste
de upgrade de migration entre versões.** Uma instalação que pulou uma release
aplica as migrations em sequência e ninguém prova que a sequência funciona —
`drizzle` aplica em ordem e nada verifica o resultado. É a dívida mais cara que
sobra depois do corte.

**A ORDEM de promoção para a `main` inverte a regra de `dev`, e é mecânica:**
`build.yml` faz checkout do cliente com `ref: github.base_ref || github.ref_name`,
então um push na `main` do servidor compila contra a `main` do CLIENTE. Promover
o servidor primeiro construiria a release contra o cliente antigo — que é
literalmente o bug de 27/08 documentado acima. Em `dev` a ordem é servidor
antes de cliente porque o risco é tela chamando rota inexistente; aqui é
**cliente antes de servidor**, porque o risco é o build pegar o par errado.

## Licença

AGPL-3.0 (brief, seção 9). `LICENSE` no repositório desde o primeiro commit — licença
adicionada depois exige consentimento de todo mundo que já contribuiu.

Consequência no dia a dia: **dependência nova precisa de licença compatível**. Checar
antes de adicionar ao `package.json`, não depois.

## O README é bilíngue, e o INGLÊS é o canônico

10/09/2026, decisão do dono. `README.md` em inglês, `README.pt-BR.md` ao lado, e
cada um leva no topo uma linha apontando pro outro — **o GitHub não serve README
por idioma do navegador**, então o seletor não é enfeite: sem ele a tradução é
invisível.

- **Toda mudança futura nasce no INGLÊS**, e a tradução corre atrás. É a única
  ordem que se sustenta: `README.md` é o que o GitHub mostra e o que um estranho
  abre primeiro, então deixá-lo correr atrás faria justamente o arquivo mais
  visível ser o que envelhece. **Tradução desatualizada é pior que ausência**,
  porque afirma o que deixou de ser verdade
- **Isto NÃO vira a regra de idioma do projeto** (`../CLAUDE.md`), e a decisão de
  08/09/2026 continua inteira: código em inglês, **documentação e comentários em
  português**. O que ganha inglês é a **superfície pública**, e ela é pequena —
  os dois documentos-fonte vivem na raiz não versionada, então sobram o README e
  os `CLAUDE.md`. Os ~19.000 comentários **não** se traduzem: eles são o registro
  de raciocínio mais denso do projeto, e tradução mecânica destruiria o que os
  torna valiosos
- **O `client/` tem o seu**, curto e bilíngue pelo mesmo par de arquivos. Ele
  não repete instalação — quem instala Watchpile instala o servidor

## Lint, formato e testes

**Biome** é a única ferramenta de lint e formato — sem ESLint, sem Prettier, um
binário só. Config em `biome.json`: aspas simples, sem ponto e vírgula, vírgula
final sempre, 2 espaços, linha de 80 colunas. `bun run lint` / `bun run lint:fix`
/ `bun run format`.

**A rede NÃO existe na suíte.** `test/setup.ts` derruba o `fetch` global com um
dublê que lança; quem precisa de resposta de provedor injeta a sua
(`fetchImpl`) ou espiona `globalThis.fetch`. Isso nasceu de um achado de
07/09/2026: o aquecimento do cache de arte era disparado pelo executor do import
**sem injeção**, e os itens do teste dele carregam vínculo real — a suíte passou
verde batendo na API de um provedor de verdade, centenas de vezes, sem sinal
nenhum. Vigiar caso a caso não pega; derrubar a rede por padrão pega.

**Vitest** é o test runner. `<feature>.test.ts` (e2e, bate na app real) é
obrigatório em toda feature; `<feature>.use-cases.spec.ts` (unitário, contra
repository in-memory) só nasce junto com `<feature>.repository.ts` — ver
"Estrutura de uma feature" acima.

## Git hooks

**lefthook**, instalado automaticamente pelo script `prepare` do `package.json`
(`bun install` já cobre). Três hooks:

- `commit-msg` roda `scripts/validate-commit-msg.sh`, que valida contra
  `../.claude/commit-convention.md` — portado do projeto irmão Negocia
- `pre-commit` roda o Biome nos arquivos staged
- `pre-push` roda a suíte de testes

Pular numa emergência: `git commit --no-verify`.

## Convenções

- Colunas em `snake_case`; TypeScript em `camelCase`; a tradução fica isolada na camada do Drizzle
- Tabelas no plural (`piles`, `entries`), entidades no singular
- Datas em UTC, sempre
- Documentação em português; código, rotas e commits em inglês
- Commits: `../.claude/commit-convention.md`, via skill `commit-server`

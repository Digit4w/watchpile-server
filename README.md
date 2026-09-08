# Watchpile

| Build | License | Status |
| --- | --- | --- |
| [![CI](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml/badge.svg)](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml) | ![License](https://img.shields.io/badge/license-AGPL--3.0-blue) | ![Status](https://img.shields.io/badge/status-pre--release-orange) |

Tracker de mídia self-hosted — filmes, séries, anime, mangá, jogos e livros — no
espírito de Yamtrack, Trakt e Suwayomi. Um servidor, múltiplos clientes: este
repositório expõe uma API HTTP documentada (`openapi.json`) e, por padrão,
também serve o cliente web oficial.

> **Estado atual:** projeto em desenvolvimento inicial, sem release publicada.
> Este README documenta como o projeto **vai** ser distribuído e como rodá-lo
> **a partir do código-fonte** hoje. Quando existir imagem publicada no Docker
> Hub e instalador do desktop, as seções abaixo trocam de "build local" para
> "baixe e rode" — a estrutura já está pronta para isso, e a tabela acima
> ganha colunas de download real (Stable/Preview), como no Suwayomi.

## Formas de usar o Watchpile

Da mais simples para a mais manual — escolha pelo quanto de controle você
quer sobre o processo, não por "qual é melhor".

### Docker (recomendado para homelab)

Um container só, com a API e o cliente web juntos. `docker compose up` e
acabou — sem container de banco separado, o SQLite é um arquivo no volume.

```bash
git clone https://github.com/Digit4w/watchpile-server.git
cd watchpile-server
docker compose up --build
```

Só isso sobe a **API sem o cliente web** — `client-dist/` neste repositório é
um diretório vazio de propósito: server e client são repositórios separados,
sem monorepo. Pra ter o cliente embutido na imagem também, builde-o e o
coloque lá antes:

```bash
git clone https://github.com/Digit4w/watchpile-client.git ../watchpile-client
cd ../watchpile-client && bun install && bun run build && cd -
cp -r ../watchpile-client/dist/* client-dist/
docker compose up --build
```

**Quando existir imagem publicada no Docker Hub**, isso já vem pronto — é
exatamente o que o CI faz antes de publicar (`.github/workflows/build.yml`).
`docker compose up` sozinho, sem clonar o cliente, passa a ser suficiente.

O `compose.yaml` do repositório já traz um exemplo funcional. Variáveis mais
comuns de ajustar:

| Variável | Default | Efeito |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` / `1000` | dono dos arquivos criados em `/data` — combine com o seu usuário no host |
| `TZ` | UTC do container | fuso horário — afeta "assisti hoje" e os logs |
| `PORT` | `3210` | porta interna que a API escuta |
| `WATCHPILE_SERVE_CLIENT` | `true` | `false` desliga o cliente web, sobra só a API |

Volume único, `/data`, com o banco e (futuramente) o cache de arte dentro —
mapeie só ele. `HEALTHCHECK` embutido no `Dockerfile` para Dockge, Portainer e
Watchtower.

**Backup:** com o banco em modo WAL, **não copie o arquivo `.db` com o
container rodando** — o resultado pode vir corrompido ou sem as transações
mais recentes. Use `VACUUM INTO` pelo SQLite:

```bash
docker compose exec -u watchpile watchpile sqlite3 /data/watchpile.db "VACUUM INTO '/data/backup-$(date +%F).db'"
```

`-u watchpile` importa: sem ele, `docker compose exec` roda como root (o
entrypoint só troca de usuário pro processo principal do container), e o
backup nasce com o mesmo problema de dono que o `PUID`/`PGID` existe pra
evitar.

**Quando existir imagem publicada**, o `compose.yaml` troca `build: .` por
`image: fernandoenf/watchpile:x.y.z`, e não precisa mais clonar o
repositório — só baixar o `compose.yaml`.

### Desktop (Windows, macOS, Linux)

App Electron — mesma API, mesmo cliente web, empacotados como aplicativo
nativo. Sem terminal, sem Docker: primeiro admin é criado num wizard na
primeira abertura.

**Hoje**, duas formas de rodar a partir do código-fonte — os dois repositórios
precisam estar lado a lado (`watchpile-server/` e `watchpile-client/` na
mesma pasta pai):

```bash
git clone https://github.com/Digit4w/watchpile-server.git
git clone https://github.com/Digit4w/watchpile-client.git
cd watchpile-server && bun install
```

- **Modo dev**, janela recarrega ao mudar código do server: `bun run electron:dev`
- **Pacote de teste de verdade** (`.dmg`/`.exe`/`.AppImage`, o mesmo artefato
  que o CI produz): `bun run electron:build` — builda o client, empacota,
  deixa o instalador em `release/`. Sem assinatura de código: no macOS abra
  com botão direito → Abrir na primeira vez, em vez de duplo-clique

`bun run electron:build` builda só para o sistema operacional em que você o
roda — `better-sqlite3` é módulo nativo, não dá pra cross-compilar de forma
confiável. `.github/workflows/build.yml` cobre os três SOs via matriz do
GitHub Actions.

**Quando existir instalador publicado**, isso vira "baixe o `.exe`/`.dmg`/
`.AppImage` da página de Releases e instale como qualquer outro app" — sem
precisar clonar nada.

### Node direto (sem Docker, sem Electron)

Para quem já tem um processo supervisor (PM2, systemd) e prefere não rodar
Docker. É o mesmo binário dos outros dois modos — o que muda é só quem inicia
o processo.

```bash
git clone https://github.com/Digit4w/watchpile-server.git
cd watchpile-server
bun install
bun run build
WATCHPILE_DB_PATH=/var/lib/watchpile/watchpile.db \
WATCHPILE_CLIENT_DIST_PATH=/var/lib/watchpile/client-dist \
PORT=3210 \
node dist/index.js
```

Você precisa colocar o build do cliente (`client/dist`, gerado com
`bun run build` no repositório do client) no caminho apontado por
`WATCHPILE_CLIENT_DIST_PATH` — nada disso é feito automaticamente fora do
Docker e do Electron, que já embutem esse passo.

## Configuração

Toda variável de ambiente é **override, nunca requisito** — o servidor sobe
com zero configuração, e cada uma tem um default sensato. Nenhuma delas é
obrigatória.

| Variável | Default | O quê |
| --- | --- | --- |
| `PORT` | `3210` | porta HTTP. `0` deixa o sistema operacional escolher |
| `NODE_ENV` | `development` | `production` em qualquer imagem publicada |
| `LOG_LEVEL` | `info` | nível do log estruturado (pino) |
| `WATCHPILE_DB_PATH` | `./data/watchpile.db` | caminho do arquivo SQLite |
| `WATCHPILE_SERVE_CLIENT` | `true` | se o servidor também serve o build do cliente web |
| `WATCHPILE_CLIENT_DIST_PATH` | `./client-dist` | onde procurar o build do cliente, quando `WATCHPILE_SERVE_CLIENT=true` |
| `PUID` / `PGID` | `1000` / `1000` | (só Docker) usuário do processo dentro do container |

## API aberta a outros clientes

O contrato é gerado a partir do código, não escrito à mão: `openapi.json`
neste repositório é o que qualquer cliente — oficial ou de terceiros —
consome. Com o servidor rodando, a documentação interativa fica em
`/reference`.

Um cliente de terceiros que só conversa com essa API é obra separada: a
licença AGPL do servidor não o alcança (ver Licença).

## Licença

[AGPL-3.0](LICENSE). A cláusula que importa no dia a dia: quem modificar o
Watchpile e oferecer como serviço acessível pela rede precisa disponibilizar
o código modificado.

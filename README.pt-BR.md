# Watchpile

*[Read in English](README.md)*

| Build | License | Status |
| --- | --- | --- |
| [![CI](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml/badge.svg)](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml) | ![License](https://img.shields.io/badge/license-AGPL--3.0-blue) | ![Status](https://img.shields.io/badge/status-pre--release-orange) |

Tracker de mídia self-hosted — filmes, séries, anime, mangá, jogos e livros — no
espírito de Yamtrack, Trakt e Suwayomi. Um servidor, múltiplos clientes: este
repositório expõe uma API HTTP documentada (`openapi.json`) e, por padrão,
também serve o cliente web oficial.

> **Estado atual: `v0.2.0`, uma versão pública de teste.** Há imagem
> publicada e instaladores prontos — as seções abaixo abrem por eles, e o build
> a partir do código-fonte continua documentado logo em seguida.
>
> **"Alpha" aqui não é modéstia, e o motivo é específico: não existe teste de
> upgrade de migration entre versões.** Uma instalação que pule uma release
> aplica as migrations em sequência e ninguém prova que a sequência funciona.
> Quem tem centenas de obras importadas é quem mais sente se der errado —
> **faça backup do `.db` antes de atualizar** (ver [Backup](#backup)). O `0.x`
> do versionamento é o mesmo aviso, em forma legível por máquina.
>
> Duas coisas que você vai encontrar antes de qualquer feature: **nada é
> assinado** (o Windows avisa que o publicador é desconhecido; o macOS só abre
> com botão direito → Abrir) e **nada se atualiza sozinho** — o Watchpile agora
> confere se saiu release nova e avisa no sino, e o aplicativo de desktop baixa
> e aplica pra você, mas nenhuma atualização acontece sem você pedir. No Docker
> atualizar continua sendo `docker compose pull && up -d`, e o próprio app
> mostra o comando. A checagem vem ligada e se desliga em
> `Settings → Updates`.

## Formas de usar o Watchpile

Da mais simples para a mais manual — escolha pelo quanto de controle você
quer sobre o processo, não por "qual é melhor".

### Docker (recomendado para homelab)

Um container só, com a API e o cliente web juntos. Sem container de banco
separado — o SQLite é um arquivo no volume.

```bash
docker run -d --name watchpile -p 3210:3210 -v ./data:/data \
  ghcr.io/digit4w/watchpile:0.2.0
```

Ou baixe só o `compose.yaml` deste repositório e troque `build: .` por
`image: ghcr.io/digit4w/watchpile:0.2.0`. **Não precisa clonar nada** — a
imagem já traz o cliente web embutido.

**Duas tags, e a escolha é sobre atualizar:** `:0.2.0` é o que se fixa num
`compose.yaml` que não pode mudar sozinho; `:latest` acompanha. Enquanto o
projeto estiver em `0.x`, `:latest` pode trazer mudança que quebra — ver o
aviso lá em cima.

<details>
<summary><b>Buildar a imagem a partir do código-fonte</b></summary>

`docker compose up --build` sozinho sobe a **API sem o cliente web** —
`client-dist/` neste repositório é um diretório vazio de propósito: server e
client são repositórios separados, sem monorepo. Pra embutir o cliente:

```bash
git clone https://github.com/Digit4w/watchpile-server.git
git clone https://github.com/Digit4w/watchpile-client.git
cd watchpile-client && bun install && bun run build && cd ../watchpile-server
cp -r ../watchpile-client/dist/* client-dist/
docker compose up --build
```

É exatamente o que o CI faz antes de publicar (`.github/workflows/build.yml`).

**Uma imagem buildada por você não traz as chaves de provedor embarcadas** —
elas entram no build a partir de secrets, e uma instalação sem elas pede a sua
própria em Settings, que é o modo de falha previsto.

</details>

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

Backup tem seção própria — ver [Backup](#backup), abaixo.

**Com a imagem publicada**, o `compose.yaml` troca `build: .` por
`image: ghcr.io/digit4w/watchpile:x.y.z`, e não precisa mais clonar o
repositório — só baixar o `compose.yaml`. Use `:x.y.z` num `compose.yaml` que
não pode mudar sozinho, e `:latest` se você quiser acompanhar.

### Desktop (Windows, macOS, Linux)

App Electron — mesma API, mesmo cliente web, empacotados como aplicativo
nativo. Sem terminal, sem Docker: primeiro admin é criado num wizard na
primeira abertura.

Baixe da [página de Releases](https://github.com/Digit4w/watchpile-server/releases)
e instale como qualquer outro app:

| Sistema | Arquivo |
| --- | --- |
| Windows | `Watchpile.Setup.<versão>.exe` |
| macOS (Apple Silicon) | `Watchpile-<versão>-arm64.dmg` |
| Linux | `Watchpile-<versão>.AppImage` |

**Nada é assinado**, e é a primeira coisa que você encontra: no Windows o
SmartScreen avisa que o publicador é desconhecido (*Mais informações → Executar
assim mesmo*); no macOS o app não abre com duplo-clique — **botão direito →
Abrir**, uma vez.

**Atualizar é rodar o instalador novo por cima.** Ele reconhece a instalação
existente e a substitui, e **o seu banco sobrevive** porque não mora na pasta
de instalação: ele fica em `%APPDATA%\Watchpile` no Windows e no
`~/Library/Application Support/Watchpile` no macOS. Não há atualização
automática — você precisa saber que saiu versão nova.

> **Não instale uma versão mais ANTIGA por cima de uma mais nova.** O
> instalador aceita sem reclamar, e o app quebra depois: as migrations já
> aplicadas deixam o banco num formato que o binário antigo não conhece.

<details>
<summary><b>Rodar ou empacotar a partir do código-fonte</b></summary>

Os dois repositórios precisam estar lado a lado (`watchpile-server/` e
`watchpile-client/` na mesma pasta pai):

```bash
git clone https://github.com/Digit4w/watchpile-server.git
git clone https://github.com/Digit4w/watchpile-client.git
cd watchpile-server && bun install
```

- **Modo dev**, janela recarrega ao mudar código do server: `bun run electron:dev`
- **Pacote de verdade**, o mesmo artefato que o CI produz:
  `bun run electron:build` — builda o client, empacota, e deixa o instalador
  em `builds/<mac|windows|linux>/<preview|stable>/`

Ele builda só para o sistema operacional em que você o roda —
`better-sqlite3` é módulo nativo, não dá pra cross-compilar de forma
confiável. `.github/workflows/build.yml` cobre os três SOs via matriz do
GitHub Actions.

**Um pacote buildado por você não traz as chaves de provedor embarcadas** —
elas entram a partir de secrets do CI, e sem elas a instalação pede a sua
própria em Settings.

</details>

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

## Backup

**Tudo que é seu está em um arquivo**: o `.db` do SQLite. Copiar esse arquivo
é o backup inteiro — biblioteca, progresso, pilhas, log, e também as chaves de
provedor que o admin configurou.

**Não copie o `.db` com o servidor rodando.** Ele fica em modo WAL, e uma cópia
crua pode vir corrompida ou sem as transações mais recentes. O jeito certo é
`VACUUM INTO`, que produz um arquivo consistente sem parar nada:

```bash
# Docker
docker compose exec -u watchpile watchpile \
  sqlite3 /data/watchpile.db "VACUUM INTO '/data/backup-$(date +%F).db'"

# Desktop ou Node — aponte para o seu WATCHPILE_DB_PATH
sqlite3 ~/Library/Application\ Support/Watchpile/watchpile.db \
  "VACUUM INTO '$HOME/watchpile-backup-$(date +%F).db'"
```

No Windows o banco fica em `%APPDATA%\Watchpile\watchpile.db`.

`-u watchpile` importa no Docker: sem ele, `docker compose exec` roda como root
(o entrypoint só troca de usuário pro processo principal), e o backup nasce com
o mesmo problema de dono que o `PUID`/`PGID` existe pra evitar.

> **Faça isso antes de atualizar de versão**, enquanto o projeto estiver em
> `0.x`. Não há teste de upgrade de migration entre versões, e as migrations
> rodam sozinhas ao subir — se algo der errado, o backup é o que existe.

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

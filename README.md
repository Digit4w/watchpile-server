# Watchpile

*[Leia em português](README.pt-BR.md)*

| Build | License | Status |
| --- | --- | --- |
| [![CI](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml/badge.svg)](https://github.com/Digit4w/watchpile-server/actions/workflows/build.yml) | ![License](https://img.shields.io/badge/license-AGPL--3.0-blue) | ![Status](https://img.shields.io/badge/status-pre--release-orange) |

Self-hosted media tracker — films, series, anime, manga, games and books — in
the spirit of Yamtrack, Trakt and Suwayomi. One server, many clients: this
repository exposes a documented HTTP API (`openapi.json`) and, by default, also
serves the official web client.

> **Current state: `v0.1.0`, the first public test release.** There is a
> published image and there are ready-made installers — the sections below lead
> with those, and building from source stays documented right after.
>
> **"Alpha" here is not modesty, and the reason is specific: there is no
> migration upgrade test between versions.** An installation that skips a
> release applies the migrations in sequence, and nobody has proven that
> sequence works. Whoever has hundreds of imported titles is the one who feels
> it most if it goes wrong — **back up the `.db` before upgrading** (see
> [Backup](#backup)). The `0.x` in the version number is the same warning, in
> machine-readable form.
>
> Two things you will meet before any feature: **nothing is signed** (Windows
> warns that the publisher is unknown; macOS only opens it with right-click →
> Open) and **there are no automatic updates** — learning that a new version
> shipped, and downloading it, is on you.

## Ways to run Watchpile

From the simplest to the most manual — pick by how much control you want over
the process, not by "which one is better".

### Docker (recommended for a homelab)

A single container, with the API and the web client together. No separate
database container — SQLite is a file in the volume.

```bash
docker run -d --name watchpile -p 3210:3210 -v ./data:/data \
  ghcr.io/digit4w/watchpile:0.1.0
```

Or grab just the `compose.yaml` from this repository and swap `build: .` for
`image: ghcr.io/digit4w/watchpile:0.1.0`. **You don't need to clone anything** —
the image already ships the web client inside.

**Two tags, and the choice is about upgrading:** `:0.1.0` is what you pin in a
`compose.yaml` that must not change on its own; `:latest` follows along. While
the project is in `0.x`, `:latest` may bring a breaking change — see the warning
above.

<details>
<summary><b>Building the image from source</b></summary>

`docker compose up --build` on its own brings up the **API without the web
client** — `client-dist/` in this repository is an empty directory on purpose:
server and client are separate repositories, with no monorepo. To embed the
client:

```bash
git clone https://github.com/Digit4w/watchpile-server.git
git clone https://github.com/Digit4w/watchpile-client.git
cd watchpile-client && bun install && bun run build && cd ../watchpile-server
cp -r ../watchpile-client/dist/* client-dist/
docker compose up --build
```

This is exactly what CI does before publishing (`.github/workflows/build.yml`).

**An image you build yourself does not carry the embedded provider keys** — they
enter the build from secrets, and an installation without them asks for your own
in Settings, which is the intended failure mode.

</details>

The repository's `compose.yaml` already ships a working example. The variables
most often worth adjusting:

| Variable | Default | Effect |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` / `1000` | owner of the files created under `/data` — match it to your user on the host |
| `TZ` | container UTC | time zone — affects "watched today" and the logs |
| `PORT` | `3210` | internal port the API listens on |
| `WATCHPILE_SERVE_CLIENT` | `true` | `false` turns the web client off, leaving only the API |

A single volume, `/data`, holding the database and (in the future) the artwork
cache — map only that one. A `HEALTHCHECK` is built into the `Dockerfile`, for
Dockge, Portainer and Watchtower.

Backup has its own section — see [Backup](#backup), below.

**With the published image**, `compose.yaml` swaps `build: .` for
`image: ghcr.io/digit4w/watchpile:x.y.z`, and you no longer need to clone the
repository — just download the `compose.yaml`. Use `:x.y.z` in a `compose.yaml`
that must not change on its own, and `:latest` if you want to follow along.

### Desktop (Windows, macOS, Linux)

An Electron app — same API, same web client, packaged as a native application.
No terminal, no Docker: the first admin is created by a wizard the first time
you open it.

Download it from the
[Releases page](https://github.com/Digit4w/watchpile-server/releases) and
install it like any other app:

| System | File |
| --- | --- |
| Windows | `Watchpile.Setup.<version>.exe` |
| macOS (Apple Silicon) | `Watchpile-<version>-arm64.dmg` |
| Linux | `Watchpile-<version>.AppImage` |

**Nothing is signed**, and that is the first thing you meet: on Windows,
SmartScreen warns that the publisher is unknown (*More info → Run anyway*); on
macOS the app will not open on a double-click — **right-click → Open**, once.

**Upgrading means running the new installer on top.** It recognises the existing
installation and replaces it, and **your database survives**, because it does
not live in the installation folder: it sits in `%APPDATA%\Watchpile` on Windows
and in `~/Library/Application Support/Watchpile` on macOS. There are no
automatic updates — you need to learn that a new version shipped.

> **Do not install an OLDER version on top of a newer one.** The installer
> accepts it without complaining, and the app breaks afterwards: the migrations
> already applied leave the database in a shape the older binary does not know.

<details>
<summary><b>Running or packaging from source</b></summary>

The two repositories have to sit side by side (`watchpile-server/` and
`watchpile-client/` under the same parent folder):

```bash
git clone https://github.com/Digit4w/watchpile-server.git
git clone https://github.com/Digit4w/watchpile-client.git
cd watchpile-server && bun install
```

- **Dev mode**, window reloads when server code changes: `bun run electron:dev`
- **A real package**, the same artifact CI produces: `bun run electron:build` —
  it builds the client, packages everything, and leaves the installer in
  `builds/<mac|windows|linux>/<preview|stable>/`

It only builds for the operating system you run it on — `better-sqlite3` is a
native module, and cross-compiling it is not reliable.
`.github/workflows/build.yml` covers the three systems through a GitHub Actions
matrix.

**A package you build yourself does not carry the embedded provider keys** —
they enter from CI secrets, and without them the installation asks for your own
in Settings.

</details>

### Node directly (no Docker, no Electron)

For those who already run a process supervisor (PM2, systemd) and would rather
not run Docker. It is the same binary as the other two modes — what changes is
only who starts the process.

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

You have to place the client build (`client/dist`, produced with `bun run build`
in the client repository) at the path `WATCHPILE_CLIENT_DIST_PATH` points to —
none of this happens automatically outside Docker and Electron, which already
embed that step.

## Backup

**Everything that is yours lives in one file**: the SQLite `.db`. Copying that
file is the whole backup — library, progress, piles, log, and also the provider
keys the admin configured.

**Do not copy the `.db` while the server is running.** It runs in WAL mode, and
a raw copy can come out corrupted or missing the most recent transactions. The
right way is `VACUUM INTO`, which produces a consistent file without stopping
anything:

```bash
# Docker
docker compose exec -u watchpile watchpile \
  sqlite3 /data/watchpile.db "VACUUM INTO '/data/backup-$(date +%F).db'"

# Desktop or Node — point it at your own WATCHPILE_DB_PATH
sqlite3 ~/Library/Application\ Support/Watchpile/watchpile.db \
  "VACUUM INTO '$HOME/watchpile-backup-$(date +%F).db'"
```

On Windows the database sits in `%APPDATA%\Watchpile\watchpile.db`.

The `-u watchpile` matters under Docker: without it, `docker compose exec` runs
as root (the entrypoint only switches user for the main process), and the backup
is born with the very ownership problem `PUID`/`PGID` exists to avoid.

> **Do this before upgrading**, while the project is in `0.x`. There is no
> migration upgrade test between versions, and migrations run on their own at
> startup — if something goes wrong, the backup is what you have.

## Configuration

Every environment variable is an **override, never a requirement** — the server
starts with zero configuration, and each one has a sensible default. None of
them is mandatory.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3210` | HTTP port. `0` lets the operating system pick one |
| `NODE_ENV` | `development` | `production` in any published image |
| `LOG_LEVEL` | `info` | level of the structured log (pino) |
| `WATCHPILE_DB_PATH` | `./data/watchpile.db` | path to the SQLite file |
| `WATCHPILE_SERVE_CLIENT` | `true` | whether the server also serves the web client build |
| `WATCHPILE_CLIENT_DIST_PATH` | `./client-dist` | where to look for the client build, when `WATCHPILE_SERVE_CLIENT=true` |
| `PUID` / `PGID` | `1000` / `1000` | (Docker only) user the process runs as inside the container |

## An API open to other clients

The contract is generated from the code, not written by hand: `openapi.json` in
this repository is what any client — official or third-party — consumes. With
the server running, the interactive documentation lives at `/reference`.

A third-party client that only talks to that API is a separate work: the
server's AGPL does not reach it (see License).

## License

[AGPL-3.0](LICENSE). The clause that matters day to day: anyone who modifies
Watchpile and offers it as a service reachable over a network has to make the
modified source available.

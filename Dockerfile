# syntax=docker/dockerfile:1

# Debian slim, não Alpine: better-sqlite3 não publica binário pré-compilado
# para musl, e as três etapas usam a mesma base para o módulo nativo ficar
# compilado contra a exata libc do runtime final.

# better-sqlite3 é módulo nativo: nem todo par plataforma/arquitetura tem
# binário pré-compilado disponível, então as duas etapas que instalam
# dependências carregam toolchain de compilação para o node-gyp ter onde cair.
FROM node:22-bookworm-slim AS deps-base
RUN apt-get update \
  && apt-get install --no-install-recommends --yes python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global bun

# --ignore-scripts pula o "prepare" (lefthook install) — hook de git não faz
# sentido dentro da imagem, e o binário nem está presente no install de
# produção. O prod-deps reconstrói só o better-sqlite3 na sequência, que é o
# único pacote com passo nativo de fato necessário em runtime.

# ---- build ----
FROM deps-base AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# ---- dependências de produção, compiladas contra esta mesma imagem base ----
FROM deps-base AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts \
  && npm rebuild better-sqlite3

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime

# gosu: droppar de root pro usuário PUID/PGID no entrypoint.
# sqlite3: comando de backup documentado no README (VACUUM INTO) — copiar o
# .db com o servidor rodando em WAL pode gerar backup corrompido.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes gosu sqlite3 \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system watchpile \
  && useradd --system --gid watchpile --create-home watchpile

WORKDIR /app
ENV NODE_ENV=production
ENV WATCHPILE_DB_PATH=/data/watchpile.db
ENV PORT=3210

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# migrate() resolve relativo ao próprio db/client.js compilado (dist/db/),
# não ao cwd — por isso o destino aqui é dist/db/migrations, não src/db/.
COPY src/db/migrations ./dist/db/migrations
COPY package.json ./
# client-dist/ existe sempre no contexto (mesmo vazio, via .gitkeep) — quem
# builda com o client de verdade dentro (README, "Docker") o preenche antes
# do `docker build`; sem isso, o container sobe só com a API.
COPY client-dist ./client-dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]

import { createRoute, z } from '@hono/zod-openapi'

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * `THIS INSTANCE / Storage` — o que este servidor guardou porque podia buscar
 * de novo (brief, 3.9 e 3.10).
 *
 * ── Por que é do ADMIN, e aqui divergimos do Yamtrack de propósito ──────────
 * Lá limpar o cache de busca mora em `Advanced`, que é seção de usuário. Aqui
 * os dois caches são **compartilhados pela instalação** — duas pessoas com o
 * mesmo filme dividem um arquivo de arte, e uma resposta de busca cacheada
 * responde pra todo mundo. Limpá-los gasta a cota de requisição, que também é
 * compartilhada. Pela régua de 30/08 — *infraestrutura da instância é do
 * admin; conteúdo é do usuário* —, isso é do admin.
 *
 * ── São DOIS caches, e limpar um não é limpar o outro ───────────────────────
 * `provider_cache` guarda as RESPOSTAS (busca e detalhe, 6h de validade);
 * `art_cache` guarda os ARQUIVOS de pôster, com teto e descarte LRU. Uma rota
 * só, que apagasse os dois, esconderia que quem quer espaço em disco quer o
 * segundo e quem quer ver o catálogo atualizado quer o primeiro.
 *
 * **E os dois têm FORMAS diferentes, então são dois schemas.** Um conta
 * respostas e se limita por validade; o outro conta arquivos e se limita por
 * tamanho. Um schema comum com os dois campos opcionais faria toda tela
 * perguntar qual metade veio preenchida.
 *
 * **Há uma terceira coisa que NÃO se apaga aqui:** `title_snapshots`, a cópia
 * local da ficha da obra. Ela existe justamente para a tela sobreviver ao
 * provedor cair, então limpá-la junto desfaria o que ela promete.
 *
 * ── Nenhuma delas é destrutiva ──────────────────────────────────────────────
 * As duas apagam dado **derivado**: a resposta volta na próxima busca, a arte
 * volta na próxima vez que alguém abrir a obra. É o que as separa do apagar a
 * biblioteca, que mora em `YOU` e leva conteúdo junto.
 */

const ProviderCacheUsageSchema = z
  .object({
    /** Respostas de provedor guardadas — busca e detalhe. */
    responses: z.number().int(),
    bytes: z.number().int(),
  })
  .openapi('ProviderCacheUsage')

const ArtCacheUsageSchema = z
  .object({
    /** Arquivos de pôster em disco. */
    files: z.number().int(),
    bytes: z.number().int(),
    /** O teto, em bytes — `WATCHPILE_ART_CACHE_MB`. */
    limitBytes: z.number().int(),
  })
  .openapi('ArtCacheUsage')

const StorageSchema = z
  .object({
    providerCache: ProviderCacheUsageSchema,
    artCache: ArtCacheUsageSchema,
  })
  .openapi('StorageUsage')

const unauthorized = {
  401: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'No active session',
  },
  403: {
    content: { 'application/json': { schema: MessageSchema } },
    description: 'This is set by the server admin',
  },
} as const

export const usage = createRoute({
  method: 'get',
  path: '/',
  tags: ['Storage'],
  responses: {
    200: {
      content: { 'application/json': { schema: StorageSchema } },
      description: 'What each cache holds right now',
    },
    ...unauthorized,
  },
})

/**
 * A resposta diz o que o cache TINHA, não o que sobrou — que é sempre zero.
 * É o número que a tela mostra depois do clique ("2,4 MB liberados"), e ele só
 * existe antes da escrita.
 */
export const clearProviderCache = createRoute({
  method: 'delete',
  path: '/provider-cache',
  tags: ['Storage'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ cleared: ProviderCacheUsageSchema }),
        },
      },
      description: 'What the cache held before it was emptied',
    },
    ...unauthorized,
  },
})

export const clearArtCache = createRoute({
  method: 'delete',
  path: '/art-cache',
  tags: ['Storage'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ cleared: ArtCacheUsageSchema }),
        },
      },
      description: 'What the cache held before it was emptied',
    },
    ...unauthorized,
  },
})

export type UsageRoute = typeof usage
export type ClearProviderCacheRoute = typeof clearProviderCache
export type ClearArtCacheRoute = typeof clearArtCache

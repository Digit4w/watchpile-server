import { createRoute, z } from '@hono/zod-openapi'

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * `THIS INSTANCE / Logs` — o que este servidor andou fazendo, lido do arquivo
 * que `lib/logger.ts` escreve (14/09/2026).
 *
 * **Do admin, caminho inteiro**, como `storage`: o log é da INSTÂNCIA — traz
 * provedor, import e atualização de todo mundo que usa este servidor —, e pela
 * régua de 30/08 infraestrutura da instância é do admin. Quem não é admin pede
 * o log a quem hospeda.
 */

const LogErrorSchema = z
  .object({
    type: z.string().nullable(),
    message: z.string().nullable(),
    stack: z.string().nullable(),
  })
  .openapi('LogError')

const LogLineSchema = z
  .object({
    /** Milissegundos desde a época, em UTC. A tela formata no fuso de quem lê. */
    time: z.number(),
    /** O nível do pino: 20 debug, 30 info, 40 warn, 50 error, 60 fatal. */
    level: z.number().int(),
    msg: z.string(),
    fields: z.record(z.string(), z.unknown()),
    err: LogErrorSchema.nullable(),
  })
  .openapi('LogLine')

const LogPageSchema = z
  .object({
    lines: z.array(LogLineSchema),
    hasOlder: z.boolean(),
    usage: z.object({
      files: z.number().int(),
      bytes: z.number().int(),
      /** O teto: `WATCHPILE_LOG_MAX_MB` × `WATCHPILE_LOG_FILES`. */
      limitBytes: z.number().int(),
    }),
  })
  .openapi('LogPage')

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

export const read = createRoute({
  method: 'get',
  path: '/',
  tags: ['Logs'],
  request: {
    query: z.object({
      level: z.enum(['all', 'warn', 'error']).default('all'),
      /** Só linhas anteriores a este instante (ms) — o `Load older`. */
      before: z.coerce.number().optional(),
      /** Só linhas posteriores a este instante (ms) — o acompanhamento. */
      after: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: LogPageSchema } },
      description: 'The newest log lines that match the filter',
    },
    ...unauthorized,
  },
})

export const download = createRoute({
  method: 'get',
  path: '/download',
  tags: ['Logs'],
  responses: {
    200: {
      content: { 'application/x-ndjson': { schema: z.string() } },
      description:
        'Every log file this server kept, oldest first, as JSON Lines',
    },
    ...unauthorized,
  },
})

export type ReadRoute = typeof read
export type DownloadRoute = typeof download

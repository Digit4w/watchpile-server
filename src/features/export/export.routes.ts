import { createRoute, z } from '@hono/zod-openapi'

const MessageSchema = z.object({
  message: z.string(),
})

/**
 * `YOU / Export` — a biblioteca desta pessoa, no formato que este mesmo
 * servidor importa (brief, 3.12).
 *
 * **Feature própria e não uma rota dentro de `entries`**, pelo mesmo motivo que
 * `import` é feature: o recurso não é uma obra nem uma coleção de obras, é um
 * ARQUIVO — ele tem formato, cabeçalho de download e um contrato com o
 * importador, e nada disso pertence ao CRUD da entidade. Espelha `/api/import`
 * do outro lado do laço.
 *
 * **Sem `adminMiddleware`**: o que sai daqui é conteúdo do usuário, e a
 * biblioteca exportada é a de quem pediu. O `user_id` sai da sessão, nunca da
 * query — não há como exportar a biblioteca de outra pessoa.
 */
export const entriesCsv = createRoute({
  method: 'get',
  path: '/entries.csv',
  tags: ['Export'],
  responses: {
    200: {
      content: { 'text/csv': { schema: z.string() } },
      description: 'The library as CSV, in the format this server imports',
    },
    401: {
      content: { 'application/json': { schema: MessageSchema } },
      description: 'No active session',
    },
  },
})

export type EntriesCsvRoute = typeof entriesCsv

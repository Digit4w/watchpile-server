import { env } from '../../env.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { dumpLog, logUsage, readLog } from './logs.read.js'
import type { DownloadRoute, ReadRoute } from './logs.routes.js'

/**
 * Quantas linhas por leitura. Mil é o que a tela diz ("Showing the last 1,000
 * lines"), e o número mora AQUI e não na query: é um teto contra resposta
 * gigante, não uma preferência de quem pede.
 */
const PAGE_SIZE = 1000

const MB = 1024 * 1024

export const read: AppRouteHandler<ReadRoute> = (c) => {
  const { level, before, after } = c.req.valid('query')
  const dir = env.WATCHPILE_LOG_PATH
  const files = env.WATCHPILE_LOG_FILES

  const page = readLog({ dir, files, level, before, after, limit: PAGE_SIZE })

  return c.json(
    {
      ...page,
      usage: {
        ...logUsage(dir, files),
        limitBytes: Math.round(env.WATCHPILE_LOG_MAX_MB * MB) * files,
      },
    },
    200,
  )
}

/**
 * Com a data no nome, pelo motivo do export: quem baixa duas vezes precisa
 * saber qual é o mais novo. E **destino é endereço** — quem nomeia o arquivo é
 * o servidor, e a tela usa `<a href download>`, não `fetch`.
 */
function fileName(now: Date): string {
  return `watchpile-log-${now.toISOString().slice(0, 10)}.jsonl`
}

/**
 * **O `as never` é contra um defeito de TIPO do `@hono/zod-openapi`, não nosso.**
 * Ele casa o content type contra `application/${x}json${y}` e só aceita `x`
 * vazio ou terminado em `+`, então `application/x-ndjson` vira `never` — e
 * nenhuma resposta cabe no 200. `text/csv`, do export, escapa porque não tem
 * `json` no nome.
 *
 * A alternativa seria declarar outro content type no contrato, e aí o
 * `openapi.json` mentiria sobre o arquivo que sai. O cast fica restrito a esta
 * linha, e o teste e2e confere o que ele deixa de conferir: status, cabeçalhos
 * e corpo.
 */
export const download: AppRouteHandler<DownloadRoute> = (c) =>
  c.body(dumpLog(env.WATCHPILE_LOG_PATH, env.WATCHPILE_LOG_FILES), 200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName(new Date())}"`,
    // Log de uma instalação: nenhum proxy compartilhado pode guardá-lo.
    'Cache-Control': 'private, no-store',
  }) as never

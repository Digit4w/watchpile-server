import type { Context } from 'hono'
import { pinoLogger as honoPinoLogger } from 'hono-pino'
import type { Level } from 'pino'
import { logger } from '../lib/logger.js'

/**
 * A partir de quanto uma resposta bem-sucedida merece linha no arquivo.
 *
 * Um segundo é muito pra um servidor que responde `GET /api/entries` em 6ms com
 * 1.442 obras (medido em 13/09/2026). O que passa disso é quase sempre um
 * provedor lento ou o limitador segurando arte, e é exatamente o que alguém vai
 * querer ver quando reclamar que "o app está lento".
 */
const SLOW_MS = 1000

const startedAt = new WeakMap<Context, number>()

/**
 * O nível da linha de cada requisição — 14/09/2026, decisão do dono: **só
 * 4xx/5xx e lentas chegam ao arquivo** no nível padrão (`info`).
 *
 * O resto vai em `debug`. Antes disto era uma linha em `info` por requisição, e
 * rolar `/library` gerava uma por pôster — o arquivo de 5 MB encheria com
 * `GET /api/entries/…/art 200` antes de guardar o erro que alguém veio procurar.
 *
 * **4xx é `info` e não `warn`:** `401` em `/api/auth/me` é o estado normal de
 * quem não entrou, e `404` é a resposta de toda arte que falta — o motivo
 * dessa já vai pro log na própria rota. Aviso que acende por comportamento
 * normal ensina a ignorar aviso.
 */
function levelFor(c: Context): Level {
  const status = c.res.status
  if (c.error || status >= 500) {
    return 'error'
  }
  if (status >= 400) {
    return 'info'
  }
  const started = startedAt.get(c)
  if (started !== undefined && performance.now() - started >= SLOW_MS) {
    return 'info'
  }
  return 'debug'
}

export function pinoLoggerMiddleware() {
  return honoPinoLogger({
    pino: logger,
    http: {
      /**
       * **Sem headers**, e é o conserto de um vazamento: o padrão do
       * `hono-pino` grava todos, e o cookie de sessão ia junto em toda linha.
       * A redação no `streamWrite` também o pegaria; tirar da origem é o que
       * não depende de a lista de nomes estar completa.
       *
       * `path` e não `url`: a query pode carregar o termo de uma busca, que é
       * dado de quem buscou.
       */
      onReqBindings: (c) => {
        startedAt.set(c, performance.now())
        return { req: { method: c.req.method, path: c.req.path } }
      },
      onResBindings: (c) => ({ res: { status: c.res.status } }),
      onResLevel: levelFor,
    },
  })
}

import { OpenAPIHono } from '@hono/zod-openapi'
import { compress } from 'hono/compress'
import { pinoLoggerMiddleware } from '../middlewares/pino-logger.js'
import { sessionMiddleware } from '../middlewares/session.js'
import { notFound, onError } from './errors.js'
import type { AppBindings } from './types.js'

export function createRouter() {
  return new OpenAPIHono<AppBindings>({ strict: false })
}

export function createApp() {
  const app = createRouter()

  /**
   * Compressão — 13/09/2026, e ela faltava desde sempre.
   *
   * Medido contra uma biblioteca de 1.200 obras: `GET /api/entries` responde
   * **347 KB crus**, e a rota não pagina por decisão de escopo (brief, 3.12).
   * Numa LAN isso não aparece; num acesso remoto — que é metade do ponto de um
   * self-hosted — são 347 KB a cada abertura de `/library`.
   *
   * **Vem ANTES de tudo**, porque ele embrulha a resposta de quem vier depois:
   * registrado no meio, as rotas montadas antes dele sairiam sem compressão, e
   * a diferença só apareceria olhando um header.
   *
   * **O corpo continua sendo o mesmo.** O cliente não muda nada e nem sabe
   * disso — quem negocia é o navegador, pelo `Accept-Encoding` que ele já manda;
   * sem o header, a resposta sai crua como antes.
   */
  app.use(compress())
  app.use(pinoLoggerMiddleware())
  app.use(sessionMiddleware())
  app.notFound(notFound)
  app.onError(onError)

  return app
}

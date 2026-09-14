import { multistream, pino } from 'pino'
import { env } from '../env.js'
import { redactLine } from './log-redact.js'
import { createRotatingFile } from './log-rotation.js'

/**
 * O logger RAIZ do servidor — 14/09/2026.
 *
 * Antes dele o pino nascia dentro do middleware HTTP, e só handler de rota o
 * alcançava (`c.var.logger`). Tudo que roda fora de uma requisição — o executor
 * do import, o aquecimento do cache de arte, a checagem de atualização — ou não
 * logava nada, ou ia de `console.*`, que não chega ao arquivo. Por isso o logger
 * é um módulo, e o middleware é só um dos consumidores dele.
 *
 * **Dois destinos, e os dois recebem a mesma linha redigida:**
 *
 * - **stdout**, porque é o canal do Docker (`docker logs`) e do homelab —
 *   brief, 5.1. Em desenvolvimento ele passa pelo `pino-pretty` como STREAM, no
 *   mesmo processo, e não como `transport`: a worker thread é o que quebra no
 *   Electron empacotado
 * - **o arquivo**, com rotação, porque é ele que sobrevive a um crash e que a
 *   seção `THIS INSTANCE / Logs` lê e oferece pra baixar (decisão do dono)
 *
 * **A redação é no `streamWrite`**, sobre a linha já serializada, e não em
 * `redact` por caminho: caminho só cobre o que se sabe enumerar, e segredo vaza
 * em mensagem de erro e em stack (`lib/log-redact.ts`).
 */

const stdout =
  env.NODE_ENV === 'production'
    ? process.stdout
    : (await import('pino-pretty')).default({ sync: true })

const file = createRotatingFile({
  dir: env.WATCHPILE_LOG_PATH,
  maxBytes: Math.round(env.WATCHPILE_LOG_MAX_MB * 1024 * 1024),
  files: env.WATCHPILE_LOG_FILES,
})

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    hooks: { streamWrite: redactLine },
  },
  multistream([
    { level: env.LOG_LEVEL, stream: stdout },
    { level: env.LOG_LEVEL, stream: file },
  ]),
)

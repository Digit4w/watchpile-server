import { pinoLogger as honoPinoLogger } from 'hono-pino'
import { pino } from 'pino'
import { env } from '../env.js'

export function pinoLoggerMiddleware() {
  return honoPinoLogger({
    pino: pino({
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    }),
  })
}

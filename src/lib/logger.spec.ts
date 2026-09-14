import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { env } from '../env.js'
import { forgetSecrets, REDACTED, registerSecret } from './log-redact.js'
import { logFileName } from './log-rotation.js'
import { logger } from './logger.js'

afterEach(() => {
  forgetSecrets()
})

/**
 * A COSTURA, e não as peças — 14/09/2026.
 *
 * `log-rotation.spec.ts` e `log-redact.spec.ts` provam cada metade sozinha, e as
 * duas continuariam verdes se o `streamWrite` saísse do `logger.ts`. Este teste
 * é o que fica vermelho nesse caso: ele escreve pelo logger que o servidor usa e
 * lê o ARQUIVO que a seção de logs vai servir.
 */
describe('logger', () => {
  it('grava no arquivo a linha já redigida', () => {
    const marker = `marker-${Date.now()}`
    registerSecret('super-secret-value-123')

    logger.warn(
      {
        marker,
        err: new Error('GET https://api.x/?api_key=super-secret-value-123'),
      },
      'provider detail unreachable',
    )

    const lines = readFileSync(
      join(env.WATCHPILE_LOG_PATH, logFileName(0)),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.includes(marker))

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('super-secret-value-123')
    expect(lines[0]).toContain(REDACTED)
    expect(JSON.parse(lines[0] ?? '{}').msg).toBe('provider detail unreachable')
  })
})

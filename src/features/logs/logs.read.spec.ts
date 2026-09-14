import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  forgetSecrets,
  REDACTED,
  registerSecret,
} from '../../lib/log-redact.js'
import { logFileName } from '../../lib/log-rotation.js'
import { dumpLog, logUsage, parseLine, readLog } from './logs.read.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watchpile-logs-read-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  forgetSecrets()
})

const line = (time: number, level: number, msg: string, extra = {}) =>
  JSON.stringify({ level, time, pid: 1, hostname: 'h', msg, ...extra })

/** Escreve um arquivo; `index` 0 é o atual, 1 é o rotacionado mais novo. */
function file(index: number, lines: string[]) {
  writeFileSync(join(dir, logFileName(index)), `${lines.join('\n')}\n`)
}

describe('parseLine', () => {
  it('separa o que a tela desenha do resto dos campos', () => {
    const parsed = parseLine(
      line(1, 50, 'art warm failed', {
        provider: 'mal',
        err: {
          type: 'Error',
          message: 'locked',
          stack: 'Error: locked\n at x',
        },
      }),
    )

    expect(parsed).toEqual({
      time: 1,
      level: 50,
      msg: 'art warm failed',
      fields: { provider: 'mal' },
      err: { type: 'Error', message: 'locked', stack: 'Error: locked\n at x' },
    })
  })

  it('ignora a linha cortada no meio por um crash', () => {
    expect(parseLine('{"level":30,"time":1,"msg":"hal')).toBeNull()
  })

  it('raspa de novo um segredo registrado depois de a linha ser escrita', () => {
    const text = line(1, 40, 'refused', { note: 'key=abcdefgh-12345' })
    registerSecret('abcdefgh-12345')

    expect(JSON.stringify(parseLine(text))).toContain(REDACTED)
    expect(JSON.stringify(parseLine(text))).not.toContain('abcdefgh-12345')
  })
})

describe('readLog', () => {
  it('devolve as últimas linhas em ordem cronológica, atravessando a rotação', () => {
    file(1, [line(1, 30, 'a'), line(2, 30, 'b')])
    file(0, [line(3, 30, 'c'), line(4, 30, 'd')])

    const { lines, hasOlder } = readLog({ dir, files: 3, limit: 3 })

    expect(lines.map((l) => l.msg)).toEqual(['b', 'c', 'd'])
    expect(hasOlder).toBe(true)
  })

  it('não diz que há mais quando o recorte coube inteiro', () => {
    file(0, [line(1, 30, 'a'), line(2, 30, 'b')])

    expect(readLog({ dir, files: 3, limit: 5 }).hasOlder).toBe(false)
  })

  it('filtra por gravidade de forma CUMULATIVA', () => {
    file(0, [line(1, 30, 'info'), line(2, 40, 'warn'), line(3, 50, 'error')])

    const msgs = (level: 'all' | 'warn' | 'error') =>
      readLog({ dir, files: 1, level, limit: 10 }).lines.map((l) => l.msg)

    expect(msgs('all')).toEqual(['info', 'warn', 'error'])
    expect(msgs('warn')).toEqual(['warn', 'error'])
    expect(msgs('error')).toEqual(['error'])
  })

  /**
   * `hasOlder` fala do FILTRO, não do arquivo: com `error`, uma linha de info
   * mais antiga não é "mais" pra quem está olhando só os erros.
   */
  it('conta como mais antiga só a linha que o filtro mostraria', () => {
    file(0, [line(1, 30, 'old info'), line(2, 50, 'e1'), line(3, 50, 'e2')])

    const result = readLog({ dir, files: 1, level: 'error', limit: 2 })

    expect(result.lines.map((l) => l.msg)).toEqual(['e1', 'e2'])
    expect(result.hasOlder).toBe(false)
  })

  it('carrega as anteriores a um instante — o Load older', () => {
    file(0, [line(1, 30, 'a'), line(2, 30, 'b'), line(3, 30, 'c')])

    const { lines } = readLog({ dir, files: 1, before: 3, limit: 10 })

    expect(lines.map((l) => l.msg)).toEqual(['a', 'b'])
  })

  it('traz só as posteriores a um instante — o acompanhamento', () => {
    file(1, [line(1, 30, 'a')])
    file(0, [line(2, 30, 'b'), line(3, 30, 'c')])

    const { lines } = readLog({ dir, files: 3, after: 2, limit: 10 })

    expect(lines.map((l) => l.msg)).toEqual(['c'])
  })

  it('não quebra sem arquivo nenhum', () => {
    expect(readLog({ dir, files: 3, limit: 10 })).toEqual({
      lines: [],
      hasOlder: false,
    })
  })
})

describe('logUsage e dumpLog', () => {
  it('conta só os arquivos que existem', () => {
    file(0, [line(1, 30, 'a')])
    file(2, [line(0, 30, 'z')])

    const usage = logUsage(dir, 3)

    expect(usage.files).toBe(2)
    expect(usage.bytes).toBeGreaterThan(0)
  })

  it('emite do mais VELHO pro mais novo, redigido', () => {
    registerSecret('super-secret-value')
    file(1, [line(1, 30, 'older')])
    file(0, [line(2, 30, 'newer super-secret-value')])

    const dump = dumpLog(dir, 3)
    const msgs = dump
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text).msg)

    expect(msgs).toEqual(['older', `newer ${REDACTED}`])
  })

  it('é vazio sem arquivo', () => {
    expect(dumpLog(dir, 3)).toBe('')
  })
})

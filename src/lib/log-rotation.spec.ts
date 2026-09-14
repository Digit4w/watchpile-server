import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRotatingFile, logFileName } from './log-rotation.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'watchpile-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const read = (index: number) =>
  readFileSync(join(dir, logFileName(index)), 'utf8')

describe('createRotatingFile', () => {
  it('escreve no arquivo atual enquanto cabe', () => {
    const file = createRotatingFile({ dir, maxBytes: 100, files: 3 })
    file.write('a\n')
    file.write('b\n')
    file.flushSync()

    expect(read(0)).toBe('a\nb\n')
    expect(existsSync(join(dir, logFileName(1)))).toBe(false)
  })

  it('rotaciona ANTES da linha que estouraria o teto', () => {
    const file = createRotatingFile({ dir, maxBytes: 10, files: 3 })
    file.write('12345678\n') // 9 bytes
    file.write('abc\n') // 9 + 4 > 10
    file.flushSync()

    expect(read(1)).toBe('12345678\n')
    expect(read(0)).toBe('abc\n')
  })

  it('guarda no máximo `files` arquivos, jogando fora o mais velho', () => {
    const file = createRotatingFile({ dir, maxBytes: 4, files: 3 })
    for (const line of ['one\n', 'two\n', 'thr\n', 'fou\n']) {
      file.write(line)
    }
    file.flushSync()

    expect(read(0)).toBe('fou\n')
    expect(read(1)).toBe('thr\n')
    expect(read(2)).toBe('two\n')
    expect(existsSync(join(dir, logFileName(3)))).toBe(false)
  })

  it('conta o tamanho que o arquivo já tinha ao reabrir', () => {
    const first = createRotatingFile({ dir, maxBytes: 10, files: 2 })
    first.write('12345678\n')
    first.flushSync()

    // Um restart do servidor: o teto não recomeça do zero.
    const second = createRotatingFile({ dir, maxBytes: 10, files: 2 })
    second.write('abc\n')
    second.flushSync()

    expect(read(1)).toBe('12345678\n')
    expect(read(0)).toBe('abc\n')
  })

  it('não rotaciona em vão uma linha maior que o teto inteiro', () => {
    const file = createRotatingFile({ dir, maxBytes: 4, files: 2 })
    file.write('muito longa\n')
    file.flushSync()

    expect(read(0)).toBe('muito longa\n')
    expect(existsSync(join(dir, logFileName(1)))).toBe(false)
  })
})

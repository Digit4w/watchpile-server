import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { destination as pinoDestination } from 'pino'

/**
 * O arquivo de log, com rotação por TAMANHO — 14/09/2026.
 *
 * **Em processo, e não por `transport`.** O `pino-pretty` já não resolve módulo
 * dentro do Electron empacotado porque roda numa worker thread
 * (`electron/main.ts`), e o `pino-roll` roda do mesmo jeito. Aqui a escrita é a
 * do próprio `pino.destination()` (sonic-boom), síncrona, no mesmo processo que
 * o servidor — o que também faz a última linha antes de um crash chegar ao disco.
 *
 * **Sem dependência nova**, decisão do dono: a rotação são três renomeações e um
 * `reopen`, e uma biblioteca pra isso seria mais uma licença pra conferir.
 *
 * Os nomes terminam em `.log` em todos os degraus (`watchpile.1.log`, não
 * `watchpile.log.1`), pra o `*.log` do `.gitignore` cobrir os rotacionados e pra
 * quem abre a pasta reconhecer o tipo do arquivo.
 */

export type RotatingFileOptions = {
  dir: string
  /** O teto de UM arquivo, em bytes. */
  maxBytes: number
  /** Quantos arquivos existem no total, contando o atual. */
  files: number
}

export type RotatingFile = {
  write(chunk: string): boolean
  flushSync(): void
  end(): void
}

/** `0` é o atual; os outros são os rotacionados, do mais novo ao mais velho. */
export function logFileName(index: number): string {
  return index === 0 ? 'watchpile.log' : `watchpile.${index}.log`
}

export function createRotatingFile({
  dir,
  maxBytes,
  files,
}: RotatingFileOptions): RotatingFile {
  mkdirSync(dir, { recursive: true })

  const current = join(dir, logFileName(0))
  // Começa do tamanho que o arquivo JÁ tem: sem isso, um servidor que reinicia
  // muito (o caso de quem está com problema) nunca rotacionaria.
  let size = existsSync(current) ? statSync(current).size : 0
  const destination = pinoDestination({ dest: current, sync: true })

  function rotate() {
    destination.flushSync()
    rmSync(join(dir, logFileName(files - 1)), { force: true })
    for (let index = files - 2; index >= 0; index--) {
      const from = join(dir, logFileName(index))
      if (existsSync(from)) {
        renameSync(from, join(dir, logFileName(index + 1)))
      }
    }
    // O descritor aberto ainda aponta pro arquivo renomeado; reabrir pelo
    // caminho cria o atual de novo, vazio.
    destination.reopen()
    size = 0
  }

  return {
    write(chunk) {
      const bytes = Buffer.byteLength(chunk)
      // `size > 0`: uma linha maior que o teto inteiro vai assim mesmo, num
      // arquivo só dela, em vez de rotacionar pra sempre sem escrever nada.
      if (size > 0 && size + bytes > maxBytes) {
        rotate()
      }
      destination.write(chunk)
      size += bytes
      return true
    },
    flushSync() {
      destination.flushSync()
    },
    end() {
      destination.end()
    },
  }
}

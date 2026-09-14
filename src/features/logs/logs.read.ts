import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactLine } from '../../lib/log-redact.js'
import { logFileName } from '../../lib/log-rotation.js'

/**
 * Ler o arquivo de log que `lib/logger.ts` escreve — 14/09/2026.
 *
 * ── De trás pra frente, e parando cedo ──────────────────────────────────────
 * A tela quer as ÚLTIMAS linhas, e acompanha o log por leitura a cada poucos
 * segundos. Ler os 15 MB inteiros e parsear tudo a cada leitura faria a seção
 * que existe pra diagnosticar lentidão ser a lentidão. Então a leitura vai do
 * arquivo mais NOVO pro mais velho, de trás pra frente dentro de cada um, e para
 * quando juntou `limit` linhas — o parse custa o recorte, não o arquivo.
 *
 * ── O cursor é o `time` da linha ────────────────────────────────────────────
 * Número de linha e posição em byte deixam de valer quando o arquivo rotaciona
 * (o atual vira `.1`). O `time` do pino sobrevive à rotação. O custo, assumido:
 * duas linhas no mesmo milissegundo, bem na fronteira de um recorte, podem sair
 * repetidas ou puladas — pra um log de diagnóstico, isso é menos caro que um
 * contador gravado em cada linha.
 *
 * ── A linha passa pela redação DE NOVO ──────────────────────────────────────
 * A régua é redigir no emissor, e ela continua valendo. Isto é a segunda rede:
 * um segredo registrado DEPOIS de a linha ser escrita (uma chave trocada) ainda
 * sai raspado daqui, porque o registro é do processo e não do arquivo.
 */

export type LevelFilter = 'all' | 'warn' | 'error'

/**
 * Os filtros são CUMULATIVOS por gravidade (decisão do dono): `warn` inclui os
 * erros, porque quem procura problema quer os dois. Os números são os do pino.
 */
const MIN_LEVEL: Record<LevelFilter, number> = { all: 0, warn: 40, error: 50 }

export type LogError = {
  type: string | null
  message: string | null
  stack: string | null
}

export type LogLine = {
  time: number
  level: number
  msg: string
  /** O resto da linha. `pid` e `hostname` saem: são ruído, iguais em todas. */
  fields: Record<string, unknown>
  err: LogError | null
}

const OMITTED = new Set(['time', 'level', 'msg', 'err', 'pid', 'hostname'])

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Nulo quando a linha não é JSON — uma escrita cortada por um crash, por exemplo. */
export function parseLine(text: string): LogLine | null {
  let raw: unknown
  try {
    raw = JSON.parse(redactLine(text))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>
  if (typeof record.time !== 'number' || typeof record.level !== 'number') {
    return null
  }

  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!OMITTED.has(key)) {
      fields[key] = value
    }
  }

  const err =
    record.err && typeof record.err === 'object'
      ? (record.err as Record<string, unknown>)
      : null

  return {
    time: record.time,
    level: record.level,
    msg: asText(record.msg) ?? '',
    fields,
    err: err
      ? {
          type: asText(err.type),
          message: asText(err.message),
          stack: asText(err.stack),
        }
      : null,
  }
}

export type ReadOptions = {
  dir: string
  files: number
  level?: LevelFilter
  /** Só linhas ANTERIORES a este instante — o `Load older`. */
  before?: number
  /** Só linhas POSTERIORES a este instante — o acompanhamento ao vivo. */
  after?: number
  limit: number
}

export type ReadResult = {
  /** Em ordem cronológica: a mais nova por ÚLTIMO, como a tela desenha. */
  lines: LogLine[]
  /** Se ficou linha mais antiga que casa com o filtro, fora do recorte. */
  hasOlder: boolean
}

export function readLog({
  dir,
  files,
  level = 'all',
  before,
  after,
  limit,
}: ReadOptions): ReadResult {
  const min = MIN_LEVEL[level]
  const newestFirst: LogLine[] = []

  for (let index = 0; index < files; index++) {
    const path = join(dir, logFileName(index))
    if (!existsSync(path)) {
      continue
    }

    const texts = readFileSync(path, 'utf8').split('\n')
    for (let i = texts.length - 1; i >= 0; i--) {
      const text = texts[i]
      if (!text) {
        continue
      }
      const line = parseLine(text)
      if (!line) {
        continue
      }
      // Tudo daqui pra trás é mais velho: o arquivo é append-only e a rotação
      // preserva a ordem entre arquivos.
      if (after !== undefined && line.time <= after) {
        return { lines: newestFirst.reverse(), hasOlder: false }
      }
      if (before !== undefined && line.time >= before) {
        continue
      }
      if (line.level < min) {
        continue
      }
      if (newestFirst.length === limit) {
        return { lines: newestFirst.reverse(), hasOlder: true }
      }
      newestFirst.push(line)
    }
  }

  return { lines: newestFirst.reverse(), hasOlder: false }
}

/** Quantos arquivos existem e quanto ocupam — a linha "3 files · 7.2 MB". */
export function logUsage(
  dir: string,
  files: number,
): { files: number; bytes: number } {
  let count = 0
  let bytes = 0
  for (let index = 0; index < files; index++) {
    const path = join(dir, logFileName(index))
    if (existsSync(path)) {
      count += 1
      bytes += statSync(path).size
    }
  }
  return { files: count, bytes }
}

/**
 * Todos os arquivos, do mais VELHO pro mais novo, numa string só — o Download.
 *
 * JSON Lines cru (decisão do dono): é o que quem recebe o log precisa, com
 * stack e campos inteiros. Cada linha passa pela redação, pelo mesmo motivo da
 * leitura.
 */
export function dumpLog(dir: string, files: number): string {
  const parts: string[] = []
  for (let index = files - 1; index >= 0; index--) {
    const path = join(dir, logFileName(index))
    if (!existsSync(path)) {
      continue
    }
    for (const text of readFileSync(path, 'utf8').split('\n')) {
      if (text) {
        parts.push(redactLine(text))
      }
    }
  }
  return parts.length > 0 ? `${parts.join('\n')}\n` : ''
}

import {
  ImportFailure,
  type ImportItem,
  type ImportProblem,
  type ImportSource,
  type SourceReading,
} from './import.types.js'

/**
 * O CSV do Watchpile (brief, 3.12).
 *
 * ── O formato é NOSSO, e por isso ele descreve `entries`, não o Yamtrack ────
 * O CSV do Yamtrack tem linhas de `season` e de `episode`, que **precisam** ser
 * ordenadas (`tv` primeiro, depois `season`, depois `episode`) porque o modelo
 * dele tem uma tabela por nível. O nosso não: progresso é contador mais log
 * (brief, 3.11), e a lista de unidades é apresentação do contador, nunca
 * tabela (3.10). Copiar aquele formato importaria a complexidade de um modelo
 * que recusamos de propósito.
 *
 * Uma linha, uma obra. A ordem das linhas não importa.
 *
 * | Coluna | Obrigatória | O que é |
 * | --- | --- | --- |
 * | `media_type` | sim | O slug DESTA instalação — `anime`, `movie`, o que o admin criou |
 * | `title` | sim | |
 * | `status` | sim | Um dos cinco (brief, 3.16) |
 * | `progress` | não | Inteiro. Vazio é 0 |
 * | `total` | não | Inteiro. Vazio é desconhecido, que é legítimo — mangá em publicação não tem último capítulo |
 * | `source` | não | Slug de provedor, quando a obra tem id |
 * | `external_id` | não | O id nesse provedor |
 * | `updated_at` | não | ISO. Vira `occurred_at` no log, que aceita data retroativa |
 *
 * **Sem coluna de nota nem de notas**, e é decisão de escopo: o import deste
 * ciclo traz obra, status e progresso atual. Acrescentá-las depois é uma coluna
 * a mais num formato que ignora coluna desconhecida — não quebra arquivo
 * nenhum.
 *
 * ── `source` sem `external_id` não é erro; é obra sem identidade ────────────
 * O par incompleto é ignorado e a obra entra **sem vínculo**, com
 * `partialIdentity`. Não vira problema porque a linha é importável e o
 * resultado já diz o que houve: ela aparece em "came in without a match", que é
 * a mesma frase e a mesma saída — vincular depois.
 *
 * A consequência assumida vem da decisão de não casar por título (brief, 3.10):
 * **linha sem id não tem identidade**, então reimportar o mesmo arquivo a
 * duplica. Inventar identidade por título juntaria obras diferentes num acervo
 * que ninguém vai reconferir.
 */

const REQUIRED = ['media_type', 'title', 'status'] as const

/** Os cinco do enum (brief, 3.16). */
const STATUSES = [
  'watching',
  'completed',
  'dropped',
  'planned',
  'on-hold',
] as const
type Status = (typeof STATUSES)[number]

/**
 * Um parser de CSV que segue o RFC 4180, escrito à mão.
 *
 * Sem dependência porque cabe aqui e porque o que ele precisa cobrir é fechado:
 * campo entre aspas, vírgula e quebra de linha DENTRO das aspas, aspas
 * escapadas por duplicação, `CRLF`, e BOM. Um `split(',')` erra no primeiro
 * título que tem vírgula — e títulos com vírgula são a regra, não a exceção.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false

  // O BOM que o Excel escreve vira parte do primeiro cabeçalho se ficar.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const endField = () => {
    row.push(field)
    field = ''
    started = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"' && !started) {
      quoted = true
      started = true
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n') {
      endRow()
    } else if (ch === '\r') {
      // `CRLF`: o `\n` seguinte fecha a linha. `CR` solto também fecha.
      if (src[i + 1] !== '\n') {
        endRow()
      }
    } else {
      field += ch
      started = true
    }
  }

  // Última linha sem quebra no fim. Uma linha vazia final não conta.
  if (field !== '' || row.length > 0) {
    endRow()
  }

  return rows
}

export function csvSource(text: string): ImportSource {
  /**
   * `async` e não `Promise.resolve(readCsv(...))`.
   *
   * A segunda forma lança de forma SÍNCRONA quando o arquivo é inválido — o
   * `throw` acontece antes de `Promise.resolve` existir. O executor até pegaria
   * (a chamada está dentro do `try`), mas o contrato diz `Promise`, e função
   * que promete rejeitar não pode lançar: `read().catch(...)` não veria nada.
   * `async` converte o `throw` em rejeição.
   */
  return { read: async () => readCsv(text) }
}

function readCsv(text: string): SourceReading {
  const rows = parseCsv(text).filter((r) =>
    r.some((cell) => cell.trim() !== ''),
  )
  const header = rows.shift()

  /**
   * Sem cabeçalho, ou sem as três colunas obrigatórias, o arquivo inteiro cai
   * — e isso é falha do JOB, não problema de linha. O alcance do sinal é o
   * alcance real do fato (design system, seção 5): aqui não há uma linha ruim,
   * há um arquivo que não é o nosso.
   */
  if (!header) {
    throw new ImportFailure('invalid-file')
  }

  const columns = header.map((h) => h.trim().toLowerCase())
  const missing = REQUIRED.filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new ImportFailure('invalid-file', { missing: missing.join(', ') })
  }

  const at = (row: string[], name: string): string =>
    (row[columns.indexOf(name)] ?? '').trim()

  const items: ImportItem[] = []
  const problems: ImportProblem[] = []

  rows.forEach((row, index) => {
    // +2: a linha 1 é o cabeçalho, e quem lê o arquivo conta a partir de 1.
    const line = index + 2
    const outcome = readRow(row, at, line)

    if ('problem' in outcome) {
      problems.push(outcome.problem)
    } else {
      items.push(outcome.item)
    }
  })

  return { items, problems }
}

function readRow(
  row: string[],
  at: (row: string[], name: string) => string,
  line: number,
): { item: ImportItem } | { problem: ImportProblem } {
  const title = at(row, 'title')
  const mediaType = at(row, 'media_type')

  if (!title || !mediaType) {
    return { problem: { kind: 'missing-identity', row: line } }
  }

  const status = normalizeStatus(at(row, 'status'))
  if (!status) {
    return {
      problem: {
        kind: 'invalid-status',
        row: line,
        params: { value: at(row, 'status') },
      },
    }
  }

  const progress = readInt(at(row, 'progress'))
  if (!progress.ok) {
    return {
      problem: {
        kind: 'invalid-number',
        row: line,
        params: { field: 'progress', value: at(row, 'progress') },
      },
    }
  }

  const total = readInt(at(row, 'total'))
  if (!total.ok) {
    return {
      problem: {
        kind: 'invalid-number',
        row: line,
        params: { field: 'total', value: at(row, 'total') },
      },
    }
  }

  const provider = at(row, 'source')
  const externalId = at(row, 'external_id')
  // Par incompleto vale como ausente — ver o bloco do topo.
  const links = provider && externalId ? [{ provider, externalId }] : []

  const updatedAt = at(row, 'updated_at')
  const occurredAt = updatedAt ? new Date(updatedAt) : null

  return {
    item: {
      mediaType,
      title,
      status,
      // Vazio é 0: não registrar progresso é começar do zero, não é falta de dado.
      progress: progress.value ?? 0,
      // Vazio é desconhecido, e isso é legítimo (brief, 3.12).
      total: total.value,
      links,
      /**
       * A declaração da FONTE: um CSV bem preenchido traz UM vínculo e está
       * completo — ao contrário do AniList, onde completo são dois. Por isso o
       * cálculo é aqui e não no aplicador, que chamaria de incompleto todo CSV
       * que não trouxesse dois ids.
       */
      partialIdentity: links.length === 0,
      occurredAt:
        occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
      row: line,
    },
  }
}

/**
 * Aceita o slug em qualquer caixa e com espaço no lugar do hífen — "On Hold"
 * vira `on-hold`.
 *
 * É gentileza com quem digita o arquivo à mão, e ela para aqui: o CSV usa o
 * NOSSO vocabulário de status (brief, 3.16), não o de outro serviço. Traduzir
 * "In progress" do Yamtrack seria assumir de qual ferramenta o arquivo veio, e
 * o formato não sabe disso.
 */
function normalizeStatus(raw: string): Status | undefined {
  const slug = raw.toLowerCase().replace(/\s+/g, '-')
  return STATUSES.find((s) => s === slug)
}

/**
 * Lê um inteiro, distinguindo **vazio** de **não é número**.
 *
 * A primeira versão devolvia `null` para os dois, e em `total` isso os tornava
 * indistinguíveis — vazio é legítimo ali (mangá em publicação não tem último
 * capítulo), "abc" não é. Resultado discriminado em vez de um sentinela que
 * significa duas coisas.
 */
function readInt(
  raw: string,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === '') {
    return { ok: true, value: null }
  }
  return /^\d+$/.test(raw) ? { ok: true, value: Number(raw) } : { ok: false }
}

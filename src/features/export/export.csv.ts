import type { EntrySource } from '../entries/entries.source.js'

/**
 * O CSV que o NOSSO import consome (brief, 3.12).
 *
 * ── O laço se fecha aqui, e é isso que dá o teste ───────────────────────────
 * O formato já existia e já era lido — `import.csv.ts` o documenta coluna a
 * coluna. Este arquivo não inventa formato nenhum: ele **emite o que aquele
 * aceita**, e por isso o teste que importa é um ciclo — exportar, importar de
 * volta, conferir que nada mudou. Um teste que só olhasse a string emitida
 * congelaria a nossa opinião sobre o formato em vez de conferir que os dois
 * lados concordam.
 *
 * ── Sem BOM, e é decisão ────────────────────────────────────────────────────
 * O leitor deste arquivo é o nosso importador, que aliás já tira o BOM se
 * houver. Escrever um byte no começo do arquivo pra agradar uma planilha
 * poria, num formato que é nosso, um remendo para um programa que não está no
 * laço. Quem abrir no Excel e salvar de volta continua sendo lido: o BOM é
 * tolerado na entrada, só não é produzido na saída.
 *
 * ── `CRLF`, porque é o que o RFC 4180 diz ───────────────────────────────────
 * O parser aceita os dois (e `CR` solto), então a escolha não muda o que
 * atravessa o ciclo. Ela existe pra que o arquivo emitido case com a
 * especificação que o parser cita — duas metades do mesmo formato dizendo a
 * mesma coisa.
 */

/** A ordem é a do bloco de documentação de `import.csv.ts`. */
export const EXPORT_COLUMNS = [
  'media_type',
  'title',
  'status',
  'progress',
  'total',
  'source',
  'external_id',
  'updated_at',
] as const

export type ExportRow = {
  mediaType: string
  title: string
  status: string
  progress: number
  total: number | null
  source: EntrySource | null
  updatedAt: Date
}

/**
 * Um campo, entre aspas só quando precisa.
 *
 * **Aspas por necessidade e não sempre** porque o arquivo é lido por gente
 * também: um CSV inteiro entre aspas é ilegível num editor de texto, e o RFC
 * deixa a escolha em aberto. Precisa quando o campo tem vírgula, aspas ou
 * quebra de linha — os três que fariam o parser ler uma coisa por outra.
 *
 * Espaço nas pontas também entra: o nosso parser dá `trim` em toda célula, e
 * um título que comece com espaço perderia esse espaço no ciclo de volta sem
 * as aspas. É o único caso em que a aspa existe por causa do nosso leitor e
 * não do formato.
 */
function field(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim()
  if (!needsQuotes) {
    return value
  }
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Célula vazia para o que não se sabe.
 *
 * `total` nulo é **desconhecido** — mangá em publicação não tem último
 * capítulo —, e o importador lê célula vazia exatamente assim. Escrever `0`
 * aqui inventaria um total de zero, que o ciclo de volta gravaria como fato.
 */
function optional(value: number | null): string {
  return value === null ? '' : String(value)
}

export function writeCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(',')]

  for (const row of rows) {
    lines.push(
      [
        field(row.mediaType),
        field(row.title),
        field(row.status),
        String(row.progress),
        optional(row.total),
        field(row.source?.provider ?? ''),
        field(row.source?.externalId ?? ''),
        field(row.updatedAt.toISOString()),
      ].join(','),
    )
  }

  // A quebra final existe pra que o arquivo termine em linha inteira; o parser
  // ignora a linha vazia que ela deixa.
  return `${lines.join('\r\n')}\r\n`
}

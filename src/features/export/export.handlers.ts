import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import type { AppRouteHandler } from '../../lib/types.js'
import { sourceOf } from '../entries/entries.source.js'
import { writeCsv } from './export.csv.js'
import type { EntriesCsvRoute } from './export.routes.js'

/**
 * O nome do arquivo que o navegador salva.
 *
 * Com a data, porque quem exporta duas vezes acaba com dois arquivos na mesma
 * pasta — e `watchpile-library (1).csv` não diz qual é o mais novo. Só a data:
 * a hora daria um nome diferente a cada clique e transformaria "exportei de
 * novo" em "tenho seis arquivos".
 */
function fileName(now: Date): string {
  return `watchpile-library-${now.toISOString().slice(0, 10)}.csv`
}

/**
 * Emite a biblioteca inteira, de uma vez.
 *
 * **Sem paginação e sem streaming, e é decisão de tamanho.** Uma obra é uma
 * linha de ~80 bytes: dez mil obras são 800 KB, e a maior biblioteca real que
 * este projeto viu tem 426. Montar a string na memória custa menos do que o
 * caminho de fundo que um stream pediria — e o servidor recusa ter caminho de
 * fundo (brief, 3.1), que é o mesmo motivo pelo qual o cache de arte não tem
 * job.
 *
 * **Sem filtro de tipo escondido.** A preferência de usuário recorta o que é
 * OFERECIDO, nunca o que existe (brief, 3.12) — e um export que sonegasse as
 * obras de um tipo escondido produziria um backup incompleto sem dizer, que é
 * a pior forma de errar num arquivo que existe para não perder nada.
 *
 * A ordem é por `id`: é a de inserção, é estável, e faz dois exports seguidos
 * do mesmo acervo darem arquivos idênticos — o que permite comparar dois
 * backups com `diff`.
 */
export const entriesCsv: AppRouteHandler<EntriesCsvRoute> = (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const rows = db
    .select()
    .from(entries)
    .where(eq(entries.userId, user.id))
    .orderBy(entries.id)
    .all()

  const csv = writeCsv(
    rows.map((row) => ({
      mediaType: row.mediaType,
      title: row.title,
      status: row.status,
      progress: row.progress,
      total: row.total,
      source: sourceOf(row.id, row.primaryProvider),
      updatedAt: row.updatedAt,
    })),
  )

  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName(new Date())}"`,
    // O arquivo é a biblioteca de uma conta: nenhum proxy compartilhado pode
    // guardá-lo, e o de amanhã não é o de hoje.
    'Cache-Control': 'private, no-store',
  })
}

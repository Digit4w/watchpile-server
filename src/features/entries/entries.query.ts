import { asc, desc, type SQL, sql } from 'drizzle-orm'
import { entries } from '../../db/schema/entries.js'

/**
 * As quatro ordens que `/library` oferece (`design/mockups/library.html`,
 * seção "View as" do popover). São chaves opacas de propósito: o rótulo
 * ("Recently updated", "Title A–Z") é copy traduzível e mora no cliente, não
 * na URL.
 */
export const ENTRY_SORTS = ['updated', 'added', 'title', 'rating'] as const

export type EntrySort = (typeof ENTRY_SORTS)[number]

/**
 * Toda ordem termina desempatando por `id` porque SQLite não promete ordem
 * estável entre linhas iguais — sem isso, duas obras com a mesma nota trocam
 * de lugar entre dois `GET` idênticos e a grade pisca sem motivo.
 *
 * `rating` desce com `NULLS LAST`: obra sem nota não é obra de nota zero, e
 * deixá-la no topo enterraria justamente o que a ordem quer mostrar.
 */
const ORDER_BY: Record<EntrySort, SQL[]> = {
  updated: [desc(entries.updatedAt), desc(entries.id)],
  added: [desc(entries.createdAt), desc(entries.id)],
  // `COLLATE NOCASE` para "attack on titan" cair junto de "Attack on Titan".
  // Vale só para ASCII — é o que o SQLite oferece sem extensão, e português
  // acentuado ainda ordena depois de `z`. Decisão de i18n, quando houver.
  title: [sql`${entries.title} COLLATE NOCASE ASC`, asc(entries.id)],
  rating: [sql`${entries.rating} DESC NULLS LAST`, asc(entries.id)],
}

export function orderFor(sort: EntrySort): SQL[] {
  return ORDER_BY[sort]
}

/**
 * Busca por texto no título — substring, sem âncora, porque quem digita
 * "titan" espera achar "Attack on Titan".
 *
 * `%` e `_` são curingas do `LIKE`: sem escapar, quem procura "100%" recebe a
 * biblioteca inteira e quem procura "re_zero" recebe qualquer coisa com
 * "reXzero". O `ESCAPE` precisa vir declarado — o SQLite não assume nenhum.
 */
export function titleContains(term: string): SQL {
  const escaped = term.replace(/[\\%_]/g, '\\$&')
  return sql`${entries.title} LIKE ${`%${escaped}%`} ESCAPE '\\'`
}

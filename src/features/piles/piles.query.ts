import { asc, desc, type SQL, sql } from 'drizzle-orm'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'

/**
 * As quatro ordens que `/piles` oferece (`design/mockups/piles.html`, seção
 * "Sort by" do popover). Chaves opacas, como em `entries.query.ts`: o rótulo
 * ("Recently updated", "Name A–Z") é copy traduzível e mora no cliente.
 *
 * `size` é a única que `/library` não tem, e não é simetria: pilha é
 * recipiente, e "qual é a maior" é pergunta que só se faz de recipiente.
 * Falta, em compensação, a ordem por nota — pilha não tem nota.
 */
export const PILE_SORTS = ['updated', 'added', 'name', 'size'] as const

export type PileSort = (typeof PILE_SORTS)[number]

/**
 * Quantas obras o ladrilho mostra quando não há capa subida — o mosaico 2×2 do
 * segundo nível de identidade da pilha (`design/mockups/piles.html`).
 *
 * Quatro porque o mosaico é 2×2, e o mockup registra que 2×2 com buraco fica
 * pior que uma peça só: quem desenha escolhe entre mosaico cheio e peça única,
 * nunca um meio-termo. O servidor manda até quatro; a decisão de qual dos
 * quatro níveis desenhar é do cliente.
 */
export const PILE_PREVIEW_SIZE = 4

/**
 * Quantas obras a pilha tem.
 *
 * Vive aqui e não no handler porque a ordem `size` ordena por ELA — a mesma
 * expressão precisa aparecer no `SELECT` e no `ORDER BY`, e escrevê-la duas
 * vezes é o tipo de duplicação que só se percebe quando as duas divergem.
 *
 * `count(entry_id)` e não `count(*)`: o `LEFT JOIN` que traz a contagem devolve
 * uma linha com `entry_id` nulo para a pilha vazia, e `count(*)` a contaria
 * como 1. Pilha vazia é caso normal aqui, não borda rara.
 */
export const entryCountExpression = sql<number>`count(${pileEntries.entryId})`

/**
 * Toda ordem desempata por `id`, mesmo motivo de `entries.query.ts`: sem isso
 * duas pilhas iguais no critério trocam de lugar entre dois `GET` idênticos e
 * a grade pisca sem ninguém ter mexido nela.
 */
const ORDER_BY: Record<PileSort, SQL[]> = {
  updated: [desc(piles.updatedAt), desc(piles.id)],
  added: [desc(piles.createdAt), desc(piles.id)],
  // `COLLATE NOCASE` para "backlog" cair junto de "Backlog". Vale só para
  // ASCII — é o que o SQLite dá sem extensão, e a pilha com nome acentuado
  // ainda ordena depois de `z`. Decisão de i18n, quando houver.
  name: [sql`${piles.name} COLLATE NOCASE ASC`, asc(piles.id)],
  size: [sql`${entryCountExpression} DESC`, asc(piles.id)],
}

export function orderFor(sort: PileSort): SQL[] {
  return ORDER_BY[sort]
}

/**
 * Busca por texto no nome da pilha — substring, sem âncora, e escapando os
 * curingas do `LIKE` pelo mesmo motivo detalhado em `entries.query.ts`: sem o
 * `ESCAPE`, quem procura "100%" recebe tudo.
 *
 * Só o NOME, por ora. A busca desenhada no mockup também acha obras dentro das
 * pilhas e diz em quais elas estão — é endpoint próprio, e ficou para o ciclo
 * seguinte junto dos chips de escopo.
 */
export function nameContains(term: string): SQL {
  const escaped = term.replace(/[\\%_]/g, '\\$&')
  return sql`${piles.name} LIKE ${`%${escaped}%`} ESCAPE '\\'`
}

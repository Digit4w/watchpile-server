import { inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'

type EntryRow = typeof entries.$inferSelect

export type PublicEntry = Omit<EntryRow, 'userId' | 'primaryProvider'> & {
  /**
   * O endereço da arte, ou `null` quando não há de onde tirá-la.
   *
   * **O servidor manda a URL pronta**, como faz no resultado de busca: montar
   * endereço de arte no cliente seria o `if (slug === 'tmdb')` que o brief 3.10
   * recusa, e aqui seria pior — o cliente teria de saber que existe cache.
   *
   * `null` é o caso da obra digitada à mão, que **nunca ganha arte** enquanto
   * não houver como vinculá-la a um provedor (brief, 3.10). A tela cai no
   * ladrilho com a inicial, que é o quarto nível de identidade.
   */
  art: string | null
}

/**
 * A forma pública da obra — o que sai e como se decide o que sai.
 *
 * Nasceu em 01/09/2026, com o cache de arte, e o motivo é o mesmo que fez
 * `piles.public.ts` nascer: a projeção estava repetida em **dez lugares**, e
 * todos faziam a mesma coisa à mão (`const { userId: _userId, ...rest }`).
 * Acrescentar um campo derivado a dez destructuring soltos é como um deles
 * fica pra trás — e o que fica pra trás não quebra teste nenhum, só devolve
 * menos.
 */

/**
 * O endereço da rota que serve a arte daquela obra.
 *
 * `source` nomeia POR QUAL vínculo, e só entra quando quem chama sabe de um
 * específico — a listagem não sabe e nem precisa, porque ali a resposta certa é
 * sempre a do vínculo efetivo.
 */
export function artPathFor(entryId: number, source?: string): string {
  const base = `/api/entries/${entryId}/art`
  return source ? `${base}?source=${encodeURIComponent(source)}` : base
}

/**
 * Quais destas obras têm de onde tirar arte.
 *
 * **Uma consulta para a lista inteira**, e não uma por linha: a biblioteca
 * devolve dezenas de obras, e perguntar por cada uma seria o N+1 clássico num
 * caminho que roda em toda abertura de tela.
 *
 * Ter `external_id` é o bastante para dizer que **há de onde tentar** — não
 * que a arte exista. Se o provedor não tiver pôster para aquela obra, a rota
 * responde 404 e a tela cai no ladrilho, que é o mesmo destino de quem não tem
 * vínculo nenhum. Prometer menos aqui exigiria bater no provedor para montar
 * uma listagem, o que é exatamente o que o cache existe para evitar.
 */
function artSourcesAmong(entryIds: number[]): Set<number> {
  if (entryIds.length === 0) {
    return new Set()
  }

  const rows = db
    .selectDistinct({ entryId: externalIds.entryId })
    .from(externalIds)
    .where(inArray(externalIds.entryId, entryIds))
    .all()

  return new Set(rows.map(({ entryId }) => entryId))
}

/**
 * Tira o que não é do público.
 *
 * `userId` sai porque é dono; **`primaryProvider` sai porque a forma útil dele
 * já viaja em `GET /api/entries/{id}/links`**, como `chosen` ao lado de
 * `effective`. A coluna crua seria uma segunda maneira de perguntar a mesma
 * coisa, e sozinha ela nem responde: um slug fora dos vínculos é ignorado por
 * `sourceOf`, então lê-la sem a lista daria resposta errada com cara de certa.
 */
function withoutOwner({
  userId: _userId,
  primaryProvider: _primaryProvider,
  ...rest
}: EntryRow): Omit<EntryRow, 'userId' | 'primaryProvider'> {
  return rest
}

/** Uma obra só. Faz a consulta de fonte para uma linha, que é O(1) no índice. */
export function toPublicEntry(row: EntryRow): PublicEntry {
  const hasSource = artSourcesAmong([row.id]).has(row.id)
  return { ...withoutOwner(row), art: hasSource ? artPathFor(row.id) : null }
}

/** Uma lista. Uma consulta de fonte para todas, nunca uma por linha. */
export function toPublicEntries(rows: EntryRow[]): PublicEntry[] {
  const withSource = artSourcesAmong(rows.map(({ id }) => id))

  return rows.map((row) => ({
    ...withoutOwner(row),
    art: withSource.has(row.id) ? artPathFor(row.id) : null,
  }))
}

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'
import { positionBetween } from './piles.ordering.js'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Entrar e sair de uma pilha — a regra, num lugar só.
 *
 * ── Por que mora AQUI, e não na feature de obra ─────────────────────────────
 * Mesmo argumento de `piles.auto-remove.ts`: quem sabe onde uma obra se
 * encaixa numa pilha é a pilha. A folha de adicionar obra (brief, 3.17) passou
 * a escrever em `pile_entries` na mesma transação em que cria `entries`, e sem
 * este módulo a conta do índice fracionário existiria em dois lugares — o
 * handler de `POST /api/piles/:id/entries` e o de `POST /api/entries` —, que é
 * a duplicação que só se percebe quando as duas divergem.
 */

/**
 * Marca as pilhas como mexidas.
 *
 * A ordem padrão de `/piles` é "Recently updated", e conteúdo é o que uma
 * pilha tem: ganhar ou perder uma obra **é** a pilha mudar. Sem isto ela
 * receberia obra sem nunca subir na lista, e quem olhasse a tela não veria que
 * algo mudou — exatamente o argumento que `piles.auto-remove.ts` já escrevia
 * pro lado de quem sai.
 *
 * Toca só as pilhas que de fato mudaram: mexer nas outras reordenaria a tela
 * por um evento que não as tocou.
 */
export function touchPiles(pileIds: number[], tx: Tx | typeof db = db): void {
  if (pileIds.length === 0) {
    return
  }

  tx.update(piles)
    .set({ updatedAt: sql`(unixepoch())` })
    .where(inArray(piles.id, pileIds))
    .run()
}

/** A última posição ocupada na pilha, ou `null` se ela estiver vazia. */
function lastPosition(pileId: number, tx: Tx | typeof db): number | null {
  const last = tx
    .select({ position: pileEntries.position })
    .from(pileEntries)
    .where(eq(pileEntries.pileId, pileId))
    .orderBy(asc(pileEntries.position), asc(pileEntries.entryId))
    .all()
    .at(-1)

  return last?.position ?? null
}

/**
 * Põe a obra no FIM de cada pilha, pelo índice fracionário (brief, 3.14).
 *
 * **Append nunca esgota a precisão** — é sempre um passo além do último —, e é
 * por isso que este caminho não precisa do rebalanceamento que o reordenar por
 * arrasto precisa.
 *
 * **Escolher onde não cabe aqui.** Quem ordena é a tela da pilha, que tem
 * arrasto e mostra os vizinhos; uma folha de criar obra que perguntasse a
 * posição estaria pedindo uma decisão sem mostrar contra o quê.
 *
 * Ignora em silêncio a pilha em que a obra já está: o par
 * (`pile_id`, `entry_id`) é único no schema, e quem chama daqui está criando a
 * obra agora — não há duplicata possível que valha uma recusa. O handler de
 * `POST /api/piles/:id/entries` continua respondendo 409 por conta própria,
 * porque lá adicionar é a ação inteira e ficar calado esconderia o resultado.
 *
 * @returns os ids das pilhas que de fato receberam a obra.
 */
export function appendToPiles(
  entryId: number,
  pileIds: number[],
  tx: Tx | typeof db = db,
): number[] {
  const received: number[] = []

  for (const pileId of pileIds) {
    const already = tx
      .select({ id: pileEntries.id })
      .from(pileEntries)
      .where(
        and(eq(pileEntries.pileId, pileId), eq(pileEntries.entryId, entryId)),
      )
      .get()

    if (already) {
      continue
    }

    tx.insert(pileEntries)
      .values({
        pileId,
        entryId,
        position: positionBetween(lastPosition(pileId, tx), null) as number,
      })
      .run()

    received.push(pileId)
  }

  touchPiles(received, tx)
  return received
}

/**
 * Quais destes ids são pilhas de quem pediu.
 *
 * Devolve o conjunto em vez de um booleano porque quem chama precisa saber
 * **quais** faltaram para responder direito — e porque não distinguir "não
 * existe" de "é de outra pessoa" é de propósito: as duas respostas juntas são
 * o que impede descobrir o acervo alheio por tentativa.
 */
export function ownedPilesAmong(
  pileIds: number[],
  userId: number,
): Set<number> {
  if (pileIds.length === 0) {
    return new Set()
  }

  const rows = db
    .select({ id: piles.id })
    .from(piles)
    .where(and(eq(piles.userId, userId), inArray(piles.id, pileIds)))
    .all()

  return new Set(rows.map(({ id }) => id))
}

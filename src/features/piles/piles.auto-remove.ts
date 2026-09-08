import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { pileEntries } from '../../db/schema/pile-entries.js'
import { piles } from '../../db/schema/piles.js'

/**
 * Tira a obra das pilhas do usuário que pediram pra se esvaziar sozinhas
 * (`remove_when_completed`, brief 3.17).
 *
 * ── Por que mora AQUI, e não na feature de obra ─────────────────────────────
 * A regra é da pilha: é ela que carrega a opção, e é `pile_entries` que muda. O
 * handler de obra só avisa que o status virou `completed`. Se isto vivesse lá,
 * a feature de obra passaria a conhecer uma coluna de `piles` que não é dela.
 *
 * ── O que ele NÃO faz, e cada "não" é decisão ───────────────────────────────
 * **Não apaga a obra.** Mexe só em `pile_entries`; a linha de `entries` — com
 * progresso, nota e histórico — fica inteira. Furar isso perderia dado do
 * usuário em silêncio, e é a invariante que o brief 3.17 fixa em voz alta.
 *
 * **Não escreve no `event_log`.** O log é de PROGRESSO (brief, 3.11). Sair de
 * uma coleção não é progresso, e poluí-lo com movimentação de pilha estragaria
 * exatamente a estatística que ele existe pra sustentar.
 *
 * **Não é disparado por progresso.** Chegar em `12 / 12` não marca a obra como
 * concluída neste servidor — `recordProgress` não toca em status —, então o
 * único gatilho é alguém escolher `Completed`. Se um dia houver conclusão
 * automática, ela passa a chamar isto, e não a duplicar a regra.
 *
 * O filtro por `userId` é redundante com a verificação de dono que o handler já
 * fez, e fica assim mesmo: é uma condição a mais num índice, e o dia em que
 * alguém chamar isto de um caminho novo, ela é o que impede a obra de sair da
 * pilha de outra pessoa.
 *
 * @returns os ids das pilhas de onde a obra saiu — vazio no caso comum.
 */
export function dropFromAutoClearingPiles(
  entryId: number,
  userId: number,
): number[] {
  const targets = db
    .select({ id: piles.id })
    .from(piles)
    .where(and(eq(piles.userId, userId), eq(piles.removeWhenCompleted, true)))
    .all()
    .map(({ id }) => id)

  if (targets.length === 0) {
    return []
  }

  const removed = db
    .delete(pileEntries)
    .where(
      and(
        eq(pileEntries.entryId, entryId),
        inArray(pileEntries.pileId, targets),
      ),
    )
    .returning({ pileId: pileEntries.pileId })
    .all()

  if (removed.length > 0) {
    /**
     * As pilhas que perderam uma obra mudaram de conteúdo, e a ordem padrão de
     * `/piles` é "Recently updated" — sem isto, a pilha se esvaziaria sem
     * nunca subir na lista, e quem olhasse a tela não veria que algo mudou.
     *
     * Toca só as que de fato perderam alguma coisa: mexer em `updated_at` de
     * toda pilha com a opção ligada reordenaria a tela por um evento que não
     * as tocou.
     */
    db.update(piles)
      .set({ updatedAt: sql`(unixepoch())` })
      .where(
        inArray(
          piles.id,
          removed.map(({ pileId }) => pileId),
        ),
      )
      .run()
  }

  return removed.map(({ pileId }) => pileId)
}

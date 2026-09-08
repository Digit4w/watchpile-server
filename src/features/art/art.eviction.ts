/**
 * O descarte do cache de arte: quais entradas saem quando o teto é encostado.
 *
 * Regra pura, sem disco e sem banco, pelo mesmo motivo que `piles.ordering.ts`
 * é pura — é a parte que dá pra provar sem montar um servidor, e é onde os
 * erros de fronteira moram.
 */

export type CachedArt = {
  id: number
  bytes: number
  /** Epoch em milissegundos. Menor é mais antigo. */
  lastUsedAt: number
}

/**
 * As entradas que saem para caber `incoming` bytes dentro de `ceiling`.
 *
 * **LRU e não FIFO** (brief, 3.10: "descarte do menos usado"): a biblioteca que
 * se abre toda semana não pode ser expulsa pela obra adicionada ontem e nunca
 * aberta. `created_at` responderia a pergunta errada.
 *
 * **A entrada que está chegando entra na conta.** Descartar até caber o que já
 * existe e só então gravar deixaria o cache passar do teto por uma arte a cada
 * gravação — pouco, mas monotônico, e teto que só vale às vezes não é teto.
 *
 * Devolve vazio quando já cabe: no caminho comum não há o que apagar, e é o
 * caminho que roda em toda gravação.
 */
export function evictionPlan({
  entries,
  incoming,
  ceiling,
}: {
  entries: CachedArt[]
  incoming: number
  ceiling: number
}): number[] {
  const total = entries.reduce((soma, input) => soma + input.bytes, 0)
  let excess = total + incoming - ceiling

  if (excess <= 0) {
    return []
  }

  /**
   * Empata pelo `id`, que é crescente: sem desempate, duas entradas usadas no
   * mesmo segundo — o carimbo tem resolução de segundo — sairiam em ordem
   * indefinida, e o mesmo cache produziria planos diferentes.
   */
  const byUse = [...entries].sort(
    (a, b) => a.lastUsedAt - b.lastUsedAt || a.id - b.id,
  )

  const evicted: number[] = []
  for (const input of byUse) {
    if (excess <= 0) {
      break
    }
    evicted.push(input.id)
    excess -= input.bytes
  }

  return evicted
}

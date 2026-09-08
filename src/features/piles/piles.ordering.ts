/**
 * Índice fracionário para a ordem manual dentro de uma pile (brief, 3.14).
 * Inserir entre dois itens é escolher um valor entre os vizinhos, sem
 * renumerar a tabela inteira a cada arrasto.
 */
export const POSITION_STEP = 1

/**
 * Posição entre dois vizinhos. `null` de um lado significa a ponta da lista.
 *
 * Devolve `null` quando o `double` não tem mais casa entre os dois — a
 * bisseção repetida no mesmo ponto esgota a precisão depois de ~50 inserções,
 * e nesse ponto a única saída correta é renumerar a pile e tentar de novo.
 * Devolver um valor igual a um dos vizinhos deixaria a ordem indefinida em
 * silêncio, que é justamente o que o índice fracionário deveria evitar.
 */
export function positionBetween(
  before: number | null,
  after: number | null,
): number | null {
  if (before === null && after === null) {
    return 0
  }
  if (before === null) {
    return (after as number) - POSITION_STEP
  }
  if (after === null) {
    return before + POSITION_STEP
  }

  const middle = before + (after - before) / 2
  return middle > before && middle < after ? middle : null
}

/** Posições renumeradas em passo inteiro, preservando a ordem recebida. */
export function rebalancedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index * POSITION_STEP)
}

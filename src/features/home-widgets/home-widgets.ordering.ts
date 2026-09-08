export type OrderableEntry = {
  id: number
  createdAt: Date
}

/**
 * Ordem de exibição dentro de um widget (brief, 3.14 e 3.15).
 *
 * O que o usuário arrastou vem primeiro, na posição em que ele largou; o resto
 * cai em `created_at` desc — obra adicionada mais recentemente aparece antes.
 * `widget_entry_order` nunca precisa ser completo: só os itens efetivamente
 * arrastados têm linha lá.
 *
 * A escolha de pôr o arrastado ANTES do não-arrastado é deliberada: num widget
 * curado, item que você posicionou à mão não deve ser empurrado pra baixo toda
 * vez que outra obra recebe progresso.
 *
 * ── Por que `created_at`, e não `updated_at` (29/08/2026) ────────────────────
 * Era `updated_at` desc, e isso fazia a grade dançar debaixo do dedo: marcar um
 * episódio escreve na obra, `updated_at` sobe, e a carta pula pra primeira
 * posição no refetch seguinte. Quem clica `+` duas vezes seguidas clica na
 * segunda vez em outra obra.
 *
 * "Mexi nisto por último" é uma ordenação legítima e provavelmente vira opção
 * de widget um dia — mas não pode ser o default, porque conflita com a ação
 * mais frequente da tela. `created_at` não muda com escrita de progresso, então
 * a ordem fica parada enquanto o usuário trabalha.
 *
 * O desempate por `id` desc existe pelo mesmo motivo: o seed cria várias obras
 * no mesmo segundo, e sem ele a ordem entre elas ficaria à mercê do SQLite.
 */
export function orderForWidget<T extends OrderableEntry>(
  entries: T[],
  manualPositions: Map<number, number>,
): T[] {
  const pinned: T[] = []
  const loose: T[] = []

  for (const entry of entries) {
    ;(manualPositions.has(entry.id) ? pinned : loose).push(entry)
  }

  pinned.sort(
    (a, b) =>
      (manualPositions.get(a.id) as number) -
      (manualPositions.get(b.id) as number),
  )
  loose.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
  )

  return [...pinned, ...loose]
}

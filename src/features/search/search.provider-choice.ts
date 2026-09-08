/**
 * Quem responde a uma busca — a regra que fechou em 01/09/2026, desenhando
 * `/search` (brief, 3.10; design system, seção 5).
 *
 * **Uma busca = um tipo = UM provedor.** A concatenação que existia aqui antes
 * era indistinguível do certo enquanto todo tipo tivesse um provedor só, e
 * quebrava no primeiro que tivesse dois: a mesma obra voltava duas vezes, com
 * ids externos diferentes, numa lista sem ranking comum. Mesclar não era saída
 * — exigiria desduplicar entre catálogos que não compartilham identificador, e
 * casar por título está descartado.
 *
 * A precedência tem três degraus, e o terceiro é o que separa esta função de
 * `effectiveProviderOf`:
 *
 * 1. **o pedido explícito** — é a troca de fonte da tela. Só vale se aquele
 *    provedor de fato servir o tipo; pedir outro é pedido inválido, não uma
 *    indisponibilidade
 * 2. **o efetivo** (`media_types.default_provider_slug`, ou o único associado)
 * 3. **o primeiro por slug**, quando há dois ou mais e ninguém definiu um padrão
 *
 * O degrau 3 parece contradizer `effectiveProviderOf`, que se recusa a chutar
 * o primeiro — e não contradiz, porque as duas respondem perguntas diferentes.
 * Lá a pergunta é "quem o admin definiu como PADRÃO deste tipo?", uma
 * designação persistente que vale para toda busca daqui em diante, e chutá-la
 * por ordem alfabética seria decidir no lugar dele. Aqui a pergunta é "quem
 * responde ESTA busca agora?", e a tela nomeia quem respondeu e oferece
 * trocar — a escolha fica visível e é desfeita num clique. Chute invisível é
 * que seria o problema.
 *
 * ── O vocabulário mudou em 02/09/2026, e o comportamento não ────────────────
 * O que esta função chamava de `canônico` virou `effective`, alinhando com o
 * par que os vínculos de obra fixaram no dia anterior — `primary` é a escolha
 * crua, `effective` é o que vale depois de resolvida. O nome antigo dizia
 * "de onde vêm título e campos", e essa metade saiu do escopo em 02/09: de
 * qual vínculo a OBRA fala é `entries.primary_provider`, não daqui.
 */
export type ProviderChoice =
  | { ok: true; provider: string }
  /** O tipo não tem provedor nenhum — a recusa que o brief manda gritar. */
  | { ok: false; reason: 'no-provider' }
  /** Pediram um provedor que não serve este tipo. Pedido inválido, não 503. */
  | { ok: false; reason: 'not-associated'; provider: string }

export function chooseSearchProvider({
  requested,
  effective,
  associated,
}: {
  /** O `provider` da query, quando a tela trocou de fonte. */
  requested: string | null
  /** `effectiveProviderOf` já resolvido — nulo é estado legítimo. */
  effective: string | null
  associated: readonly string[]
}): ProviderChoice {
  if (associated.length === 0) {
    return { ok: false, reason: 'no-provider' }
  }

  if (requested) {
    return associated.includes(requested)
      ? { ok: true, provider: requested }
      : { ok: false, reason: 'not-associated', provider: requested }
  }

  if (effective && associated.includes(effective)) {
    return { ok: true, provider: effective }
  }

  /**
   * Ordenado, e não "o primeiro que o banco devolveu": sem `ORDER BY` a
   * resposta pode mudar entre duas consultas idênticas, e a fonte da busca
   * trocando sozinha entre teclas é o tipo de coisa que ninguém consegue
   * reproduzir depois.
   */
  const first = [...associated].sort()[0]
  return first
    ? { ok: true, provider: first }
    : { ok: false, reason: 'no-provider' }
}

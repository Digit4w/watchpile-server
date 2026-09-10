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
 * A precedência tem QUATRO degraus, e o último é o que separa esta função de
 * `effectiveProviderOf`:
 *
 * 1. **o pedido explícito** — é a troca de fonte da tela. Só vale se aquele
 *    provedor de fato servir o tipo; pedir outro é pedido inválido, não uma
 *    indisponibilidade
 * 2. **a preferência de QUEM BUSCA** (`preferred_search_sources`), entrada em
 *    10/09/2026 — ver abaixo
 * 3. **o efetivo** (`media_types.default_provider_slug`, ou o único associado)
 * 4. **o primeiro por slug**, quando há dois ou mais e ninguém definiu um padrão
 *
 * ── Por que a preferência vem ANTES do efetivo, e não depois ────────────────
 * A régua de 30/08 põe as duas de lados diferentes sem arbitrar: o efetivo é
 * *"quem responde a busca NESTE SERVIDOR"*, decisão do admin; a preferência é
 * *"com que fonte EU busco"*, de quem busca. Quando as duas existem, quem está
 * na frente da tela é quem escolheu por último e sabe o que quer — e o admin
 * não perde nada, porque o padrão dele continua valendo pra todo mundo que
 * nunca opinou, que é o estado normal.
 *
 * **Ela é validada antes de chegar aqui** (`preferredSourceFor` faz `INNER JOIN`
 * com a junção), então uma preferência por um par que deixou de existir chega
 * nula e o degrau seguinte responde — em vez de virar a recusa
 * `not-associated`, que culparia a pessoa por uma escolha antiga que ela não
 * tem como ver.
 *
 * O degrau 4 parece contradizer `effectiveProviderOf`, que se recusa a chutar
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
  preferred,
  effective,
  associated,
}: {
  /** O `provider` da query, quando a tela trocou de fonte. */
  requested: string | null
  /**
   * A fonte que ESTE usuário prefere para este tipo, já validada contra a
   * junção. Nulo quando ele nunca escolheu — que é o estado normal.
   */
  preferred: string | null
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

  if (preferred && associated.includes(preferred)) {
    return { ok: true, provider: preferred }
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

/**
 * O vocabulário de notificações — o que o produto sabe avisar.
 *
 * **É `z.enum` no contrato, não uma lista solta no cliente**, pela mesma razão
 * do acervo de ícones (design system, seção 5): a frase de cada `kind` é
 * montada pelo cliente, e um `kind` que o cliente não conhece renderizaria uma
 * linha vazia. Fechado no contrato, o `switch` do cliente vira erro de
 * compilação no dia em que um `kind` novo nascer, em vez de um buraco em
 * produção.
 *
 * O custo é que acrescentar aviso vira mudança de contrato — e é o certo, pelo
 * mesmo motivo do acervo: o vocabulário é infraestrutura do produto, não
 * conteúdo de usuário.
 */
export const NOTIFICATION_KINDS = [
  /**
   * Provedor que serve algum tipo e não tem credencial nenhuma.
   * `params`: `{ provider, providerSlug }`.
   */
  'provider-missing-key',
  /**
   * Provedor rodando na chave que o produto embarca (brief, 3.10). Não é
   * defeito — a instalação funciona —, e é por isso que ele é `warning` e não
   * `danger`: "o barulho do sinal acompanha o tamanho do fato".
   * `params`: `{ provider, providerSlug }`.
   */
  'provider-embedded-key',
  /**
   * O cache de arte encostou no teto e começou a descartar (brief, 3.10).
   * `params`: `{ limitBytes }`.
   */
  'art-cache-full',
  /**
   * Uma importação terminou (brief, 3.12).
   * `params`: `{ source, added, problemCount }`.
   *
   * **É o primeiro aviso de audiência `user` do app** — os três acima são todos
   * de instância. Também é o primeiro uso do degrau `info`, que existe desde
   * 06/09/2026 porque "o import terminou" pintado de `warning` seria a régua do
   * sinal virada contra si mesma (design system, seção 5). O exemplo que
   * justificou o degrau virou o emissor dele.
   *
   * **Cancelar não emite nada**: quem apertou `Stop` está olhando a tela, e a
   * notificação existe pra quem não estava.
   */
  'import-finished',
  /**
   * Uma importação não aconteceu (brief, 3.12).
   * `params`: `{ source, reason }` — `reason` é o `ImportFailureKind`, que é o
   * que deixa a frase mudar entre "confira o nome do perfil" e "o serviço não
   * respondeu; tente mais tarde".
   *
   * `warning` e não `danger`: a pessoa precisa refazer o import — há o que
   * fazer —, mas nada quebrou na instalação.
   */
  'import-failed',
  /**
   * Há uma versão mais nova publicada (brief, 3.9).
   * `params`: `{ version, url }`.
   *
   * **`info` e não `warning`**: nada está quebrado, e o barulho do sinal
   * acompanha o tamanho do fato — pintar de âmbar uma instalação que está
   * funcionando é a régua do sinal virada contra si mesma. É o segundo uso do
   * degrau neutro, depois de `import-finished`.
   *
   * **A `dedupeKey` carrega a VERSÃO**, e é isso que faz o aviso nascer uma vez
   * por versão em vez de uma por boot: dispensar `0.2.0` continua dispensado
   * depois de um `docker restart`, e `0.3.0` chega como aviso novo. E é o que
   * faz a condição se dispensar sozinha ao atualizar — a versão que a
   * instalação agora tem deixa de estar entre as verdadeiras.
   */
  'update-available',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * A chave de dedupe carrega o ESCOPO INTEIRO, e não é o índice que o compõe.
 *
 * O motivo é mecânico e cala: em SQLite dois `NULL` são **distintos** num
 * índice único, e `user_id` é nulo justamente na notificação de instância — um
 * índice `(user_id, dedupe_key)` não deduplicaria nada exatamente onde a dedupe
 * importa, sem erro nenhum.
 *
 * `subject` é o que faz duas instâncias do mesmo `kind` serem dois fatos: dois
 * provedores sem chave são dois avisos, não um.
 */
export function dedupeKey(
  scope: 'instance' | `user:${number}`,
  kind: NotificationKind,
  subject?: string,
): string {
  return subject ? `${scope}:${kind}:${subject}` : `${scope}:${kind}`
}

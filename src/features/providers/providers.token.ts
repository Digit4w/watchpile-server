/**
 * O token de um provedor `oauth-client-credentials`, guardado até perto de
 * vencer.
 *
 * ── Por que guardar, e por que em MEMÓRIA ──────────────────────────────────
 * O token da Twitch (auth do IGDB) vale cerca de **60 dias**. Pedir um a cada
 * busca bateria no endpoint deles milhares de vezes por um valor que não mudou,
 * e ainda somaria uma ida à rede na frente de toda consulta.
 *
 * Em memória pelo mesmo motivo do limitador (`providers.limiter.ts`): o
 * Watchpile é um processo só servindo um arquivo SQLite (brief, 3.1), não há
 * segunda instância com quem coordenar, e reiniciar custa **uma** troca de
 * token. Guardar em tabela teria um preço que o limitador não tem: o token é
 * derivado do segredo, e gravá-lo faria uma **segunda cópia** do material
 * secreto viajar dentro do `.db` do backup — contra a regra de a credencial
 * morar num lugar só.
 *
 * ── O que ele NÃO faz ──────────────────────────────────────────────────────
 * Não renova em segundo plano e não tem timer. Quem descobre que o token venceu
 * é a próxima requisição, que é também quem precisa dele — a mesma escolha
 * oportunista do descarte do cache de resposta.
 */

type Stored = {
  token: string
  /** Instante em que ele deixa de ser usado por aqui, não o que a Twitch diz. */
  expiraEm: number
}

const tokens = new Map<string, Stored>()

/**
 * A folga antes do vencimento anunciado.
 *
 * Um token que vence "agora" já venceu para a requisição que está a caminho: o
 * relógio nosso e o deles não são o mesmo, e entre decidir usá-lo e ele chegar
 * do outro lado passa uma viagem de rede. Um minuto é o que o Yamtrack usa, e é
 * generoso perto de uma validade de sessenta dias.
 */
const SLACK_MS = 60_000

export type TokenOutcome =
  | { ok: true; token: string }
  /**
   * O provedor recusou a troca — id ou secret errados, aplicação suspensa.
   *
   * **Não carrega a mensagem dele**, pela mesma regra do "testar conexão": a
   * requisição de token leva o secret na query, e repetir o texto do erro seria
   * o segredo saindo por um caminho que ninguém audita.
   */
  | { ok: false; reason: 'refused'; status: number }
  /** A rede caiu, ou o endpoint de token não respondeu no prazo. */
  | { ok: false; reason: 'unreachable' }

/** Esquece o token de um provedor. Ver `forgetToken` para quando isso importa. */
export function forgetToken(providerSlug: string): void {
  tokens.delete(providerSlug)
}

/** Só para teste: zera tudo entre casos. */
export function resetTokens(): void {
  tokens.clear()
}

/**
 * O token que está valendo, trocando id + secret por um novo quando preciso.
 *
 * O par vai na **query**, não no corpo, que é o que o endpoint da Twitch aceita
 * — verificado ao vivo com credencial de mentira: ele responde `400
 * {"status":400,"message":"invalid client"}`, ou seja, leu os parâmetros e
 * recusou o par, em vez de reclamar do formato.
 */
export async function tokenFor({
  providerSlug,
  tokenUrl,
  clientId,
  clientSecret,
  timeoutMs,
  fetchImpl = fetch,
  agora = Date.now(),
}: {
  providerSlug: string
  tokenUrl: string
  clientId: string
  clientSecret: string
  timeoutMs: number
  fetchImpl?: typeof fetch
  agora?: number
}): Promise<TokenOutcome> {
  const stored = tokens.get(providerSlug)
  if (stored && stored.expiraEm > agora) {
    return { ok: true, token: stored.token }
  }

  const url = new URL(tokenUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)
  url.searchParams.set('grant_type', 'client_credentials')

  let body: unknown
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return { ok: false, reason: 'refused', status: response.status }
    }

    body = await response.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  const read = body as { access_token?: unknown; expires_in?: unknown } | null
  const token = typeof read?.access_token === 'string' ? read.access_token : ''
  if (!token) {
    /**
     * 200 sem token dentro é o provedor respondendo outra coisa — uma página de
     * portal cativo, um proxy no meio. Contar como recusa é mais honesto que
     * guardar string vazia e falhar na requisição seguinte, longe daqui.
     */
    return { ok: false, reason: 'refused', status: 200 }
  }

  /**
   * `expires_in` vem em SEGUNDOS. Sem ele — provedor que não anuncia validade —
   * o token vale só para esta requisição: guardar sem saber até quando é
   * escolher um número por conta própria, que é o que o `timeout_ms` veio tirar
   * do produto.
   */
  const seconds =
    typeof read?.expires_in === 'number' ? read.expires_in : undefined
  if (seconds !== undefined) {
    tokens.set(providerSlug, {
      token,
      expiraEm: agora + Math.max(0, seconds * 1000 - SLACK_MS),
    })
  }

  return { ok: true, token }
}

import type { AuthStyle, EndpointSpec } from '../../db/schema/providers.js'
import { DEFAULT_TIMEOUT_MS } from '../../db/schema/providers.js'
import { type BodyVars, renderBody } from './providers.body.js'
import { resolveCredential } from './providers.credentials.js'
import { tokenFor } from './providers.token.js'

export type PreparedRequest = {
  url: string
  headers: Record<string, string>
  /**
   * `POST` quando o endpoint declara corpo, `GET` quando não — derivado, nunca
   * declarado à parte. Ver `EndpointSpec.body`.
   */
  method: 'GET' | 'POST'
  /** O corpo já serializado no dialeto do provedor. Ausente num `GET`. */
  body?: string
}

export type PrepareResult =
  | { ok: true; request: PreparedRequest }
  /** Falta credencial que a definição declara precisar. */
  | { ok: false; reason: 'missing-credential'; credential: string }
  /** Estilo declarado que este binário ainda não executa. */
  | { ok: false; reason: 'unsupported-auth-style'; style: string }
  /**
   * O provedor recusou trocar id + secret por um token.
   *
   * **É diferente de credencial FALTANDO**, e a diferença vai pra tela: falta
   * quer dizer "preencha"; recusa quer dizer "o que está preenchido não vale".
   * Sem separar, um secret rotacionado se leria como campo em branco, e o admin
   * olharia pro formulário cheio sem entender o que a tela quer dele.
   */
  | { ok: false; reason: 'token-refused'; status: number }
  /** A troca de token não chegou ao provedor — rede, DNS, prazo estourado. */
  | { ok: false; reason: 'token-unreachable' }

/**
 * Monta a requisição a partir da DEFINIÇÃO — URL base, endpoint, query fixa,
 * mais a credencial aplicada no lugar que o estilo de auth manda.
 *
 * É a peça que faz o provedor ser dado e não código (brief, 3.10): trocar o
 * TMDB da v3 (chave em query) pra v4 (bearer em header) é editar uma linha da
 * definição, não escrever um caso novo aqui.
 *
 * **Vive separada dos handlers de propósito.** O "testar conexão" deste ciclo e
 * o cliente genérico do próximo precisam exatamente da mesma coisa, e a
 * alternativa — cada um montando a sua — é como as duas pontas divergem sobre
 * onde a chave entra.
 */
export async function prepareRequest({
  providerSlug,
  baseUrl,
  auth,
  endpoint,
  storedCredentials,
  extraQuery = {},
  accept,
  bodyVars = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: {
  providerSlug: string
  baseUrl: string
  auth: AuthStyle
  endpoint: EndpointSpec
  storedCredentials: Record<string, string>
  /** Query do chamador — o termo de busca, o idioma, o filtro de adulto. */
  extraQuery?: Record<string, string>
  /** O `Accept` do provedor. Ausente cai em `application/json`. */
  accept?: string
  /**
   * O que os marcadores do corpo recebem — `term`, `id`, `option:<chave>`.
   *
   * A substituição acontece AQUI e não no chamador pelo mesmo motivo que a
   * credencial: são quatro os chamadores (busca, detalhe, unidades e o testar
   * conexão), e o dia em que um deles montasse o corpo sozinho é o dia em que
   * os quatro deixam de concordar sobre como o termo é escapado.
   */
  bodyVars?: BodyVars
  /**
   * O prazo do provedor, usado só pela troca de token.
   *
   * Ausente cai no padrão, e isso não é descuido: quatro dos seis provedores não
   * chegam neste caminho, e obrigá-los a passar um número que não vão usar
   * espalharia ruído por toda chamada. Quem tem `oauth-client-credentials`
   * passa o da definição, como o resto do motor já faz.
   */
  timeoutMs?: number
  /** Injetável só para teste; a troca de token usa o `fetch` global do Node. */
  fetchImpl?: typeof fetch
}): Promise<PrepareResult> {
  // `baseUrl` sem barra final e `path` com barra inicial é a forma que a
  // definição do TMDB usa. Aparar os dois lados evita `//` no meio da URL, que
  // alguns provedores tratam como caminho diferente.
  const url = new URL(
    `${baseUrl.replace(/\/+$/, '')}/${endpoint.path.replace(/^\/+/, '')}`,
  )

  for (const [key, value] of Object.entries({
    ...endpoint.query,
    ...extraQuery,
  })) {
    url.searchParams.set(key, value)
  }

  /**
   * `application/json` é o padrão porque é o que TMDB, Jikan e Open Library
   * querem. Quem fala outro dialeto declara — ver `ProviderEndpoints.accept`.
   */
  const headers: Record<string, string> = {
    Accept: accept ?? 'application/json',
  }

  /**
   * O corpo é montado ANTES dos ramos de auth porque ele não depende de
   * nenhum deles — e montá-lo dentro de cada `return` seria a duplicação que
   * um dia diverge. `Content-Type` sai do dialeto, nunca da definição: o
   * provedor que declara `apicalypse` já disse `text/plain` ao dizer isso.
   */
  const body = endpoint.body ? renderBody(endpoint.body, bodyVars) : undefined
  if (body) {
    headers['Content-Type'] = body.contentType
  }

  const ready = (): PrepareResult => ({
    ok: true,
    request: {
      url: url.toString(),
      headers,
      method: body ? 'POST' : 'GET',
      ...(body ? { body: body.text } : {}),
    },
  })

  /**
   * Sem credencial não há o que resolver, e por isso este ramo vem ANTES da
   * cadeia de precedência: chamar `resolveCredential` com uma chave que a
   * definição não declara devolveria "faltando" pra um provedor que não pede
   * nada, e a busca recusaria com a frase errada.
   */
  if (auth.style === 'none') {
    return ready()
  }

  if (auth.style === 'query-key' || auth.style === 'header-key') {
    const { value } = resolveCredential(
      providerSlug,
      auth.credential,
      storedCredentials,
    )
    if (!value) {
      return {
        ok: false,
        reason: 'missing-credential',
        credential: auth.credential,
      }
    }

    if (auth.style === 'query-key') {
      url.searchParams.set(auth.param, value)
    } else {
      headers[auth.header] = `${auth.prefix ?? ''}${value}`
    }

    return ready()
  }

  if (auth.style === 'oauth-client-credentials') {
    /**
     * **As DUAS credenciais são checadas antes de qualquer ida à rede**, e a
     * que falta é a que a tela nomeia. Mandar um par pela metade ao endpoint de
     * token devolveria "invalid client" — verificado ao vivo —, e essa frase
     * não distingue "faltou preencher" de "está errado".
     */
    const id = resolveCredential(
      providerSlug,
      auth.credentials.id,
      storedCredentials,
    )
    if (!id.value) {
      return {
        ok: false,
        reason: 'missing-credential',
        credential: auth.credentials.id,
      }
    }

    const secret = resolveCredential(
      providerSlug,
      auth.credentials.secret,
      storedCredentials,
    )
    if (!secret.value) {
      return {
        ok: false,
        reason: 'missing-credential',
        credential: auth.credentials.secret,
      }
    }

    const obtained = await tokenFor({
      providerSlug,
      tokenUrl: auth.tokenUrl,
      clientId: id.value,
      clientSecret: secret.value,
      timeoutMs,
      fetchImpl,
    })

    if (!obtained.ok) {
      return obtained.reason === 'refused'
        ? { ok: false, reason: 'token-refused', status: obtained.status }
        : { ok: false, reason: 'token-unreachable' }
    }

    headers[auth.header] = `${auth.prefix ?? ''}${obtained.token}`

    /**
     * **O client id viaja junto do token, num header próprio** — e isso é
     * exigência do IGDB, não do OAuth. Ver `AuthStyle.idHeader`: o 401 deles
     * diz literalmente "Ensure you are sending Authorization and Client-ID as
     * headers".
     */
    if (auth.idHeader) {
      headers[auth.idHeader] = id.value
    }

    return ready()
  }

  /**
   * Estilo que a definição declara e este binário não executa.
   *
   * Inalcançável hoje — a união é fechada e os quatro ramos estão cobertos —,
   * mas continua devolvendo recusa nomeada em vez de lançar: um banco semeado
   * por versão mais nova pode trazer estilo que este binário não conhece, e
   * nesse dia a resposta certa é uma frase, não um 500.
   */
  return {
    ok: false,
    reason: 'unsupported-auth-style',
    // A união está toda coberta acima, então aqui `auth` é `never` para o
    // compilador. O molde afirma o que o banco pode trazer e o binário não.
    style: (auth as { style: string }).style,
  }
}

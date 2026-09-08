import type { FieldMap } from '../../db/schema/providers.js'
import { prepareRequest } from './providers.auth.js'
import { cacheKeyFor, readCache, writeCache } from './providers.cache.js'
import {
  artUrl,
  asString,
  pathWithId,
  readPath,
  yearOf,
} from './providers.client.js'
import { awaitToken } from './providers.limiter.js'
import type { ProviderRow, TypeBinding } from './providers.query.js'
import { prose, subtypeLabel } from './providers.text.js'
import { forgetToken } from './providers.token.js'

/**
 * O detalhe de UMA obra no provedor (brief, 3.10).
 *
 * ── Por que existe separado da busca ────────────────────────────────────────
 * `searchProvider` responde uma LISTA a partir de um termo; isto responde UMA
 * obra a partir de um id. São endpoints diferentes na definição (`search` e
 * `detail`) e perguntas diferentes — e o resultado tem campos que a busca não
 * traz, porque catálogo grande não devolve sinopse inteira numa listagem.
 *
 * Nasceu extraído de `art.fetch.ts` em 01/09/2026, quando a tela de detalhe
 * passou a precisar do mesmo JSON que o cache de arte já buscava. Duas
 * chamadas ao mesmo endpoint com dois parsers seria a duplicação que só se
 * percebe quando as duas divergem.
 *
 * ── O que ele NÃO faz ───────────────────────────────────────────────────────
 * Não tenta de novo e não enfileira. A resposta passa pelo **mesmo cache** da
 * busca, então a segunda visita à mesma obra não gasta cota nenhuma.
 */

export type DetailFailure =
  | 'not-configured'
  | 'rate-limited'
  | 'provider-error'
  | 'unreachable'
  | 'not-found'

export type DetailOutcome =
  | { ok: true; body: unknown; cached: boolean }
  | { ok: false; reason: DetailFailure }

export async function fetchDetail({
  provider,
  binding,
  externalId,
  pathOverride = null,
  waitForTokenMs = 0,
  fetchImpl = fetch,
}: {
  provider: ProviderRow
  /**
   * O par (tipo, provedor), que é quem sabe QUAL detalhe ler.
   *
   * O TMDB obriga: `/movie/{id}` e `/tv/{id}` são rotas diferentes, e o
   * endpoint do provedor só pode ser uma delas — pedir o detalhe de uma série
   * pelo caminho de filme traz outra obra com o mesmo id. Ausente cai no do
   * provedor, que é o caso de quem tem uma rota só.
   */
  binding?: TypeBinding | null
  externalId: string
  /**
   * Outro endpoint DO MESMO provedor, quando o que se quer não é o detalhe.
   *
   * Os vínculos do Kitsu moram em `/{tipo}/{id}/media-relationships`, e o que
   * muda em relação ao detalhe é só o caminho: mesma auth, mesmo cache, mesmo
   * limitador, mesmo tratamento de `401` e de `404`. Escrever uma segunda
   * função de busca seria a duplicação que um dia diverge — e ela divergiria
   * justamente no tratamento de erro, que é o que este repo passou o dia
   * consertando.
   */
  pathOverride?: string | null
  /**
   * Quanto quem pediu aguenta ESPERAR por uma ficha do limitador. Zero — o
   * padrão — é o comportamento de sempre: recusa na hora.
   *
   * Quem passa um número é a arte (`art.fetch.ts`), e a régua está em
   * `awaitToken`: a busca não espera porque a tecla seguinte dispara outra
   * consulta; um `<img>` não tem tecla seguinte.
   */
  waitForTokenMs?: number
  /** Injetável só para teste; produção usa o `fetch` global do Node. */
  fetchImpl?: typeof fetch
}): Promise<DetailOutcome> {
  const path = pathWithId(
    pathOverride ?? binding?.detailPath ?? provider.endpoints.detail.path,
    externalId,
  )

  // Id com `..` dentro: não é obra que não existe, é caminho que tentaria sair
  // do endpoint. `not-found` é a resposta certa — a obra pedida não existe.
  if (path === null) {
    return { ok: false, reason: 'not-found' }
  }

  const prepared = await prepareRequest({
    providerSlug: provider.slug,
    baseUrl: provider.baseUrl,
    auth: provider.auth,
    endpoint: {
      ...provider.endpoints.detail,
      path: path,
      // O corpo do PAR vence o do provedor, como o caminho — e aqui o motivo é
      // o mesmo do 1396 do TMDB: no AniList, pedir um id de anime com
      // `type: MANGA` devolve 404, verificado ao vivo.
      body: binding?.detailBody ?? provider.endpoints.detail.body,
    },
    storedCredentials: provider.credentialValues,
    // O prazo e o `fetch` seguem para a TROCA DE TOKEN, que é uma ida à rede
    // antes da requisição. Sem repassá-los, o estilo `oauth-client-credentials`
    // usaria o `fetch` global — e foi assim que o teste dele bateu no provedor
    // de verdade em vez de no dublê.
    timeoutMs: provider.timeoutMs,
    fetchImpl,
    accept: provider.endpoints.accept,
    bodyVars: { id: externalId },
  })

  if (!prepared.ok) {
    // Mesma separação da busca: recusa na troca de token é falha do pedido,
    // não campo em branco. O enum do detalhe ainda não divide `4xx` de `5xx`
    // (ver `server/CLAUDE.md`), então os dois caem no motivo que já existe.
    if (prepared.reason === 'token-refused') {
      return { ok: false, reason: 'provider-error' }
    }
    if (prepared.reason === 'token-unreachable') {
      return { ok: false, reason: 'unreachable' }
    }
    return { ok: false, reason: 'not-configured' }
  }

  const keyParam =
    provider.auth.style === 'query-key' ? provider.auth.param : null
  const key = cacheKeyFor(prepared.request.url, keyParam, prepared.request.body)

  const cached = readCache(provider.slug, key)
  if (cached !== null) {
    try {
      return { ok: true, body: JSON.parse(cached), cached: true }
    } catch {
      return { ok: false, reason: 'provider-error' }
    }
  }

  if (!(await awaitToken(provider.slug, provider.rateLimit, waitForTokenMs))) {
    return { ok: false, reason: 'rate-limited' }
  }

  /**
   * **O `try` embrulha a REDE, e só ela** — corrigido em 02/09/2026. Ele
   * embrulhava mais duas coisas, e as duas mentiam:
   *
   * O `writeCache`, que é banco NOSSO — falha dele saía daqui como
   * `unreachable`, apontando pra rede um defeito a duas tabelas de distância.
   * Fora do `try` ela sobe e vira 500 com stack no log, que é onde falha nossa
   * pertence.
   *
   * E o `JSON.parse`, que dava **duas respostas pro mesmo corpo**: vindo do
   * cache, um corpo malformado devolvia `provider-error`; vindo da rede, o
   * mesmo corpo caía aqui e devolvia `unreachable`. O motivo dependia de por
   * onde a resposta passou, que é como duas contas da mesma coisa divergem.
   */
  let body: string
  try {
    const response = await fetchImpl(prepared.request.url, {
      method: prepared.request.method,
      body: prepared.request.body,
      headers: prepared.request.headers,
      signal: AbortSignal.timeout(provider.timeoutMs),
    })

    /**
     * **404 do provedor é `not-found`, não `provider-error`**, e a diferença
     * chega à tela: o id não existe no catálogo dele — link velho, obra
     * removida — e isso não é falha de ninguém. Tratar como erro daria "tente
     * de novo" pra uma coisa que não muda tentando.
     */
    if (response.status === 404) {
      return { ok: false, reason: 'not-found' }
    }
    // Ver o comentário em `providers.client.ts`: token revogado continuaria
    // válido aqui por ~60 dias.
    if (response.status === 401) {
      forgetToken(provider.slug)
    }
    if (!response.ok) {
      return { ok: false, reason: 'provider-error' }
    }

    body = await response.text()
  } catch {
    // A mensagem não sobe: a URL montada carrega a chave na query quando o
    // estilo é `query-key`. Mesma regra do "testar conexão".
    return { ok: false, reason: 'unreachable' }
  }

  writeCache(provider.slug, key, body)

  // O MESMO motivo do caminho cacheado, logo acima: corpo que não é JSON é
  // resposta ruim do provedor, venha ela de onde vier.
  try {
    return { ok: true, body: JSON.parse(body), cached: false }
  } catch {
    return { ok: false, reason: 'provider-error' }
  }
}

export type MappedDetail = {
  externalId: string
  title: string
  year: number | null
  synopsis: string | null
  art: string | null
  /** O que a obra é dentro do tipo. Ver `FieldMap.subtype`. */
  subtype: string | null
  total: number | null
  /** A nota do provedor, e quantos votaram. Contexto, não dado da obra. */
  score: number | null
  votes: number | null
  links: { label: string; url: string }[]
}

/**
 * O JSON do provedor virando a forma que a tela consome, pelo `field_map`.
 *
 * O mesmo mapa da busca, e é isso que faz provedor novo não precisar de código
 * novo: a definição diz onde cada campo está, e isto vai lá buscar.
 *
 * `externalId` cai no id que foi pedido quando o mapa não o encontra: alguns
 * provedores não repetem o id dentro da resposta de detalhe, e o id que
 * chegou na URL é resposta melhor que nulo.
 */
/**
 * Qual mapa lê a resposta de DETALHE — em um lugar, porque são dois os
 * chamadores (a tela de detalhe e o cache de arte) e eles têm que concordar.
 *
 * Precedência por especificidade: o mapa de detalhe do par, depois o de busca
 * do par, depois o do provedor. O TMDB não declara o primeiro e continua onde
 * estava.
 */
export function detailFieldMapOf(
  provider: { fieldMap: FieldMap },
  binding?: TypeBinding | null,
): FieldMap {
  return binding?.detailFieldMap ?? binding?.fieldMap ?? provider.fieldMap
}

export function mapDetail(
  body: unknown,
  provider: ProviderRow,
  requestedId: string,
  /**
   * O mapa do PAR, quando há. Mesmo motivo do `detail_path`: série devolve
   * `name` e `first_air_date` onde filme devolve `title` e `release_date`, e
   * usar o do provedor num dos dois lê os campos errados em silêncio — foi
   * assim que o ano de uma série virou "Year unknown".
   */
  fieldMapDoPar?: FieldMap | null,
): MappedDetail {
  const fieldMap = fieldMapDoPar ?? provider.fieldMap

  return {
    externalId: asString(readPath(body, fieldMap.externalId)) ?? requestedId,
    title: asString(readPath(body, fieldMap.title)) ?? '',
    year: fieldMap.year
      ? yearOf(readPath(body, fieldMap.year), fieldMap.yearFormat)
      : null,
    synopsis: fieldMap.synopsis
      ? prose(asString(readPath(body, fieldMap.synopsis)), provider.endpoints)
      : null,
    subtype: fieldMap.subtype
      ? subtypeLabel(
          asString(readPath(body, fieldMap.subtype)),
          // As siglas vêm do MESMO mapa que disse onde ler o campo — é por isso
          // que elas moram nele e não numa coluna à parte.
          fieldMap.subtypeAcronyms,
        )
      : null,
    art: fieldMap.art
      ? artUrl(asString(readPath(body, fieldMap.art)), provider.artTemplate)
      : null,
    score: fieldMap.score
      ? Number.parseFloat(asString(readPath(body, fieldMap.score)) ?? '') ||
        null
      : null,
    votes: fieldMap.votes
      ? Number.parseInt(asString(readPath(body, fieldMap.votes)) ?? '', 10) ||
        null
      : null,
    /**
     * Só os que o provedor de fato devolveu: um link declarado cujo campo veio
     * vazio simplesmente não existe — e não vira um item morto na caixa.
     */
    links: (fieldMap.links ?? [])
      .map(({ label, path, template }) => {
        const raw = asString(readPath(body, path))
        if (!raw) {
          return null
        }
        return {
          label,
          url: template ? template.replace('{id}', raw) : raw,
        }
      })
      .filter((link) => link !== null),
    /**
     * **`|| null` e NÃO `?? null`, e a diferença é medida.**
     *
     * O `||` derruba o zero junto com o `NaN`, e é isso que faz o
     * `num_chapters: 0` do MyAnimeList — que significa *desconhecido*, não zero
     * (Berserk em publicação devolve 0; Monster, terminado, devolve 162) — ler
     * como total ausente em vez de "380 / 0" na tela.
     *
     * Vale universalmente e não é peculiaridade de um provedor: obra com zero
     * episódios não existe, então zero nunca é um total legítimo. Trocar por
     * `??` "modernizando" quebraria o mangá em publicação em silêncio.
     */
    total: fieldMap.total
      ? Number.parseInt(asString(readPath(body, fieldMap.total)) ?? '', 10) ||
        null
      : null,
  }
}

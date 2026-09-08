import type { UnitMap } from '../../db/schema/providers.js'
import { prepareRequest } from './providers.auth.js'
import { cacheKeyFor, readCache, writeCache } from './providers.cache.js'
import { artUrl, asString, pathWithId, readPath } from './providers.client.js'
import type { DetailFailure } from './providers.detail.js'
import { takeToken } from './providers.limiter.js'
import type { ProviderRow, TypeBinding } from './providers.query.js'
import { forgetToken } from './providers.token.js'

/**
 * As UNIDADES de uma obra — episódios de uma série, capítulos de um mangá
 * (brief, 3.10).
 *
 * ── Por que não se chama "episódio" ─────────────────────────────────────────
 * O que generaliza entre os provedores é *partes numeradas, opcionalmente
 * agrupadas*: o TMDB agrupa episódios por temporada, o Jikan devolve episódio
 * numa lista plana, mangá tem capítulo agrupável por volume, e jogo e livro não
 * têm nada. Assar "season/episode" no contrato traria de volta o "seis de tudo"
 * que a 3.12 recusou — `episodes` guardando capítulo no dia do mangá.
 *
 * "Unidade" é o vocabulário que o modelo já tem: `media_types.progress_unit`
 * diz se aquilo se chama episódio, capítulo ou página, e **marcar uma unidade
 * vista é mover o contador em uma unidade** (brief, 3.11). Não há tabela de
 * episódio, e não vai haver: a lista é apresentação do contador.
 *
 * ── O que é do PAR e o que é do provedor ────────────────────────────────────
 * `units_path` e `unit_map` são da junção `(tipo, provedor)`, como
 * `search_path`: a mesma linha do TMDB serve filme e série, e só série tem
 * unidades. Ausentes, a obra simplesmente não tem lista — sem caso especial,
 * do mesmo jeito que tipo sem provedor já é legítimo.
 */

export type ProviderUnit = {
  number: number
  title: string | null
  synopsis: string | null
  art: string | null
  date: string | null
  runtime: number | null
}

export type UnitsOutcome =
  | { ok: true; units: ProviderUnit[] }
  | { ok: false; reason: DetailFailure | 'no-units' }

/** Um número do provedor, que pode vir string. */
function asNumber(value: unknown): number | null {
  const text = asString(value)
  const n = text === null ? Number.NaN : Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * O array de unidades dentro da resposta.
 *
 * **Procura o primeiro array**, em vez de exigir um caminho declarado a mais:
 * a resposta de um endpoint de unidades é, em todo provedor visto, um objeto
 * com um array só que interessa (`episodes`, `data`, `chapters`) ou o array
 * cru. Pedir mais uma linha na definição pra dizer isso seria configuração que
 * só tem uma resposta certa.
 */
function unitsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body
  }
  if (body && typeof body === 'object') {
    for (const value of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        return value
      }
    }
  }
  return []
}

function mapUnit(
  item: unknown,
  unitMap: UnitMap,
  artTemplate: string | null,
): ProviderUnit | null {
  const number = asNumber(readPath(item, unitMap.number))

  // Sem número não há o que marcar: a unidade É a posição no contador, e uma
  // linha sem ela não teria como virar progresso.
  if (number === null) {
    return null
  }

  return {
    number,
    title: unitMap.title ? asString(readPath(item, unitMap.title)) : null,
    synopsis: unitMap.synopsis
      ? asString(readPath(item, unitMap.synopsis))
      : null,
    art: unitMap.art
      ? artUrl(asString(readPath(item, unitMap.art)), artTemplate)
      : null,
    date: unitMap.date ? asString(readPath(item, unitMap.date)) : null,
    runtime: unitMap.runtime ? asNumber(readPath(item, unitMap.runtime)) : null,
  }
}

export async function fetchUnits({
  provider,
  binding,
  externalId,
  group,
  fetchImpl = fetch,
}: {
  provider: ProviderRow
  binding: TypeBinding
  externalId: string
  /** O grupo pedido — a temporada. Ausente onde as unidades não se agrupam. */
  group?: number | null
  fetchImpl?: typeof fetch
}): Promise<UnitsOutcome> {
  const { unitsPath, unitMap } = binding

  if (!unitsPath || !unitMap) {
    return { ok: false, reason: 'no-units' }
  }

  const withId = pathWithId(unitsPath, externalId)
  if (withId === null) {
    return { ok: false, reason: 'not-found' }
  }
  const path = withId.replace(
    '{group}',
    encodeURIComponent(String(group ?? '')),
  )

  /**
   * **As unidades continuam sendo `GET`, e isso é ausência declarada.**
   *
   * Não há `units_body` na junção porque nenhum provedor de corpo tem lista de
   * unidades: o AniList devolve só a CONTAGEM (brief, 3.10) e jogo não tem
   * unidade nenhuma. Criar a coluna agora seria vocabulário que nada exercita —
   * e vocabulário não exercitado é o que nasce errado. O dia em que um provedor
   * de `POST` listar unidades, ela entra como `search_body` entrou.
   */
  const prepared = await prepareRequest({
    providerSlug: provider.slug,
    baseUrl: provider.baseUrl,
    auth: provider.auth,
    endpoint: { path: path },
    accept: provider.endpoints.accept,
    storedCredentials: provider.credentialValues,
    // O prazo e o `fetch` seguem para a TROCA DE TOKEN, que é uma ida à rede
    // antes da requisição. Sem repassá-los, o estilo `oauth-client-credentials`
    // usaria o `fetch` global — e foi assim que o teste dele bateu no provedor
    // de verdade em vez de no dublê.
    timeoutMs: provider.timeoutMs,
    fetchImpl,
  })

  if (!prepared.ok) {
    // Igual ao detalhe, e pelo mesmo motivo.
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
  const key = cacheKeyFor(prepared.request.url, keyParam)

  const read = (body: string): UnitsOutcome => {
    try {
      const units = unitsArray(JSON.parse(body))
        .map((item) => mapUnit(item, unitMap, provider.artTemplate))
        .filter((unit) => unit !== null)
      return { ok: true, units: units }
    } catch {
      return { ok: false, reason: 'provider-error' }
    }
  }

  // A lista de unidades passa pelo MESMO cache de resposta da busca e do
  // detalhe: reabrir a tela de uma série não gasta cota nenhuma.
  const cached = readCache(provider.slug, key)
  if (cached !== null) {
    return read(cached)
  }

  if (!takeToken(provider.slug, undefined, provider.rateLimit)) {
    return { ok: false, reason: 'rate-limited' }
  }

  // O `try` embrulha a REDE, e só ela — 02/09/2026. Com o `writeCache` dentro,
  // falha nossa de banco se reportava como provedor inalcançável; fora, ela
  // sobe e vira 500, que é onde falha nossa pertence. O JSON já era do `ler()`.
  let body: string
  try {
    const response = await fetchImpl(prepared.request.url, {
      headers: prepared.request.headers,
      signal: AbortSignal.timeout(provider.timeoutMs),
    })

    if (response.status === 404) {
      return { ok: false, reason: 'not-found' }
    }
    // Ver `providers.client.ts`.
    if (response.status === 401) {
      forgetToken(provider.slug)
    }
    if (!response.ok) {
      return { ok: false, reason: 'provider-error' }
    }

    body = await response.text()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  writeCache(provider.slug, key, body)
  return read(body)
}

export type UnitGroup = {
  number: number
  /** O rótulo que o PROVEDOR deu — "Season 1", "Volume 3". Nunca nosso. */
  name: string
  count: number | null
  /**
   * A arte do grupo, já montada pelo molde da definição.
   *
   * **Emprestada, sempre** (brief, 3.10): o cache em disco é por obra
   * (provedor, id externo), e uma temporada não é uma obra. Cachear arte de
   * grupo pediria uma segunda chave, e a promessa de offline é sobre a obra
   * que a pessoa tem — não sobre cada pedaço dela.
   */
  art: string | null
}

/**
 * Os grupos, lidos da resposta de DETALHE que já foi buscada.
 *
 * Nenhuma ida à rede a mais: o TMDB manda `seasons` dentro do detalhe, e é
 * dessa mesma resposta que título e sinopse saem.
 */
export function mapUnitGroups(
  detail: unknown,
  fieldMap: { unitGroups?: NonNullable<TypeBinding['fieldMap']>['unitGroups'] },
  artTemplate: string | null = null,
): UnitGroup[] {
  const spec = fieldMap.unitGroups
  if (!spec) {
    return []
  }

  const raw = readPath(detail, spec.path)
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((item) => {
      const number = asNumber(readPath(item, spec.number))
      const name = asString(readPath(item, spec.name))
      if (number === null || !name) {
        return null
      }
      return {
        number,
        name,
        count: spec.count ? asNumber(readPath(item, spec.count)) : null,
        art: spec.art
          ? artUrl(asString(readPath(item, spec.art)), artTemplate)
          : null,
      }
    })
    .filter((grupo) => grupo !== null)
}

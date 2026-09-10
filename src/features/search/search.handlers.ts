import type { AppRouteHandler } from '../../lib/types.js'
import {
  defaultProviderOf,
  effectiveProviderOf,
  mediaTypeExists,
} from '../media-types/media-types.query.js'
import {
  type SearchOutcome,
  searchProvider,
} from '../providers/providers.client.js'
import { providersFor } from '../providers/providers.query.js'
import { chooseSearchProvider } from './search.provider-choice.js'
import { ownedByUser } from './search.query.js'
import type { SearchRoute } from './search.routes.js'

type Refusal = Extract<SearchOutcome, { ok: false }>

/**
 * A frase que vai pra tela, por motivo.
 *
 * Cada uma aponta pra uma saída DIFERENTE, e é por isso que `reason` viaja como
 * campo em vez de virar uma frase só: quem caiu em `no-provider` precisa de um
 * admin, quem caiu em `not-configured` precisa de uma chave, e quem caiu em
 * `rate-limited` só precisa esperar. Uma frase genérica mandaria os três pro
 * mesmo lugar errado.
 */
/**
 * A frase do provedor, quando o motivo a carrega.
 *
 * Só `provider-refused` tem o campo, e a checagem é por REASON e não por
 * presença: `'detail' in refusal` compilaria e diria a mesma coisa hoje, mas
 * pararia de dizer no dia em que outro motivo ganhasse um campo de mesmo nome.
 */
function detailOf(refusal: {
  reason: string
  detail?: string | null
}): string | null {
  return refusal.reason === 'provider-refused' ? (refusal.detail ?? null) : null
}

function refusalMessage(
  refusal: Refusal,
  /**
   * Slug → nome de exibição. A frase vai pra tela, e `tmdb` é nome de máquina:
   * a definição já carrega o nome próprio justamente porque ele é o que se lê.
   * Mesma correção que a mensagem do "testar conexão" precisou.
   */
  names: Record<string, string> = {},
): string {
  const name = (slug: string) => names[slug] ?? slug
  switch (refusal.reason) {
    /**
     * **Sem o slug do tipo dentro da frase** — corrigido em 01/09/2026, vendo a
     * tela: ela dizia `No provider is set up for "manga"`, com a CHAVE onde
     * devia estar o rótulo (design system, seção 8, sexta leva). O servidor não
     * tem como resolver o nome sem saber o idioma de quem lê, e a tela tem: ela
     * já carrega o vocabulário resolvido e nomeia o tipo no título do painel.
     *
     * A régua que sai daí: **frase escrita no servidor continua sendo copy de
     * tela**, e nenhuma chave entra nela — nem a de provedor, que por isso vira
     * `nome()` acima, nem a de tipo, que sai de vez.
     */
    case 'no-provider':
      return 'No provider is set up for this media type, so there is nowhere to search. An admin can connect one in settings.'
    case 'not-configured':
      return `${name(refusal.provider)} needs to be configured before it can be searched. An admin can do that in settings.`
    case 'rate-limited':
      return `Too many searches at once. Try again in a moment.`
    /**
     * **A recusa tem a gravidade do fato** (design system, seção 5), e o `4xx`
     * é o caso em que há o que arrumar: a frase manda pra configuração porque
     * é lá que o conserto está.
     */
    case 'provider-refused':
      return `${name(refusal.provider)} refused the search (${refusal.status}). An admin can check its settings.`
    /**
     * **`5xx` não pede configuração nenhuma** — o provedor está falhando do
     * lado dele. É a frase do endpoint de teste, que já fazia esta distinção
     * enquanto a busca mandava os dois para "refused": dizer isso a um 504
     * manda o admin procurar defeito numa configuração que está certa.
     */
    case 'provider-down':
      return `${name(refusal.provider)} is failing on its own side (${refusal.status}). Nothing to fix here — try again later.`
    case 'unreachable':
      return `${name(refusal.provider)} could not be reached.`
  }
}

/**
 * Busca no catálogo do provedor que responde por aquele tipo.
 *
 * **A busca é POR TIPO**, e não global: é o tipo que decide o endpoint e o mapa
 * de campos (o par tipo↔provedor carrega os dois), e é a pergunta que a tela de
 * busca faz — "procure uma série", não "procure qualquer coisa". Busca global é
 * outro problema.
 *
 * **E é UM provedor, não os associados todos** — decidido em 01/09/2026,
 * desenhando `/search` (brief, 3.10). Este handler concatenava, o que era
 * indistinguível do certo enquanto todo tipo tivesse um provedor só. A regra da
 * escolha, com o porquê de cada degrau, mora em `search.provider-choice.ts`.
 *
 * **Tipo sem provedor devolve 503 com motivo, nunca lista vazia** (brief,
 * 3.10). Lista vazia significa "procurei e não achei"; usar a mesma tela pra
 * "não tinha onde procurar" faz o usuário concluir que a obra não existe no
 * catálogo, quando não houve catálogo nenhum.
 */
export const search: AppRouteHandler<SearchRoute> = async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ message: 'No active session' }, 401)
  }

  const { type, q, provider: requestedProvider } = c.req.valid('query')

  /**
   * 404 antes de tudo, e a ordem é decisão: tipo que não existe é pergunta mal
   * formada, tipo que existe sem provedor é uma condição desta instalação. Sem
   * a distinção, um slug com erro de digitação se leria como "falta configurar
   * um provedor", e o admin iria procurar o que configurar.
   */
  if (!mediaTypeExists(type)) {
    return c.json({ message: 'No media type with that slug' }, 404)
  }

  const associated = providersFor(type)
  const names = Object.fromEntries(
    associated.map(({ provider }) => [provider.slug, provider.name]),
  )

  const choice = chooseSearchProvider({
    requested: requestedProvider ?? null,
    effective: effectiveProviderOf(
      defaultProviderOf(type),
      associated.map(({ provider }) => provider.slug),
    ),
    associated: associated.map(({ provider }) => provider.slug),
  })

  if (!choice.ok) {
    if (choice.reason === 'not-associated') {
      return c.json(
        {
          message: `${names[choice.provider] ?? choice.provider} does not serve "${type}".`,
        },
        400,
      )
    }
    const refusal = { ok: false, reason: 'no-provider' } as const
    return c.json(
      {
        message: refusalMessage(refusal, names),
        reason: refusal.reason,
        providerMessage: detailOf(refusal),
      },
      503,
    )
  }

  const chosen = associated.find(
    ({ provider }) => provider.slug === choice.provider,
  )
  /**
   * Impossível pela regra acima — a escolha sai da própria lista —, e mesmo
   * assim não se resolve com `!`: o dia em que a regra mudar, um `undefined`
   * silencioso viraria 500 sem explicação.
   */
  if (!chosen) {
    const refusal = { ok: false, reason: 'no-provider' } as const
    return c.json(
      {
        message: refusalMessage(refusal, names),
        reason: refusal.reason,
        providerMessage: detailOf(refusal),
      },
      503,
    )
  }

  const outcome = await searchProvider({
    provider: chosen.provider,
    binding: chosen.binding,
    term: q,
  })

  if (!outcome.ok) {
    return c.json(
      {
        message: refusalMessage(outcome, names),
        reason: outcome.reason,
        providerMessage: detailOf(outcome),
      },
      503,
    )
  }

  return c.json(
    {
      results: outcome.results,
      provider: {
        slug: chosen.provider.slug,
        name: chosen.provider.name,
        attribution: chosen.provider.attribution,
      },
      /**
       * Ordenado por slug pra casar com o desempate de `chooseSearchProvider`:
       * a lista que a tela mostra e a ordem que decide quem responde precisam
       * ser a mesma, senão o seletor abre com um item marcado que não é o que
       * respondeu.
       */
      sources: associated
        .map(({ provider }) => ({ slug: provider.slug, name: provider.name }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      owned: ownedByUser({
        userId: user.id,
        provider: chosen.provider.slug,
        // Uma busca = um tipo (brief, 3.10), e é ele que fecha a identidade.
        mediaType: type,
        candidates: outcome.results.map((result) => result.externalId),
      }),
      cached: outcome.cached,
    },
    200,
  )
}

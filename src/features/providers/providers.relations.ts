import type { RelationMap } from '../../db/schema/providers.js'
import { artUrl, asString, readPath, yearOf } from './providers.client.js'
import { subtypeLabel } from './providers.text.js'

/**
 * Um VÍNCULO entre duas obras do mesmo provedor — 02/09/2026.
 *
 * ── O que ele NÃO é ────────────────────────────────────────────────────────
 * Não é `external_ids`, e não é `links`. `external_ids` guarda o id de uma obra
 * NOSSA num provedor; `links` aponta pra fora (IMDb, Wikidata). Isto aponta pra
 * outra obra **do mesmo catálogo**, que a pessoa pode abrir sem sair do
 * produto — e por isso carrega o que a rota de detalhe precisa: provedor, id
 * externo e **tipo**.
 *
 * Não vira linha em tabela nenhuma. É contexto do provedor, como sinopse e
 * arte, e envelhece com a resposta de detalhe.
 */
export type ProviderRelation = {
  /**
   * O tipo da relação, normalizado — `Prequel`, `Adaptation`, `Parent`.
   *
   * É ele que vira o título de seção na tela.
   *
   * **Nulo é o caso inteiro da RECOMENDAÇÃO** — 03/09/2026. Nenhum dos três
   * provedores que a servem nomeia a relação, porque não há relação a nomear:
   * uma recomendação não afirma parentesco, afirma semelhança. Quem nomeia
   * aquela seção é a tela. Em vínculo, nulo continua não acontecendo — o
   * provedor que não nomeia declara `kindConst`.
   */
  kind: string | null
  provider: string
  externalId: string
  /**
   * O nosso slug de tipo — resolvido contra `provider_type_token` da junção.
   *
   * **É o que torna o vínculo navegável**: sem ele a rota de detalhe não sabe
   * o que pedir, porque no TMDB o mesmo id é uma série e outro filme.
   */
  type: string
  title: string
  year: number | null
  art: string | null
}

/**
 * A lista de itens de vínculo, tolerando o objeto único.
 *
 * O `parent_game` do IGDB não é array, e exigir que fosse obrigaria a definição
 * a mentir sobre a resposta. **Um vínculo só é uma lista de um** — a mesma
 * tolerância que `FieldPath` já tem ao aceitar string ou lista.
 */
function itemsOf(body: unknown, map: RelationMap): unknown[] {
  const raw = readPath(body, map.path)
  if (raw === null || raw === undefined) {
    return []
  }
  return Array.isArray(raw) ? raw : [raw]
}

/**
 * Resolve a referência JSON:API do item contra a lista de incluídos.
 *
 * O Kitsu devolve a relação e a obra em listas separadas — `role` em `data[]`,
 * destino em `included[]` —, ligadas por `{type, id}`. **O par inteiro é a
 * chave, não só o id**: em JSON:API o id é único dentro do tipo, e um `anime` 8
 * e um `manga` 8 convivem.
 */
function resolveIncluded(
  body: unknown,
  item: unknown,
  map: RelationMap,
): unknown {
  if (!map.includeRef) {
    return item
  }

  const ref = readPath(item, map.includeRef)
  if (ref === null || typeof ref !== 'object') {
    return undefined
  }
  const { type, id } = ref as { type?: unknown; id?: unknown }

  const included = readPath(body, map.includePath ?? 'included')
  if (!Array.isArray(included)) {
    return undefined
  }

  return included.find((candidate) => {
    if (candidate === null || typeof candidate !== 'object') {
      return false
    }
    const c = candidate as { type?: unknown; id?: unknown }
    return c.type === type && String(c.id) === String(id)
  })
}

/**
 * As obras vizinhas de uma obra, prontas pra tela.
 *
 * `typesByToken` é o mapa (token do provedor → nosso slug) montado a partir de
 * `media_type_providers.provider_type_token` — ou seja, **dado**, não código.
 * `workType` é o que vale quando o provedor não distingue tipo, que é o caso
 * do IGDB.
 *
 * **Ela recebe o MAPA, não o `field_map` — 03/09/2026.** Antes lia
 * `fieldMap.relations` por dentro, e isso a prendia a um conceito só. A
 * recomendação chegou com a **mesma forma medida campo a campo**, então a
 * escolha era esta ou uma segunda função idêntica que um dia divergiria — e
 * ela divergiria no tratamento de item nulo, que é onde as duas mais se
 * parecem. Quem passa o mapa é quem sabe qual dos dois está lendo.
 */
export function mapRelations({
  body,
  map,
  providerSlug,
  artTemplate,
  workType,
  typesByToken,
}: {
  body: unknown
  /** `field_map.relations` ou `field_map.recommendations`. Ausente devolve vazio. */
  map: RelationMap | undefined
  providerSlug: string
  artTemplate: string | null
  workType: string
  typesByToken: Record<string, string>
}): ProviderRelation[] {
  if (!map) {
    return []
  }

  return itemsOf(body, map)
    .map((item): ProviderRelation | null => {
      /**
       * **Com junção, os campos vêm de dois lugares**: `kind` do item, porque é
       * a relação; o resto do recurso resolvido, porque é a obra. Sem junção,
       * tudo do item.
       */
      const work = resolveIncluded(body, item, map)
      if (work === undefined) {
        return null
      }

      const externalId = asString(readPath(work, map.id))
      const title = asString(readPath(work, map.title))
      if (!externalId || !title) {
        return null
      }

      /**
       * O tipo do nó, resolvido contra a junção. **Token que a instalação não
       * conhece derruba o item**, e isso é decisão: um vínculo pra um tipo que
       * este servidor não tem não é navegável, e mostrá-lo seria uma carta que
       * não abre — a régua de "affordance descreve o que existe".
       */
      const token = map.typeToken
        ? asString(readPath(work, map.typeToken))
        : null
      const type = token === null ? workType : typesByToken[token]
      if (!type) {
        return null
      }

      return {
        kind: subtypeLabel(
          map.kind
            ? asString(readPath(item, map.kind))
            : (map.kindConst ?? null),
        ),
        provider: providerSlug,
        externalId,
        type,
        title,
        year: map.year
          ? yearOf(readPath(work, map.year), map.yearFormat)
          : null,
        art: map.art
          ? artUrl(asString(readPath(work, map.art)), artTemplate)
          : null,
      }
    })
    .filter((relation): relation is ProviderRelation => relation !== null)
}

import { artPathFor } from '../entries/entries.public.js'
import {
  type DetailFailure,
  detailFieldMapOf,
  fetchDetail,
  mapDetail,
} from '../providers/providers.detail.js'
import {
  bindingFor,
  type ProviderRow,
  typeTokensOf,
} from '../providers/providers.query.js'
import { mapRelations } from '../providers/providers.relations.js'
import { mapUnitGroups } from '../providers/providers.units.js'
import { ownedByUser } from '../search/search.query.js'
import type { TitleDetails } from './titles.public.js'
import { readSnapshot, writeSnapshot } from './titles.snapshot.js'

export type ResolveOutcome =
  | { ok: true; details: TitleDetails }
  | { ok: false; reason: DetailFailure }

/**
 * O detalhe de uma obra, pronto para a tela.
 *
 * **Um caminho só para os dois endereços.** A diferença entre "obra do
 * provedor" e "obra minha" cabe em dois parâmetros — de quem é a pergunta, e
 * se já existe uma linha —, e não em dois resolvedores. Quando o segundo
 * existir, ele vai divergir do primeiro.
 */
export async function resolveTitle({
  provider,
  externalId,
  userId,
  mediaType,
  /**
   * O id da obra na biblioteca, quando quem pergunta já veio dela.
   *
   * Evita a consulta de posse no caminho de `/api/entries/{id}/details`, onde
   * a resposta já é conhecida — e é o que faz a rota de lá não pagar por uma
   * pergunta que ela mesma acabou de responder.
   */
  entryId = null,
  fetchImpl = fetch,
}: {
  provider: ProviderRow
  externalId: string
  userId: number
  /** O tipo, que é quem sabe se este par tem unidades. */
  mediaType: string
  entryId?: number | null
  fetchImpl?: typeof fetch
}): Promise<ResolveOutcome> {
  const binding = bindingFor(mediaType, provider.slug)
  /**
   * **A posse se resolve ANTES de falar com o provedor**, porque ela não
   * depende dele — e porque o caminho degradado precisa da mesma resposta.
   * Calculá-la nos dois lados seria a segunda conta da mesma coisa, que é como
   * uma delas fica para trás.
   *
   * A chave é o `externalId` PEDIDO, não o que o mapeador devolve: é por ele
   * que `external_ids`, `art_cache` e o snapshot são procurados depois, e o
   * mapeador cai nele quando o provedor não republica o próprio id.
   */
  const owned =
    entryId ??
    ownedByUser({
      userId,
      provider: provider.slug,
      mediaType,
      candidates: [externalId],
    })[externalId] ??
    null

  const key = { provider: provider.slug, externalId, mediaType }

  const detail = await fetchDetail({
    provider,
    binding,
    externalId,
    fetchImpl,
  })

  /**
   * **O provedor fora do ar não apaga a obra da biblioteca** — 07/09/2026.
   *
   * Antes daqui, uma obra de anime respondia recusa enquanto o AniList
   * estivesse desativado: obra que é da pessoa, que ela adicionou, e que este
   * banco conhece pelo nome. A régua vinha do cache de arte (brief, 3.10) — o
   * que a pessoa TEM não depende da CDN de terceiro —, e a arte era a única
   * parte da obra que já a cumpria.
   *
   * **`not-found` NÃO degrada.** Ali o provedor respondeu, e respondeu que não
   * tem: servir o snapshot faria a tela afirmar que existe uma obra que a fonte
   * acabou de negar. É o não-encontrado da seção 6, e a saída dele é sair.
   */
  if (!detail.ok) {
    if (detail.reason === 'not-found') {
      return { ok: false, reason: detail.reason }
    }

    const stored = readSnapshot(key)
    if (!stored) {
      return { ok: false, reason: detail.reason }
    }

    return {
      ok: true,
      details: {
        provider: {
          slug: provider.slug,
          name: provider.name,
          attribution: provider.attribution ?? null,
        },
        externalId,
        title: stored.title,
        year: stored.year,
        synopsis: stored.synopsis,
        subtype: stored.subtype,
        /**
         * As quatro listas de CONTEXTO saem vazias, e isso não é perda nova: é
         * o que um provedor sem o conceito já entrega, e o que uma segunda
         * requisição falha já entregava. Guardá-las seria guardar apontamentos
         * para obras cujo detalhe também não temos.
         */
        relations: [],
        recommendations: [],
        links: [],
        art: owned ? artPathFor(owned, provider.slug) : stored.art,
        total: stored.total,
        score: stored.score,
        votes: stored.votes,
        ownedEntryId: owned,
        unitGroups: [],
        /** Sem grupos não há coletivo a nomear. */
        unitGroupLabel: null,
        /**
         * **Falso mesmo quando o par declara unidades.** A lista viria do
         * provedor que acabou de não responder, e oferecer a faixa faria a tela
         * pedir pela rede o que ela já sabe que vai falhar — a régua de 01/09,
         * *resposta que a tela responde sozinha vence a que viria da rede*.
         */
        hasUnits: false,
        snapshot: {
          fetchedAt: stored.fetchedAt.toISOString(),
          reason: detail.reason,
        },
      },
    }
  }

  const map = detailFieldMapOf(provider, binding)
  const fields = mapDetail(detail.body, provider, externalId, map)

  /**
   * Os grupos saem da MESMA resposta de detalhe — o TMDB manda `seasons`
   * dentro dela. Nenhuma ida à rede a mais pra saber quantas temporadas
   * existem.
   */
  const unitGroups = mapUnitGroups(detail.body, map, provider.artTemplate)
  const hasUnits = Boolean(binding?.unitsPath && binding?.unitMap)

  /**
   * Os VÍNCULOS vêm de um de dois lugares, e a definição diz de qual.
   *
   * IGDB e AniList os devolvem dentro do detalhe que já foi buscado — nenhuma
   * ida à rede a mais, como os grupos de unidade. O Kitsu os serve num endpoint
   * separado, e aí `relations_path` diz onde.
   *
   * **Falha na segunda requisição NÃO derruba o detalhe.** Vínculo é contexto,
   * como sinopse e nota; a obra é o ponto da tela. Degradar pra lista vazia é o
   * mesmo que o provedor sem o conceito já entrega, e a tela não precisa
   * distinguir "não tem" de "não deu pra buscar" — em nenhum dos dois há o que
   * ela possa fazer.
   */
  const relationsBody = binding?.relationsPath
    ? await fetchDetail({
        provider,
        binding,
        externalId,
        pathOverride: binding.relationsPath,
        fetchImpl,
      })
    : detail

  const typesByToken = typeTokensOf(provider.slug)

  const relations = relationsBody.ok
    ? mapRelations({
        body: relationsBody.body,
        map: map.relations,
        providerSlug: provider.slug,
        artTemplate: provider.artTemplate,
        workType: mediaType,
        typesByToken,
      })
    : []

  /**
   * As RECOMENDAÇÕES saem do corpo do detalhe, sempre — 03/09/2026.
   *
   * Os três provedores que as têm as entregam ali: IGDB e AniList porque tudo
   * deles vem no detalhe, e o TMDB porque a definição pede
   * `append_to_response=recommendations`. **Isso não foi sorte, foi o que a
   * medição escolheu**: o TMDB também as serve em `/movie/{id}/recommendations`,
   * e ir por lá custaria uma coluna nova na junção, uma segunda ida à rede e
   * uma segunda entrada de cache — três coisas para trazer o mesmo JSON.
   *
   * Por isso não há `recommendationsBody`. Um provedor que um dia as sirva em
   * endereço próprio abre eixo novo na definição, e aí ele se declara — como
   * `relations_path` fez pelo Kitsu.
   */
  const recommendations = mapRelations({
    body: detail.body,
    map: map.recommendations,
    providerSlug: provider.slug,
    artTemplate: provider.artTemplate,
    workType: mediaType,
    typesByToken,
  })

  /**
   * **A arte muda de natureza com a posse** (brief, 3.10). Sendo minha, ela
   * vem da nossa rota de cache — que serve do disco e sobrevive offline;
   * ainda não sendo, vem emprestada da CDN, porque a tela que a mostra não
   * funciona offline de jeito nenhum. A regra está no OBJETO, não na tela, e
   * é por isso que ela cabe aqui e não em dois handlers.
   */
  /**
   * **E o vínculo vai junto — 02/09/2026.** Sem ele o endereço resolvia pelo
   * vínculo EFETIVO da obra, então pedir o detalhe pelo Kitsu de uma obra que
   * fala pelo AniList devolvia o pôster do AniList. Passa despercebido enquanto
   * as duas capas se parecem, e é exatamente o que o preview de troca de fonte
   * precisa acertar. Vale nas duas telas: ver a obra por um vínculo é ver a
   * arte DAQUELE vínculo.
   */
  const art = owned ? artPathFor(owned, provider.slug) : fields.art

  /**
   * **Toda resposta viva grava**, e é o que faz o snapshot ser revalidação em
   * vez de retrato de um dia só. O caminho da leitura é o mesmo caminho da
   * escrita — não há job, nem varredura, nem segunda ida à rede, pela mesma
   * razão que o cache de arte não tem (brief, 3.1).
   */
  writeSnapshot(key, fields)

  return {
    ok: true,
    details: {
      provider: {
        slug: provider.slug,
        name: provider.name,
        attribution: provider.attribution ?? null,
      },
      externalId: fields.externalId,
      title: fields.title,
      year: fields.year,
      synopsis: fields.synopsis,
      subtype: fields.subtype,
      relations,
      recommendations,
      art,
      total: fields.total,
      score: fields.score,
      votes: fields.votes,
      links: fields.links,
      ownedEntryId: owned,
      unitGroups,
      /**
       * Do PAR, e nulo quando ele não declara — a tela não inventa o coletivo.
       * Só faz sentido junto de grupos: sem eles não há conjunto a nomear.
       */
      unitGroupLabel:
        unitGroups.length > 0 ? (map.unitGroups?.label ?? null) : null,
      hasUnits,
      /** Nulo é a resposta do provedor de agora. Ver `titles.public.ts`. */
      snapshot: null,
    },
  }
}

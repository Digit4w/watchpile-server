import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { externalIds } from '../../db/schema/external-ids.js'

/**
 * Quais destes resultados o usuário JÁ tem, e sob qual id nosso.
 *
 * É o que faz a duplicata se anunciar **antes do clique** (brief, 3.10): o
 * resultado já possuído volta marcado, com atalho pra obra, em vez de virar
 * erro depois — o app não tem toast, e a régua de "recusa se anuncia antes do
 * clique" vale aqui igual.
 *
 * **Devolve um mapa ao lado, e não um campo dentro do resultado.** Um
 * `entryId: number | null` em `ProviderResult` daria a ele cara de `Entry`, que
 * é exatamente a mentira que `search.routes.ts` recusa: toda tela que
 * recebesse a lista teria que lembrar de checar o nulo, e uma esqueceria.
 *
 * **A comparação é contra as obras DAQUELE usuário** — `external_ids` é dona
 * por transitividade, então o filtro por dono passa pelo join com `entries`.
 */
export function ownedByUser({
  userId,
  provider,
  mediaType,
  candidates,
}: {
  userId: number
  provider: string
  /**
   * **Sem ele a comparação está errada, e o compilador não pegaria** — uma
   * cláusula `where` a menos continua sendo TypeScript válido.
   *
   * O id de um provedor é único DENTRO do tipo: `mal/21` é o anime One Piece e
   * o mangá Death Note; `tmdb/1396` é Breaking Bad em série e *Mirror* em
   * filme. Sem o tipo, esta consulta dizia "você já tem" sobre uma obra
   * diferente — e no import isso custou quatro mangás, contados como pulados
   * (07/09/2026).
   */
  mediaType: string
  candidates: readonly string[]
}): Record<string, number> {
  if (candidates.length === 0) {
    return {}
  }

  const rows = db
    .select({
      externalId: externalIds.externalId,
      entryId: externalIds.entryId,
    })
    .from(externalIds)
    .innerJoin(entries, eq(entries.id, externalIds.entryId))
    .where(
      and(
        eq(entries.userId, userId),
        eq(externalIds.provider, provider),
        eq(externalIds.mediaType, mediaType),
        inArray(externalIds.externalId, [...candidates]),
      ),
    )
    .all()

  return Object.fromEntries(
    rows.map(({ externalId, entryId }) => [externalId, entryId]),
  )
}

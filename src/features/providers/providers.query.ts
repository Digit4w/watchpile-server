import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import type {
  FieldMap,
  ProviderBody,
  UnitMap,
} from '../../db/schema/providers.js'
import { providers } from '../../db/schema/providers.js'

export type ProviderRow = typeof providers.$inferSelect

/**
 * O "como" de um par (tipo, provedor): por onde buscar e que campos ler.
 *
 * Vem da junção porque é propriedade do PAR — o TMDB busca filme em
 * `/search/movie` e série em `/search/tv`, e as duas rotas devolvem campos
 * diferentes pra mesma ideia. Nulo cai no do provedor.
 */
export type TypeBinding = {
  searchPath: string | null
  /** O corpo da busca DESTE par — o `type` do AniList mora aqui. Nulo cai no
   * corpo do endpoint do provedor, que é o caso de quem fala por `GET`. */
  searchBody: ProviderBody | null
  fieldMap: FieldMap | null
  /** As unidades DESTE par — episódios de série, capítulos de mangá. Nulo é o
   * caso comum: filme, jogo e livro não têm unidade nenhuma. */
  /** O detalhe DESTE par — `/movie/{id}` contra `/tv/{id}`. Nulo cai no do
   * provedor. */
  detailPath: string | null
  /** O corpo do detalhe DESTE par, pelo mesmo motivo. */
  detailBody: ProviderBody | null
  /** O mapa da resposta de detalhe, quando ela difere da de busca. Nulo cai no
   * mapa da busca — é o caso do TMDB. */
  detailFieldMap: FieldMap | null
  /** O token que este provedor usa pra nomear este tipo. Ver a coluna. */
  providerTypeToken: string | null
  /** O endpoint de vínculos deste par. Nulo = leia do corpo do detalhe. */
  relationsPath: string | null
  unitsPath: string | null
  unitMap: UnitMap | null
}

/**
 * Os provedores que servem um tipo, com o "como" de cada par.
 *
 * **Lista vazia é resposta legítima e significa algo específico**: este tipo
 * não tem provedor. Quem chama precisa distinguir isso de "procurei e não
 * achei" — devolver lista vazia de busca nos dois casos é, nas palavras do
 * brief, "a mentira mais cara que uma busca consegue contar".
 */
export function providersFor(
  mediaTypeSlug: string,
): { provider: ProviderRow; binding: TypeBinding }[] {
  return db
    .select({
      provider: providers,
      searchPath: mediaTypeProviders.searchPath,
      searchBody: mediaTypeProviders.searchBody,
      fieldMap: mediaTypeProviders.fieldMap,
      detailPath: mediaTypeProviders.detailPath,
      detailBody: mediaTypeProviders.detailBody,
      detailFieldMap: mediaTypeProviders.detailFieldMap,
      providerTypeToken: mediaTypeProviders.providerTypeToken,
      relationsPath: mediaTypeProviders.relationsPath,
      unitsPath: mediaTypeProviders.unitsPath,
      unitMap: mediaTypeProviders.unitMap,
    })
    .from(mediaTypeProviders)
    .innerJoin(providers, eq(providers.slug, mediaTypeProviders.providerSlug))
    .where(eq(mediaTypeProviders.mediaTypeSlug, mediaTypeSlug))
    .all()
    .map(({ provider, ...binding }) => ({ provider, binding }))
}

export function providerBySlug(slug: string): ProviderRow | undefined {
  return db.select().from(providers).where(eq(providers.slug, slug)).get()
}

export function bindingFor(
  mediaTypeSlug: string,
  providerSlug: string,
): TypeBinding | undefined {
  const row = db
    .select({
      searchPath: mediaTypeProviders.searchPath,
      searchBody: mediaTypeProviders.searchBody,
      fieldMap: mediaTypeProviders.fieldMap,
      detailPath: mediaTypeProviders.detailPath,
      detailBody: mediaTypeProviders.detailBody,
      detailFieldMap: mediaTypeProviders.detailFieldMap,
      providerTypeToken: mediaTypeProviders.providerTypeToken,
      relationsPath: mediaTypeProviders.relationsPath,
      unitsPath: mediaTypeProviders.unitsPath,
      unitMap: mediaTypeProviders.unitMap,
    })
    .from(mediaTypeProviders)
    .where(
      and(
        eq(mediaTypeProviders.mediaTypeSlug, mediaTypeSlug),
        eq(mediaTypeProviders.providerSlug, providerSlug),
      ),
    )
    .get()

  return row
    ? {
        searchPath: row.searchPath,
        searchBody: row.searchBody,
        fieldMap: row.fieldMap,
        detailPath: row.detailPath,
        detailBody: row.detailBody,
        detailFieldMap: row.detailFieldMap,
        providerTypeToken: row.providerTypeToken,
        relationsPath: row.relationsPath,
        unitsPath: row.unitsPath,
        unitMap: row.unitMap,
      }
    : undefined
}

/**
 * O mapa (token do provedor → nosso slug de tipo), pra resolver o nó de um
 * vínculo.
 *
 * **É consulta, não constante.** O AniList diz `MANGA` e o Kitsu diz `manga`
 * pra mesma ideia, e a tradução mora em `provider_type_token` na junção —
 * escrevê-la em código seria o `if (slug === …)` que o brief 3.10 recusa.
 *
 * Par sem token declarado fica de fora: ele não participa da resolução, e o
 * vínculo cujo nó não casa com nenhum é descartado por quem lê.
 */
export function typeTokensOf(providerSlug: string): Record<string, string> {
  const rows = db
    .select({
      mediaTypeSlug: mediaTypeProviders.mediaTypeSlug,
      token: mediaTypeProviders.providerTypeToken,
    })
    .from(mediaTypeProviders)
    .where(eq(mediaTypeProviders.providerSlug, providerSlug))
    .all()

  return Object.fromEntries(
    rows
      .filter((l): l is { mediaTypeSlug: string; token: string } =>
        Boolean(l.token),
      )
      .map((l) => [l.token, l.mediaTypeSlug]),
  )
}

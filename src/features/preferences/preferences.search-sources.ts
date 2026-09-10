import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { mediaTypeProviders } from '../../db/schema/media-type-providers.js'
import { preferredSearchSources } from '../../db/schema/preferred-search-sources.js'

/**
 * A fonte que cada usuário prefere para cada tipo — leitura e escrita.
 *
 * ── A leitura VALIDA contra a associação, e não é zelo ──────────────────────
 * A FK cobre o tipo e o provedor sumirem; **não cobre a associação entre os
 * dois cair** com as duas pontas vivas, que é o gesto normal de
 * `DELETE /api/media-types/{slug}/providers/{provider}`. Uma linha órfã assim
 * pediria ao provedor um par que ele não serve, e a busca voltaria com o 400 de
 * `not-associated` — uma recusa por causa de uma preferência antiga que a
 * pessoa não tem como ver nem desfazer.
 *
 * Validar aqui, na consulta, e não no cliente: **onde o servidor decide, a tela
 * LÊ a decisão** (02/09), e quem sabe quais pares existem é este lado. É a
 * mesma forma de `rememberedScope` no cliente, que valida o tipo guardado
 * contra o vocabulário de agora — a diferença é que lá o dado é do aparelho e
 * aqui é do banco, então a validação sobe junto com ele.
 *
 * A linha órfã **fica no banco em vez de ser apagada na leitura**: desassociar e
 * reassociar um par é operação de admin e acontece, e apagar a preferência de
 * todo mundo no meio do caminho perderia uma escolha que volta a ser válida
 * sozinha. Ela só não é obedecida enquanto o par não existir.
 */
export function searchSourcesOf(userId: number): Record<string, string> {
  const rows = db
    .select({
      type: preferredSearchSources.mediaTypeSlug,
      provider: preferredSearchSources.providerSlug,
    })
    .from(preferredSearchSources)
    .innerJoin(
      mediaTypeProviders,
      and(
        eq(
          mediaTypeProviders.mediaTypeSlug,
          preferredSearchSources.mediaTypeSlug,
        ),
        eq(
          mediaTypeProviders.providerSlug,
          preferredSearchSources.providerSlug,
        ),
      ),
    )
    .where(eq(preferredSearchSources.userId, userId))
    .all()

  return Object.fromEntries(rows.map((row) => [row.type, row.provider]))
}

/**
 * A fonte preferida para UM tipo, já validada — o degrau que
 * `chooseSearchProvider` consome.
 *
 * Consulta própria em vez de `searchSourcesOf(...)[type]`: a busca acontece a
 * cada tecla, e ler a preferência de todos os tipos pra usar uma é trabalho que
 * cresce com o vocabulário, que não tem teto (brief, 3.10).
 */
export function preferredSourceFor(
  userId: number,
  mediaTypeSlug: string,
): string | null {
  return (
    db
      .select({ provider: preferredSearchSources.providerSlug })
      .from(preferredSearchSources)
      .innerJoin(
        mediaTypeProviders,
        and(
          eq(
            mediaTypeProviders.mediaTypeSlug,
            preferredSearchSources.mediaTypeSlug,
          ),
          eq(
            mediaTypeProviders.providerSlug,
            preferredSearchSources.providerSlug,
          ),
        ),
      )
      .where(
        and(
          eq(preferredSearchSources.userId, userId),
          eq(preferredSearchSources.mediaTypeSlug, mediaTypeSlug),
        ),
      )
      .get()?.provider ?? null
  )
}

/** Grava a escolha de um tipo, substituindo a que houvesse. */
export function setSearchSource(
  userId: number,
  mediaTypeSlug: string,
  providerSlug: string,
): void {
  db.insert(preferredSearchSources)
    .values({ userId, mediaTypeSlug, providerSlug })
    .onConflictDoUpdate({
      target: [
        preferredSearchSources.userId,
        preferredSearchSources.mediaTypeSlug,
      ],
      set: { providerSlug },
    })
    .run()
}

/** Desfaz a escolha de um tipo — a busca volta a seguir o padrão da instância. */
export function clearSearchSource(userId: number, mediaTypeSlug: string): void {
  db.delete(preferredSearchSources)
    .where(
      and(
        eq(preferredSearchSources.userId, userId),
        eq(preferredSearchSources.mediaTypeSlug, mediaTypeSlug),
      ),
    )
    .run()
}

/** O par (tipo, provedor) existe? A guarda da escrita, antes de gravar. */
export function serves(mediaTypeSlug: string, providerSlug: string): boolean {
  return (
    db
      .select({ slug: mediaTypeProviders.providerSlug })
      .from(mediaTypeProviders)
      .where(
        and(
          eq(mediaTypeProviders.mediaTypeSlug, mediaTypeSlug),
          eq(mediaTypeProviders.providerSlug, providerSlug),
        ),
      )
      .get() !== undefined
  )
}

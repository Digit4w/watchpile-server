import { count, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { entries } from '../../db/schema/entries.js'
import { mediaTypes } from '../../db/schema/media-types.js'
import { settings } from '../../db/schema/settings.js'

/**
 * O tipo existe nesta instalação?
 *
 * Precisa existir porque **o conjunto válido deixou de ser estático** em
 * 31/08/2026: enquanto `entries.media_type` era um enum de seis, o Zod recusava
 * um tipo desconhecido sozinho, na borda. Com o tipo virando linha de tabela
 * (brief, 3.12), a lista válida é dado — e sem esta checagem o pedido só
 * falharia lá embaixo, na chave estrangeira, como 500.
 *
 * **Tipo desconhecido é 400, não 500**: quem mandou "podcast" num servidor que
 * não tem podcast escreveu um pedido inválido, não achou um defeito nosso.
 */
export function mediaTypeExists(slug: string): boolean {
  return (
    db
      .select({ slug: mediaTypes.slug })
      .from(mediaTypes)
      .where(eq(mediaTypes.slug, slug))
      .get() !== undefined
  )
}

/**
 * O provedor PADRÃO do tipo, direto da coluna — **nulo é o estado de quase
 * todos** (brief, 3.10). É o valor CRU, antes de `effectiveProviderOf`; quem o
 * transforma em "quem responde a busca" é `chooseSearchProvider`, que tem mais
 * dois degraus.
 */
export function defaultProviderOf(slug: string): string | null {
  return (
    db
      .select({ provider: mediaTypes.defaultProviderSlug })
      .from(mediaTypes)
      .where(eq(mediaTypes.slug, slug))
      .get()?.provider ?? null
  )
}

/**
 * Quantas obras usam o tipo — de TODOS os usuários, não só de quem pergunta.
 *
 * O escopo global é o ponto: é ele que sustenta a recusa de apagar (brief,
 * 3.12). Contar só as obras do admin diria "0 obras usam este tipo" enquanto
 * outra conta do mesmo servidor tem duzentas.
 */
export function countEntriesOfType(slug: string): number {
  return (
    db
      .select({ total: count() })
      .from(entries)
      .where(eq(entries.mediaType, slug))
      .get()?.total ?? 0
  )
}

/**
 * O idioma-base do SERVIDOR — degrau 2 da queda de nome (brief, 3.12), e não a
 * língua-base do produto. A linha de `settings` nasce no primeiro boot; antes
 * dela o default da coluna é o que vale.
 */
export function instanceLanguage(): string {
  return db.select().from(settings).get()?.instanceLanguage ?? 'en'
}

/**
 * O provedor EFETIVO de um tipo — 01/09/2026, renomeado em 02/09.
 *
 * `default_provider_slug` é o valor cru — a escolha do admin, quase sempre
 * nula. Esta função é a resolução dele, e o par `default`/`effective` é o mesmo
 * que os vínculos de obra fixaram um dia antes (`entries.source.ts`): a escolha
 * de um lado, o que vale de fato do outro. Chamava-se `canonicalProviderOf`
 * enquanto decidia duas coisas; sobrou a busca, e o nome seguiu.
 *
 * A coluna guarda uma **decisão do admin**, e decisão só é necessária quando há
 * ambiguidade. Com exatamente um provedor associado não há o que decidir: ele é
 * o efetivo por falta de concorrente, e obrigar o admin a confirmá-lo seria
 * pedir que ele escolhesse entre uma opção.
 *
 * Daí a resolução em três casos, e o terceiro é o que a tela de busca vai ter
 * que responder:
 *
 * 1. coluna preenchida → é ela, sempre. Escolha explícita vence contagem
 * 2. coluna nula e UM provedor → esse provedor
 * 3. coluna nula e dois ou mais → **nulo**, e é honesto: ninguém decidiu, e
 *    inventar o primeiro da lista seria decidir por alfabeto
 */
export function effectiveProviderOf(
  explícito: string | null,
  associated: readonly string[],
): string | null {
  if (explícito) {
    return explícito
  }
  return associated.length === 1 ? (associated[0] ?? null) : null
}

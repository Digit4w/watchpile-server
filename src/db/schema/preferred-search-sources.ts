import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import { providers } from './providers.js'
import { users } from './users.js'

/**
 * Qual fonte cada usuário prefere para buscar cada tipo — preferência de
 * USUÁRIO, e o terceiro degrau da precedência de `chooseSearchProvider`
 * (brief, 3.9 e 3.10).
 *
 * ── Por que não é `media_types.default_provider_slug` ───────────────────────
 * O pedido literal era o seletor de `/search` escrever aquela coluna, e ela é
 * **infraestrutura da instância**: quem responde a busca NESTE SERVIDOR é
 * decisão do admin (brief, 3.9), e a escrita é guardada por `adminMiddleware`.
 * Um não-admin trocando a fonte na busca reescreveria o padrão de **todo
 * mundo** — invisível hoje, porque `settings.registration_open` não é lida por
 * rota nenhuma e toda instalação tem exatamente um usuário, e verdadeira no dia
 * do segundo. **As duas formas são indistinguíveis hoje e divergem depois**,
 * que é a pior classe de escolha pra deixar implícita.
 *
 * A régua de 30/08 põe cada uma do seu lado sem arbitrar: *"quem responde a
 * busca neste servidor"* é do admin, *"com que fonte EU busco"* é de quem
 * busca. As duas convivem, e é a precedência que as ordena.
 *
 * ── A ausência é o padrão, como em `hidden_media_types` ─────────────────────
 * Sem linha significa **"nunca escolhi"**, e aí vale o efetivo do admin. Não há
 * o que semear: usuário novo não tem linha, **tipo criado depois nasce com o
 * padrão da instância pra todo mundo**, e um provedor que passe a ser o padrão
 * alcança quem nunca opinou. Guardar a escolha de todo mundo pra todo tipo
 * obrigaria a semear uma linha por (usuário, tipo) na criação do tipo, e
 * congelaria a decisão do admin no instante em que cada usuário apareceu.
 *
 * ── Uma fonte por TIPO, e não uma fonte só ──────────────────────────────────
 * O slug de um provedor só é legível dentro do par (brief, 3.10): `21` é anime
 * num provedor e mangá noutro, e "a última fonte que usei" sem o tipo ao lado
 * não é uma frase completa. É também o que o `localStorage` de 10/09 não fazia
 * — ele guardava **um par**, então escolher Kitsu pra mangá esquecia o que
 * valia pra anime.
 *
 * ── O que ela NÃO alcança ───────────────────────────────────────────────────
 * Só a BUSCA. De qual vínculo uma obra fala continua sendo
 * `entries.primary_provider` (02/09), e a arte continua saindo do efetivo do
 * par — senão duas pessoas veriam pôsteres diferentes da mesma obra, e a arte é
 * cacheada por (provedor, id externo) pra instalação inteira.
 *
 * `ON DELETE CASCADE` nos três: apagar o usuário leva a preferência dele,
 * apagar o tipo ou o provedor apaga uma linha que deixaria de significar
 * alguma coisa. **O que a FK não cobre é a associação cair** — o par
 * (tipo, provedor) pode deixar de existir com as duas pontas vivas, e por isso
 * a leitura valida contra `media_type_providers` em vez de confiar na coluna.
 */
export const preferredSearchSources = sqliteTable(
  'preferred_search_sources',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaTypeSlug: text('media_type_slug')
      .notNull()
      .references(() => mediaTypes.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    providerSlug: text('provider_slug')
      .notNull()
      .references(() => providers.slug, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mediaTypeSlug] })],
)

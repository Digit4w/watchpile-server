import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { mediaTypes } from './media-types.js'
import { users } from './users.js'

/**
 * Que tipos de mídia um usuário escondeu — preferência de USUÁRIO, e o outro
 * objeto de "tipo de mídia" (brief, 3.9 e 3.12).
 *
 * São dois objetos e não um: *definir* o tipo (nome, ícone, unidade de
 * progresso, se pergunta total) é vocabulário da INSTÂNCIA e mora em
 * `media_types`, escrito só pelo admin; *escolher quais tipos eu vejo* é
 * preferência de exibição, é de cada um, e mora aqui. Tipo por usuário daria
 * vocabulários disjuntos no mesmo servidor — esconder um tipo não dá.
 *
 * **A tabela guarda o que está ESCONDIDO, não o que está visível**, e a
 * assimetria é o comportamento que se quer: o padrão é ver tudo, então usuário
 * que nunca abriu esta tela não tem linha nenhuma, e **tipo criado depois nasce
 * visível pra todo mundo** sem que ninguém precise semear nada. Guardar os
 * visíveis obrigaria a semear uma linha por (usuário, tipo) na criação do tipo,
 * e um tipo novo apareceria escondido pra quem já existia — o oposto do que o
 * admin quis ao criá-lo.
 *
 * **Ela recorta o que é OFERECIDO, nunca o que existe** (04/09/2026, decisão do
 * dono). Some dos lugares onde o app oferece tipo como escolha — os chips de
 * `/library`, o filtro de widget, o escopo da busca, o seletor da folha de
 * criar obra. A obra que já existe de um tipo escondido **continua visível**:
 * preferência mexe em controle, não em conteúdo, senão a contagem de uma pilha
 * deixa de bater com o que se vê e a obra some sem dizer pra onde foi.
 *
 * **Na conta, não no aparelho.** É o que a separa da sidebar recolhida, que é
 * `localStorage` porque é preferência de aparelho (design system, seção 5).
 * Esta é recorte de conteúdo, e conteúdo é do usuário (brief, 3.9) — o usuário
 * é uma linha no banco, não um navegador.
 *
 * `ON DELETE CASCADE` dos dois lados: apagar o tipo apaga a preferência sobre
 * ele, que deixaria de significar coisa alguma; apagar o usuário leva a dele
 * junto.
 */
export const hiddenMediaTypes = sqliteTable(
  'hidden_media_types',
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
  },
  (table) => [primaryKey({ columns: [table.userId, table.mediaTypeSlug] })],
)

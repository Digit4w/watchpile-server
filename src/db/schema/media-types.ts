import { sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { providers } from './providers.js'

/**
 * Tipo de mídia — vocabulário da INSTÂNCIA, não do usuário (brief, 3.9 e 3.12).
 *
 * Ele substitui o enum de seis valores que vivia em `entries.media_type`. A
 * invariante de 3.12 não mudou: obra continua sendo uma linha em `entries` com
 * o tipo como dado. O que mudou é a origem da lista — de literal em código para
 * linha em tabela.
 *
 * **Por que o `slug` é a chave estrangeira, e não o `id`.** A FK de `entries`
 * aponta pra cá por `slug` (TEXT), não pelo inteiro, e isso é decisão, não
 * atalho: o slug já está denormalizado em dois lugares que não podem virar
 * inteiro — o filtro de widget guarda `{"mediaType": ["movie"]}` em JSON
 * (`home-widgets.filter.ts`) e a URL de `/library` carrega `?type=movie`
 * (brief, 3.13). Trocar por id quebraria os filtros gravados e faria a URL
 * deixar de valer entre instalações.
 *
 * O preço é que **o slug é imutável**. Não há rota que o altere, e é assim que
 * tem que ser: ele é a chave estável pra URL e pra futura associação
 * tipo↔provedor (3.10). Quem quiser outro nome muda o NOME, que é texto e é por
 * idioma — o slug nunca foi feito pra ser lido.
 */
export const mediaTypes = sqliteTable('media_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Estável e imutável. Chave da FK de `entries`, da URL e do filtro. */
  slug: text('slug').notNull().unique(),
  /**
   * Nome do glifo no acervo curado (design system, seções 2 e 5) — um nome do
   * `lucide-react`, como `clapperboard`. Não é um SVG: o servidor não guarda
   * desenho, guarda a escolha.
   */
  icon: text('icon').notNull(),
  /**
   * Se o tipo CONTA progresso (07/09/2026, decisão do dono).
   *
   * **Ele nasceu de um `asks_total` que respondia duas perguntas.** Filme tinha
   * `asks_total = 0` porque não há o que contar; um webnovel teria o mesmo `0`
   * porque conta e não sabe o total — duas situações opostas na mesma coluna.
   * A régua do projeto pra esse formato já tinha aparecido duas vezes (tipo de
   * mídia virou dois objetos em 31/08, `default_provider_slug` perdeu uma
   * responsabilidade em 02/09): **quando um campo responde duas perguntas,
   * separam-se os objetos.**
   *
   * **Mas a segunda pergunta não precisava de campo, e o corte foi refeito no
   * mesmo dia** (`0045`): *"o formulário pergunta o total?"* já tinha resposta
   * — ele pergunta, opcionalmente, sempre que houver o que contar. O que
   * sobrou aqui é a primeira pergunta, sozinha.
   *
   * | `countsProgress` | Quem é | A folha de criar obra |
   * | --- | --- | --- |
   * | `false` | filme, jogo, livro | sem campo de total; a obra nasce `1` |
   * | `true` | série, anime, mangá | campo de total **opcional** |
   *
   * **Ele nasceu ao lado de um `asks_total`, que foi REMOVIDO na `0045`.**
   * Aquele campo dizia se o formulário pergunta o total, e depois desta
   * separação não sobrou uso legítimo pra ele: o campo de total já é opcional,
   * então deixá-lo em branco produz o mesmo `null` que `asks_total: false`
   * produzia — e o `false` tirava a capacidade de registrar um total que É
   * conhecido. Um webnovel terminado tem número de capítulos, e num tipo com
   * `asks_total: false` não havia onde escrevê-lo. **Quem responde "esta obra
   * tem fim conhecido?" é `entries.total`, que é por OBRA — onde a pergunta
   * pertence.**
   *
   * **Não confundir com `entries.total` nulo**, que é a mesma ideia um nível
   * abaixo: lá a OBRA específica não sabe o total (o `12 / ?` da 3.11); aqui é
   * o TIPO que nunca sabe. Os dois convivem.
   *
   * É regra de EXIBIÇÃO, não de escrita: `entries.progress` de um filme que já
   * tem número continua válido e continua gravável (o import escreve pra
   * qualquer tipo). O que muda é que nenhuma peça de acompanhamento desenha
   * contador — apagar o dado por causa de uma regra de tela seria irreversível.
   */
  countsProgress: integer('counts_progress', { mode: 'boolean' })
    .notNull()
    .default(true),
  /**
   * Este tipo registra TEMPO investido? — 10/09/2026, decisão do dono.
   *
   * **É outra pergunta que `counts_progress`, e as duas convivem.** O contador
   * responde *quanto do acervo você percorreu* — tem unidade, tem denominador e
   * tem fim. O tempo responde *quanto você investiu* — não tem nenhum dos três.
   * Jogo é o caso que separou as duas: ele **não conta** (`0044`) e ainda assim
   * alguém quer registrar quarenta horas.
   *
   * ── Por que a decisão mora no TIPO, e não na obra ─────────────────────────
   * A alternativa era uma coluna em `entries` que só um tipo usaria, e ela
   * cobraria no terceiro tipo que quisesse o mesmo. Aqui a pergunta é
   * vocabulário — audiolivro, podcast e curso têm exatamente o mesmo formato —,
   * e o vocabulário é aberto desde 30/08: o admin liga onde faz sentido, sem
   * código novo. É a mesma régua que já pôs `progress_unit` e `counts_progress`
   * neste lado.
   *
   * **Padrão `false`.** A maioria dos tipos não tem tempo a registrar, e um
   * campo a mais em toda obra de toda instalação seria o oposto de "preferência
   * existe onde o sistema não tem opinião". Só `game` nasce ligado.
   *
   * **Onde `counts_progress` mora, este também mora**: os dois são do TIPO e não
   * mudam com o idioma, ao contrário de `progress_unit`. A unidade do tempo não
   * é campo nenhum — é sempre minuto no banco e sempre `2h30` na tela.
   */
  tracksTime: integer('tracks_time', { mode: 'boolean' })
    .notNull()
    .default(false),
  /**
   * O provedor PADRÃO deste tipo — quem responde a busca dele (brief, 3.10,
   * 01/09/2026; escopo reduzido à busca em 02/09).
   *
   * **Chamava-se "canônico" e decidia duas coisas.** A outra era de qual
   * vínculo cada obra falava, e ela saiu daqui em 02/09/2026: virou
   * `entries.primary_provider`, do lado do usuário. Esta coluna é o valor CRU;
   * `effectiveProviderOf` é a resolução dela.
   *
   * **Ele não é a lista de provedores do tipo.** São perguntas diferentes e por
   * isso duas peças: `media_type_providers` responde *quais provedores são
   * opção* — e continua muitos-para-muitos, porque fonte única não resolve
   * **cobertura**, e manhwa e webnovel são onde isso morde primeiro. Esta coluna
   * responde *qual deles responde a busca*, que sem ela cairia no desempate por
   * slug — arbitrário, e pior: mudaria sozinho ao entrar um provedor novo.
   *
   * **Nulável, e o nulo é legítimo** — é o estado de quatro dos seis tipos. Sem
   * padrão, a busca desempata pelo primeiro slug (`chooseSearchProvider`), e a
   * tela nomeia quem respondeu.
   *
   * `onDelete: 'set null'` e não `restrict`: perder o padrão degrada o tipo pro
   * estado nulo, que é um estado que ele já sabe ocupar. Recusar apagar o
   * provedor por causa disto seria deixar uma preferência segurando
   * infraestrutura.
   */
  defaultProviderSlug: text('default_provider_slug').references(
    () => providers.slug,
    { onUpdate: 'cascade', onDelete: 'set null' },
  ),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * O texto do tipo, por idioma (brief, 3.12).
 *
 * Tabela e não colunas JSON: a queda de idioma é uma consulta, e normalizada
 * ela é um `WHERE locale IN (...)` em vez de leitura de JSON em SQL. Idioma
 * novo no catálogo vira linha, não migration.
 *
 * **Os três campos aqui são os que são TEXTO.** `icon` e `countsProgress` ficam
 * na tabela do tipo porque não mudam com o idioma (design system, seção 5).
 *
 * `plural` é coluna própria, nunca o singular com um "s" colado: "Series" não
 * muda em inglês e em pt-BR a regra é outra — concatenar é o que trava tradução
 * (brief, 3.8).
 *
 * `progressUnit` é nulo em todo tipo que não conta — filme, jogo e, desde a
 * `0048`, livro. **Unidade ao lado de um tipo sem contador é um par que a tela
 * não sabe explicar**, e a linha de `/settings/media-types` mostra os dois.
 *
 * O motivo de cada nulo é diferente, e vale registrar: filme não tem o que
 * contar; jogo contaria sem unidade natural (uns contam horas, outros
 * capítulos, outros conquistas), e impor "horas" decidiria pelo usuário; livro
 * conta páginas de verdade, e o dono decidiu que o produto não as pede — a
 * pergunta que sobra ("quantas páginas tem?") já tem resposta por OBRA, em
 * `entries.total`.
 */
export const mediaTypeNames = sqliteTable(
  'media_type_names',
  {
    mediaTypeId: integer('media_type_id')
      .notNull()
      .references(() => mediaTypes.id, { onDelete: 'cascade' }),
    /** BCP 47, como o catálogo do cliente: `en`, `pt-BR`. */
    locale: text('locale').notNull(),
    name: text('name').notNull(),
    plural: text('plural').notNull(),
    progressUnit: text('progress_unit'),
  },
  (table) => [primaryKey({ columns: [table.mediaTypeId, table.locale] })],
)

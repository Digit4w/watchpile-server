import { z } from '@hono/zod-openapi'

/** BCP 47 no formato que o catálogo do cliente usa: `en`, `pt-BR`. */
export const LocaleSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, {
  message: 'Locale must look like "en" or "pt-BR"',
})

export const LocalizedNameSchema = z.object({
  name: z.string().trim().min(1),
  plural: z.string().trim().min(1),
  /**
   * Nulo em dois casos DIFERENTES, e nenhum deles é esquecimento: filme não
   * conta nada, e jogo conta sem ter unidade natural (brief, 3.12).
   */
  progressUnit: z
    .string()
    .trim()
    .nullish()
    .transform((unit) => unit || null),
})

/**
 * O mapa por idioma. **Pelo menos um** preenchido, nunca todos.
 *
 * Exigir todos obrigaria um admin brasileiro a inventar o nome em inglês de um
 * tipo que só ele usa — trava a criação por uma razão que não é dele (brief,
 * 3.12). Exigir zero deixaria a queda de idioma sem degrau 3 e devolveria nome
 * vazio, que é pior que a chatice de preencher.
 */
export const NameMapSchema = z
  .record(LocaleSchema, LocalizedNameSchema)
  .refine((map) => Object.keys(map).length > 0, {
    message: 'At least one language must be filled in',
  })

export const MediaTypeSchema = z.object({
  slug: z.string(),
  /**
   * Nome do glifo no acervo curado (`media-types.icons.ts`).
   *
   * Na RESPOSTA ele é `string`, não o enum: um banco semeado por uma versão
   * mais nova do produto pode ter um glifo que este binário não conhece, e
   * responder 500 por causa disso seria pior que devolver o nome e deixar o
   * cliente cair no genérico. Na ESCRITA é enum — é lá que a garantia importa.
   */
  icon: z.string(),
  /**
   * Há o que contar neste tipo? (07/09/2026, decisão do dono.)
   *
   * Decide se a peça de acompanhamento desenha `+`/`−` ou o controle de status,
   * e se a folha de criar obra oferece o campo de total. Ele teve um irmão
   * (`asks_total`) por algumas horas — ver `db/schema/media-types.ts` pra por
   * que o irmão saiu.
   */
  countsProgress: z.boolean(),
  /**
   * Este tipo registra TEMPO investido? — 10/09/2026.
   *
   * **Outra pergunta que `countsProgress`, e as duas convivem.** O contador
   * responde *quanto do acervo você percorreu*; o tempo responde *quanto você
   * investiu*, e não tem unidade, denominador nem fim. Jogo é o caso que
   * separou as duas: ele não conta e ainda assim alguém quer registrar
   * quarenta horas.
   */
  tracksTime: z.boolean(),
  /**
   * Quantas obras usam o tipo, **de todos os usuários**. É o número que sustenta
   * a recusa de apagar, e é por isso que ele viaja na lista e não só no detalhe:
   * a tela mostra a contagem na linha pra que a recusa não surpreenda quem abre
   * a folha (design system, seção 5).
   */
  entryCount: z.number().int(),
  /** Já resolvido pela queda de idioma — o que 95% das telas consome. */
  name: z.string(),
  plural: z.string(),
  progressUnit: z.string().nullable(),
  /**
   * Os provedores que servem este tipo, por slug. Muitos-para-muitos e
   * **opcional**: vazio é o estado de quatro dos seis semeados, e é legítimo —
   * o que ele muda é a busca, que diz isso em voz alta (brief, 3.10).
   */
  providers: z.array(z.string()),
  /**
   * Qual deles responde a busca deste tipo — o EFETIVO, já resolvido
   * (`media-types.query.ts`). Nulo quando ninguém decidiu e há mais de um
   * candidato: chutar o primeiro seria decidir por alfabeto.
   */
  effectiveProvider: z.string().nullable(),
  /**
   * O mapa cru, que só a folha de edição usa. Viaja junto em vez de virar uma
   * segunda rota porque são seis linhas com dois idiomas: separar custaria um
   * round-trip pra economizar bytes que não existem.
   */
  names: z.record(z.string(), LocalizedNameSchema),
})

export type MediaTypePublic = z.infer<typeof MediaTypeSchema>

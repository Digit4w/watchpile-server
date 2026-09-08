/**
 * O slug é DERIVADO do nome, não pedido ao admin.
 *
 * A folha de tipo (design system, seção 5) tem quatro campos, e nenhum deles é
 * "slug": pedir um identificador a quem só quer chamar a coisa de "Podcast"
 * seria expor um detalhe de schema como se fosse decisão de produto.
 *
 * Ele é imutável depois de criado — a FK de `entries` aponta pra ele, a URL de
 * `/library` o carrega e o filtro de widget o guarda em JSON. Renomear o TIPO
 * muda o nome, que é texto por idioma; o slug fica onde está.
 *
 * Por isso ele sai do PRIMEIRO nome preenchido e nunca é recalculado: um tipo
 * criado como "Podcast" e depois renomeado para "Podcasts" continua sendo
 * `podcast`, e ninguém precisa saber disso.
 */
const ACCENTS = /[̀-ͯ]/g
const NON_ALNUM = /[^a-z0-9]+/g
const EDGES = /^-+|-+$/g

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(NON_ALNUM, '-')
    .replace(EDGES, '')

  // Um nome inteiramente fora do alfabeto latino — "ポッドキャスト" — vira
  // string vazia aqui, e slug vazio quebraria a FK e a URL. `type` é um
  // fallback deliberado: o sufixo numérico de `uniqueSlug` faz o resto.
  return base || 'type'
}

/**
 * Desempata contra os slugs que já existem. O sufixo é numérico e começa em 2
 * porque "podcast-2" se lê como o segundo podcast; "podcast-1" sugeriria que
 * existe um "podcast-0".
 */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name)
  if (!taken.includes(base)) {
    return base
  }

  let n = 2
  while (taken.includes(`${base}-${n}`)) {
    n += 1
  }
  return `${base}-${n}`
}

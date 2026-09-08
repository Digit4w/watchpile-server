export type LocalizedName = {
  name: string
  plural: string
  progressUnit: string | null
}

export type NameMap = Record<string, LocalizedName>

/**
 * A queda de idioma, em três degraus (brief, 3.12).
 *
 * 1. o idioma de quem está lendo;
 * 2. o idioma da **INSTÂNCIA** — não a língua-base do produto. A distinção é o
 *    ponto: num servidor brasileiro cujo admin preencheu só o pt-BR, cair no
 *    inglês do produto cairia num campo vazio;
 * 3. o primeiro idioma preenchido.
 *
 * O terceiro degrau é o que garante que **nunca sobra vazio**, e ele só é
 * confiável porque a escrita exige pelo menos um idioma. Sem ele a função
 * devolveria nome em branco justamente no caso mais comum de instalação
 * self-hosted: o servidor monolíngue.
 *
 * Pura de propósito: é a regra que mais vai ser lida por quem chegar depois, e
 * regra de negócio dentro de handler não se testa sem subir um servidor.
 */
export function resolveName(
  names: NameMap,
  viewerLocale: string | undefined,
  instanceLocale: string,
): LocalizedName | undefined {
  if (viewerLocale && names[viewerLocale]) {
    return names[viewerLocale]
  }

  if (names[instanceLocale]) {
    return names[instanceLocale]
  }

  // `Object.values` segue a ordem de inserção das chaves, e quem monta o mapa
  // lê do banco ordenado por locale — então "o primeiro preenchido" é estável
  // entre duas chamadas, e não muda de resposta a cada request.
  return Object.values(names)[0]
}

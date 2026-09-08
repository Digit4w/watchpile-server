/**
 * O teto do que vai pra tela.
 *
 * **400 porque o único caso REAL medido ocupa 186** — o 403 do AniList, com o
 * envelope GraphQL inteiro em volta da frase útil. Ele cabia em 200 por catorze
 * caracteres, e um teto que o caso conhecido raspa é um teto calibrado contra
 * nada: um envelope com preâmbulo um pouco maior cortaria justamente a frase
 * que esta peça existe pra mostrar, deixando na tela 200 caracteres de andaime.
 *
 * O dobro do medido é margem declarada, não chute — e o teto continua existindo
 * porque corpo de terceiro não tem tamanho prometido.
 */
const MAX = 400

/**
 * O que o provedor escreveu, pronto pra tela — ou `null`.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * `Test connection` dizia `AniList refused the request (403)` enquanto o corpo
 * da resposta trazia *"The AniList API has been temporarily disabled"*. A
 * categoria está certa e é traduzível; a frase é a que resolve o problema de
 * quem está olhando, e ela não tem como ser traduzida (ver `ProviderTestSchema`).
 *
 * ── A credencial é RASPADA, e essa é a regra que não pode cair ──────────────
 * O `catch` deste endpoint não devolve a mensagem do `Error` **desde sempre**,
 * porque ela carrega a URL montada e a URL carrega a chave na query quando o
 * estilo é `query-key` — que é o do TMDB. Corpo de resposta é outra coisa: veio
 * do provedor, não do nosso pedido.
 *
 * **Mas provedor que ecoa o pedido de volta existe**, e um erro do tipo
 * *"invalid request: /3/search/movie?api_key=abc123"* devolveria o segredo por
 * uma porta nova. Então toda credencial resolvida sai do texto antes de ele
 * viajar. **A raspagem é por VALOR e não por nome de parâmetro**: o valor é o
 * que vaza, e ele vaza igual em query, em header ecoado ou no meio de uma frase.
 *
 * ── HTML vira nulo ──────────────────────────────────────────────────────────
 * Página de erro de proxy é a INFRAESTRUTURA do provedor falando, não o
 * provedor: os primeiros 200 caracteres dela são `<!DOCTYPE html><html>…`, que
 * não dizem nada. Converter pra texto (como `providers.text.ts` faz com sinopse)
 * daria "502 Bad Gateway nginx", que a categoria já disse melhor.
 *
 * ── E o espaço em branco colapsa ────────────────────────────────────────────
 * JSON de erro vem indentado, e as quebras fariam a peça da tela crescer sem
 * conteúdo novo. O que interessa é a frase, não o formato dela.
 */
export function providerDetail(
  raw: string | null | undefined,
  /** Os valores resolvidos das credenciais deste provedor. */
  secrets: readonly (string | null | undefined)[] = [],
): string | null {
  if (!raw) {
    return null
  }

  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.startsWith('<')) {
    return null
  }

  let text = trimmed.replace(/\s+/g, ' ')

  for (const secret of secrets) {
    // Segredo curto demais casaria com qualquer coisa e transformaria o texto
    // numa fileira de reticências. Oito é o piso de toda chave que este
    // servidor viu.
    if (!secret || secret.length < 8) {
      continue
    }
    text = text.split(secret).join('…')
  }

  if (text.length <= MAX) {
    return text
  }

  // O corte é no texto já raspado: cortar antes deixaria meia chave na ponta.
  return `${text.slice(0, MAX).trimEnd()}…`
}

/**
 * Qual de duas versões é a mais nova — regra pura, e a única que decide se há
 * atualização.
 *
 * ── Por que ela é NOSSA e não uma dependência ──────────────────────────────
 * O formato que este produto emite é `x.y.z` e nada mais. A decisão de 08/09
 * é explícita: **`0.x` já é o contrato legível por máquina de "quebra sem
 * aviso"**, e empilhar `-alpha.1` diria a mesma coisa duas vezes. Um
 * comparador de semver completo traria precedência de pré-lançamento, metadado
 * de build e coerção — vocabulário que este produto não usa, e *vocabulário
 * não exercitado é o que nasce errado*.
 *
 * ── Desconhecido NUNCA vira "há atualização" ───────────────────────────────
 * Toda entrada que não casa `x.y.z` responde **não**. O outro lado é uma
 * string que veio de terceiro (o `tag_name` de uma release), e o modo de falhar
 * importa: dizer "há versão nova" errado manda a pessoa reinstalar o que ela já
 * tem; ficar calado erra pro lado de não incomodar. É a mesma escolha do
 * `art_template` — *relativo sem molde vira nulo, nunca imagem quebrada*.
 */
export function isNewer(candidate: string, installed: string): boolean {
  const a = parse(candidate)
  const b = parse(installed)
  if (!a || !b) {
    return false
  }

  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) {
      return left > right
    }
  }
  return false
}

/**
 * `v0.1.0` e `0.1.0` são a mesma versão.
 *
 * O `v` é convenção de TAG do git — é assim que este repositório nomeia a
 * release —, e o `package.json` guarda o número sem ele. Comparar os dois como
 * texto diria que são diferentes toda vez.
 *
 * **Um sufixo depois do patch é aceito e IGNORADO** (`0.2.0-rc.1` conta como
 * `0.2.0`), em vez de recusado: se um dia uma tag trouxer um, recusá-la faria
 * a instalação parar de ver atualização **em silêncio**, que é o modo de falhar
 * mais caro dos dois. Aceitar erra por chamar de igual duas coisas que quase
 * são.
 */
function parse(raw: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(raw.trim())
  if (!match) {
    return null
  }
  const [, major, minor, patch] = match
  return [Number(major), Number(minor), Number(patch)]
}

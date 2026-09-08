/**
 * Escreve as credenciais embarcadas no build — e SÓ no build.
 *
 * `src/features/providers/providers.embedded.ts` guarda dois literais vazios no
 * repositório (ver o cabeçalho de lá). Este script os preenche a partir de
 * variáveis de ambiente, e é o CI quem as fornece, de secrets do GitHub.
 *
 * ── Por que substituição por REGEX, e não geração do arquivo ────────────────
 * O arquivo carrega um bloco de documentação que é metade do valor dele —
 * gerá-lo por inteiro apagaria essa prosa a cada build, ou a duplicaria dentro
 * deste script. As duas constantes existem lá **para serem alvo**: cada uma
 * numa linha só, com nome próprio, é o que torna a substituição previsível sem
 * precisar de um parser de TypeScript.
 *
 * ── O que este script NUNCA faz ────────────────────────────────────────────
 * Imprimir valor. O log diz quais chaves foram preenchidas pelo NOME, e mais
 * nada — o mascaramento de secret do GitHub é uma rede, não uma licença para
 * escrever o valor e confiar nela.
 *
 * ── Faltar secret NÃO derruba o build ──────────────────────────────────────
 * Literal vazio é o modo de falha aceito desde 30/08/2026: a instalação degrada
 * para "configure a sua". Derrubar o build faria uma release inteira parar por
 * causa de uma chave que o produto sabe viver sem — mas o log DIZ qual faltou,
 * porque descobrir isso pela tela de um usuário seria tarde.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'src/features/providers/providers.embedded.ts'

/** A constante no arquivo ↔ a variável de ambiente que a preenche. */
const SLOTS = [
  { constant: 'EMBEDDED_TMDB_API_KEY', env: 'EMBED_TMDB_API_KEY' },
  { constant: 'EMBEDDED_MAL_CLIENT_ID', env: 'EMBED_MAL_CLIENT_ID' },
]

let source = readFileSync(FILE, 'utf8')
const filled = []
const missing = []

for (const { constant, env } of SLOTS) {
  const value = process.env[env]?.trim()

  if (!value) {
    missing.push(env)
    continue
  }

  /**
   * Aspas simples e barra invertida quebrariam o literal. Nenhuma chave que
   * este projeto viu tem qualquer uma das duas — mas escapar custa uma linha, e
   * um secret malformado que produzisse TypeScript inválido derrubaria o build
   * com um erro que não aponta pra cá.
   */
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const pattern = new RegExp(`^const ${constant} = '[^']*'$`, 'm')

  if (!pattern.test(source)) {
    // O alvo sumiu: alguém renomeou a constante ou mudou a forma da linha. Isto
    // SIM derruba o build, porque o modo de falha silencioso seria publicar uma
    // imagem sem chave achando que a pôs.
    console.error(`embed-credentials: alvo não encontrado para ${constant}`)
    process.exit(1)
  }

  source = source.replace(pattern, `const ${constant} = '${escaped}'`)
  filled.push(constant)
}

writeFileSync(FILE, source)

console.log(
  `embed-credentials: preenchidas ${filled.length ? filled.join(', ') : '(nenhuma)'}`,
)
if (missing.length > 0) {
  console.log(
    `embed-credentials: sem secret para ${missing.join(', ')} — a instalação vai pedir a chave em Settings`,
  )
}

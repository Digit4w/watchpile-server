import { readFileSync } from 'node:fs'
import { EMBEDDED_CREDENTIALS } from './providers.embedded.js'

/**
 * De onde a credencial que está valendo veio.
 *
 * Ela viaja na resposta do `GET` porque a tela precisa dela pra duas coisas
 * diferentes (brief, 3.10; design system, seção 5):
 *
 * - `env` e `file` **desabilitam o campo** com o motivo escrito. Se o env vence
 *   e a UI continua deixando digitar, a pessoa edita, salva e nada acontece —
 *   config em duas fontes sem indicação é a armadilha clássica
 * - `embedded` vira **estado na linha do provedor**: "usa a chave embutida",
 *   não dispensável, porque não é aviso — é descrição da linha, e some sozinho
 *   quando deixa de ser verdade
 */
export type CredentialSource = 'env' | 'file' | 'stored' | 'embedded' | 'none'

export type ResolvedCredential = {
  value: string
  source: CredentialSource
}

/**
 * O nome da variável de ambiente de uma credencial.
 *
 * `WATCHPILE_PROVIDER_TMDB_API_KEY`, e o `_FILE` correspondente aponta pro
 * arquivo — a forma de secret do Docker, e a mesma que o Yamtrack usa.
 *
 * **Derivado do par (slug, chave), nunca de uma lista.** Provedor que o usuário
 * cadastrar ganha env var pelo mesmo caminho, sem passar por `env.ts`: a lista
 * de provedores é dado, e um schema estático não consegue descrevê-la. Isso não
 * fura a regra do brief 3.9 — nada aqui é requisito, é tudo override.
 */
export function envVarFor(providerSlug: string, credentialKey: string): string {
  const part = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return `WATCHPILE_PROVIDER_${part(providerSlug)}_${part(credentialKey)}`
}

/**
 * A precedência, em quatro degraus: **env > arquivo de secret > guardada no
 * banco > literal embutido** (brief, 3.10).
 *
 * O brief escreve a cadeia como três degraus — env, arquivo, embutido — porque
 * está descrevendo de onde o PRODUTO tira uma chave. O degrau guardado entra
 * entre o arquivo e o embutido porque é a única posição que respeita as duas
 * pontas: o admin que digitou a dele tem que vencer o literal que veio na
 * release, e quem automatizou por env tem que vencer o que está no banco — que
 * é justamente o caso em que o campo aparece desabilitado.
 *
 * String vazia conta como **ausente** em todo degrau. É isso que faz o literal
 * embutido vazio de hoje degradar para "configure a sua" em vez de se anunciar
 * como uma chave que existe e não funciona.
 */
export function resolveCredential(
  providerSlug: string,
  credentialKey: string,
  stored: Record<string, string>,
): ResolvedCredential {
  const envName = envVarFor(providerSlug, credentialKey)

  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) {
    return { value: fromEnv, source: 'env' }
  }

  const filePath = process.env[`${envName}_FILE`]?.trim()
  if (filePath) {
    // Falha de leitura NÃO derruba a resolução: um `_FILE` apontando pro lugar
    // errado é erro de quem hospeda, e travar o boot por causa dele
    // contrariaria a regra de que nada obrigatório vem de env (brief, 3.9). Cai
    // pro degrau seguinte, e a tela mostra de onde a chave veio de verdade.
    try {
      const contents = readFileSync(filePath, 'utf8').trim()
      if (contents) {
        return { value: contents, source: 'file' }
      }
    } catch {
      // segue a cadeia
    }
  }

  const fromStore = stored[credentialKey]?.trim()
  if (fromStore) {
    return { value: fromStore, source: 'stored' }
  }

  const embedded = EMBEDDED_CREDENTIALS[providerSlug]?.[credentialKey]?.trim()
  if (embedded) {
    return { value: embedded, source: 'embedded' }
  }

  return { value: '', source: 'none' }
}

/**
 * Se o campo pode ser editado na tela.
 *
 * `env` e `file` vencem o que estiver no banco, então deixar digitar seria
 * prometer um efeito que não vai acontecer. `embedded` **não** trava: trocar a
 * chave embutida pela sua é justamente o que a tela recomenda.
 */
export function isOverridden(source: CredentialSource): boolean {
  return source === 'env' || source === 'file'
}

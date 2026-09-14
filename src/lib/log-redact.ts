/**
 * O segredo sai da linha ANTES de ela ir pra qualquer lugar — 14/09/2026.
 *
 * **Sempre, e no emissor**, decisão do dono. É a mesma régua que já vale uma
 * camada abaixo: o `GET` de provedor nunca devolve a credencial, e a mensagem de
 * erro de rede é FIXA pra não repetir a URL montada. Um log que alguém cola num
 * Discord pra pedir ajuda não pode ser a porta que aquelas duas decisões
 * fecharam — e ele é arquivo, então vaza também pelo backup e pelo download.
 *
 * Roda sobre a linha JÁ SERIALIZADA (`hooks.streamWrite` do pino), e isso é o que
 * a faz cobrir o que não se enumera: mensagem de `Error`, stack, URL dentro de um
 * campo qualquer. Duas raspagens, porque cada uma pega o que a outra não pega:
 *
 * - **Por VALOR** — as credenciais resolvidas e o segredo de sessão, registrados
 *   por quem os conhece (`registerSecret`). É a régua de `providerDetail`: o
 *   valor é o que vaza, e ele vaza igual em query, em header ecoado ou no meio de
 *   uma frase
 * - **Por NOME** — cookie, authorization e senha em campo JSON, e parâmetro de
 *   credencial em query string. Pega o que nunca passou pelo registro: o cookie
 *   de sessão de quem fez a requisição, a senha num corpo, uma chave digitada
 *   errado que por isso nunca foi resolvida
 */

export const REDACTED = '[redacted]'

// Segredo curto demais casaria com qualquer coisa. Oito é o piso de toda chave
// que este servidor viu — o mesmo de `providerDetail`.
const MIN_SECRET_LENGTH = 8

const secrets = new Set<string>()

export function registerSecret(value: string | null | undefined): void {
  const trimmed = value?.trim()
  if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) {
    secrets.add(trimmed)
  }
}

/** Só pra teste: o registro é do processo, e um teste não pode vazar pro outro. */
export function forgetSecrets(): void {
  secrets.clear()
}

const SENSITIVE_JSON_KEY =
  /("(?:cookie|set-cookie|authorization|proxy-authorization|password|client-id|x-mal-client-id|client_secret|access_token)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi

const SENSITIVE_QUERY_PARAM =
  /([?&](?:api_key|apikey|client_id|client_secret|access_token|token|password)=)[^&\s"'\\]+/gi

export function redactLine(line: string): string {
  let out = line
  for (const secret of secrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTED)
    }
  }
  return out
    .replace(SENSITIVE_JSON_KEY, `$1"${REDACTED}"`)
    .replace(SENSITIVE_QUERY_PARAM, `$1${REDACTED}`)
}

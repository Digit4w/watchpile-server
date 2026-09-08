import { beforeEach, describe, expect, it } from 'vitest'
import { forgetToken, resetTokens, tokenFor } from './providers.token.js'

const BASE = {
  providerSlug: 'igdb',
  tokenUrl: 'https://id.twitch.tv/oauth2/token',
  clientId: 'um-id',
  clientSecret: 'um-secret',
  timeoutMs: 10_000,
}

/** Um endpoint de token que conta quantas vezes foi chamado. */
function respond(body: unknown, status = 200) {
  const calls: string[] = []
  const impl: typeof fetch = async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { impl, calls }
}

beforeEach(() => {
  resetTokens()
})

describe('a troca de token', () => {
  it('manda id, secret e grant_type na QUERY', () => {
    // Verificado ao vivo: com o par na query o endpoint da Twitch lê os
    // parâmetros e responde `invalid client` a um par errado — ou seja, chegou
    // a avaliá-los, em vez de reclamar do formato.
    const { impl, calls } = respond({ access_token: 'x', expires_in: 100 })
    return tokenFor({ ...BASE, fetchImpl: impl }).then(() => {
      const url = new URL(calls[0] ?? '')
      expect(url.searchParams.get('client_id')).toBe('um-id')
      expect(url.searchParams.get('client_secret')).toBe('um-secret')
      expect(url.searchParams.get('grant_type')).toBe('client_credentials')
    })
  })

  it('guarda o token e NÃO vai à rede de novo', async () => {
    /**
     * O ponto do módulo inteiro: o token da Twitch vale 61,7 dias medidos, e
     * pedir um a cada busca bateria neles por um valor que não muda em dois
     * meses.
     */
    const { impl, calls } = respond({
      access_token: 'tok',
      expires_in: 5_327_537,
    })

    const first = await tokenFor({ ...BASE, fetchImpl: impl })
    const second = await tokenFor({ ...BASE, fetchImpl: impl })

    expect(first).toEqual({ ok: true, token: 'tok' })
    expect(second).toEqual({ ok: true, token: 'tok' })
    expect(calls).toHaveLength(1)
  })

  it('troca de novo quando o guardado venceu', async () => {
    const { impl, calls } = respond({
      access_token: 'tok',
      expires_in: 120,
    })

    await tokenFor({ ...BASE, fetchImpl: impl, agora: 0 })
    // 120s de validade menos 60s de folga: aos 61s ele já não serve.
    await tokenFor({ ...BASE, fetchImpl: impl, agora: 61_000 })

    expect(calls).toHaveLength(2)
  })

  it('a FOLGA vale — aos 59s o guardado ainda serve', async () => {
    // A folga existe porque entre decidir usar o token e ele chegar do outro
    // lado passa uma viagem de rede, e os dois relógios não são o mesmo.
    const { impl, calls } = respond({
      access_token: 'tok',
      expires_in: 120,
    })

    await tokenFor({ ...BASE, fetchImpl: impl, agora: 0 })
    await tokenFor({ ...BASE, fetchImpl: impl, agora: 59_000 })

    expect(calls).toHaveLength(1)
  })

  it('`forgetToken` obriga a próxima a trocar — é o caminho do 401', async () => {
    /**
     * Sem isto, um token revogado do lado deles ficaria válido aqui por dois
     * meses: toda busca voltaria 401 e o "testar conexão" diria que está tudo
     * bem, porque a credencial de fato está certa.
     */
    const { impl, calls } = respond({
      access_token: 'tok',
      expires_in: 5_327_537,
    })

    await tokenFor({ ...BASE, fetchImpl: impl })
    forgetToken('igdb')
    await tokenFor({ ...BASE, fetchImpl: impl })

    expect(calls).toHaveLength(2)
  })

  it('provedor que não anuncia validade NÃO é guardado', async () => {
    // Guardar sem saber até quando é escolher um número por conta própria, que
    // é o que a decisão do `timeout_ms` veio tirar do produto.
    const { impl, calls } = respond({ access_token: 'tok' })

    await tokenFor({ ...BASE, fetchImpl: impl })
    await tokenFor({ ...BASE, fetchImpl: impl })

    expect(calls).toHaveLength(2)
  })
})

describe('quando a troca não dá certo', () => {
  it('`4xx` é recusa, com o status', async () => {
    const { impl } = respond({ message: 'invalid client' }, 400)
    expect(await tokenFor({ ...BASE, fetchImpl: impl })).toEqual({
      ok: false,
      reason: 'refused',
      status: 400,
    })
  })

  it('a mensagem do provedor NÃO sobe', async () => {
    /**
     * A URL da troca carrega o secret na query. Repetir o texto do erro seria o
     * segredo saindo por um caminho que ninguém audita — a mesma regra do
     * "testar conexão".
     */
    const { impl } = respond({ message: 'invalid client um-secret' }, 400)
    const r = await tokenFor({ ...BASE, fetchImpl: impl })
    expect(JSON.stringify(r)).not.toContain('um-secret')
  })

  it('rede caída é `unreachable`', async () => {
    const impl: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }
    expect(await tokenFor({ ...BASE, fetchImpl: impl })).toEqual({
      ok: false,
      reason: 'unreachable',
    })
  })

  it('200 sem token dentro conta como recusa, e não vira string vazia', async () => {
    // Um portal cativo ou um proxy no meio responde 200 com outra coisa.
    // Guardar string vazia faria a falha aparecer longe daqui.
    const { impl } = respond({ nada: true })
    expect(await tokenFor({ ...BASE, fetchImpl: impl })).toEqual({
      ok: false,
      reason: 'refused',
      status: 200,
    })
  })

  it('recusa NÃO é guardada — a próxima tentativa vai à rede', async () => {
    const { impl, calls } = respond({ message: 'invalid client' }, 400)
    await tokenFor({ ...BASE, fetchImpl: impl })
    await tokenFor({ ...BASE, fetchImpl: impl })
    expect(calls).toHaveLength(2)
  })
})

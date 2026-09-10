import { describe, expect, it } from 'vitest'
import { providerMessage } from './providers.text.js'

describe('providerMessage', () => {
  it('acha a frase onde as APIs a colocam', () => {
    expect(providerMessage({ message: 'Invalid API key' })).toBe(
      'Invalid API key',
    )
    expect(providerMessage({ status_message: 'Invalid API key' })).toBe(
      'Invalid API key',
    )
    expect(providerMessage({ error_description: 'bad client' })).toBe(
      'bad client',
    )
  })

  it('acha a frase ANINHADA do AniList', () => {
    // A recusa dele vem em `errors: [{ message }]`, e foi o caso que motivou
    // olhar dentro de um nível.
    expect(
      providerMessage({ errors: [{ message: 'Invalid token' }], data: null }),
    ).toBe('Invalid token')
  })

  it('mostra o 401 do IGDB, que é a instrução do conserto', () => {
    expect(
      providerMessage([
        {
          title: 'Unauthorized',
          status: 401,
          cause:
            'Ensure you are sending Authorization and Client-ID as headers',
        },
      ]),
    ).toBeNull()
    expect(
      providerMessage({
        message:
          'Ensure you are sending Authorization and Client-ID as headers',
      }),
    ).toBe('Ensure you are sending Authorization and Client-ID as headers')
  })

  it('desiste em SILÊNCIO quando não acha', () => {
    // Nulo devolve exatamente a tela de ontem — copy nossa e o status ao lado.
    for (const body of [null, undefined, 42, {}, { data: {} }, []]) {
      expect(providerMessage(body)).toBeNull()
    }
  })

  it('recusa a página de HTML inteira, e limpa a curta', () => {
    // Provedor recusando manda de tudo: despejar um proxy error numa caixa de
    // 256px seria pior que o silêncio.
    expect(providerMessage('<html>'.padEnd(500, 'x'))).toBeNull()
    expect(providerMessage('<b>Rate limit</b>\n  exceeded')).toBe(
      'Rate limit exceeded',
    )
  })

  it('corta o que não cabe em duas linhas', () => {
    const long = 'a'.repeat(300)
    const out = providerMessage({ message: long })
    expect(out).toHaveLength(180)
    expect(out?.endsWith('…')).toBe(true)
  })

  it('não varre o JSON atrás de qualquer string', () => {
    // Mais de um nível seria procurar texto em objeto alheio — que é como se
    // mostra uma chave de API sem querer.
    expect(
      providerMessage({ data: { deep: { message: 'segredo' } } }),
    ).toBeNull()
  })
})

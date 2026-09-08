import { describe, expect, it } from 'vitest'
import { providerDetail } from './providers.detail-text.js'

describe('providerDetail', () => {
  it('devolve a frase do provedor, que é o que a categoria não alcança', () => {
    expect(
      providerDetail('The AniList API has been temporarily disabled'),
    ).toBe('The AniList API has been temporarily disabled')
  })

  it('colapsa o espaço em branco de um JSON indentado', () => {
    const corpo = '{\n  "errors": [\n    { "message": "Not Found" }\n  ]\n}'

    expect(providerDetail(corpo)).toBe(
      '{ "errors": [ { "message": "Not Found" } ] }',
    )
  })

  /**
   * Página de erro de proxy é a INFRAESTRUTURA do provedor falando, não o
   * provedor — e os primeiros 200 caracteres dela não dizem nada.
   */
  it('recusa HTML', () => {
    expect(providerDetail('<!DOCTYPE html><html><body>502</body></html>')).toBe(
      null,
    )
    expect(providerDetail('  <html>...')).toBe(null)
  })

  it('trata ausência e vazio como ausência', () => {
    expect(providerDetail(null)).toBe(null)
    expect(providerDetail(undefined)).toBe(null)
    expect(providerDetail('')).toBe(null)
    expect(providerDetail('   \n  ')).toBe(null)
  })

  /**
   * **A regra que não pode cair.** Um provedor que ecoa o pedido de volta
   * devolveria a chave por uma porta nova — e este endpoint já recusa a
   * mensagem do `Error` pelo mesmo motivo, desde sempre.
   */
  it('raspa a credencial que o provedor ecoou de volta', () => {
    const corpo = 'invalid request: /3/search/movie?api_key=abcd1234efgh5678'

    expect(providerDetail(corpo, ['abcd1234efgh5678'])).toBe(
      'invalid request: /3/search/movie?api_key=…',
    )
  })

  it('raspa por VALOR, então acha a chave em qualquer forma', () => {
    // Header ecoado, e não query: o valor é o que vaza, e ele vaza igual nos
    // dois. Raspar por nome de parâmetro perderia este caso.
    const corpo = 'Bad Client-ID: supersecretvalue'

    expect(providerDetail(corpo, ['supersecretvalue'])).toBe('Bad Client-ID: …')
  })

  it('raspa TODAS as credenciais, e cada uma quantas vezes aparecer', () => {
    const corpo =
      'id=clientidvalue secret=clientsecretvalue again clientidvalue'

    expect(providerDetail(corpo, ['clientidvalue', 'clientsecretvalue'])).toBe(
      'id=… secret=… again …',
    )
  })

  /**
   * Segredo curto casaria com qualquer coisa e transformaria a frase numa
   * fileira de reticências. Oito é o piso de toda chave que este servidor viu.
   */
  it('ignora segredo curto demais para ser chave', () => {
    expect(providerDetail('the value is abc', ['abc'])).toBe('the value is abc')
  })

  it('aguenta credencial ausente na lista', () => {
    expect(providerDetail('plain message', [null, undefined, ''])).toBe(
      'plain message',
    )
  })

  it('trunca no teto e marca que cortou', () => {
    const resultado = providerDetail('x'.repeat(900))

    expect(resultado).toHaveLength(401)
    expect(resultado?.endsWith('…')).toBe(true)
  })

  /**
   * O caso REAL que calibrou o teto: o 403 do AniList ocupa 186 caracteres com
   * o envelope GraphQL em volta, e a frase útil vive no meio dele. Um teto que
   * ele raspasse cortaria a frase no primeiro provedor mais verboso.
   */
  it('deixa passar inteiro o envelope de erro que motivou a peça', () => {
    const real =
      '{ "errors": [ { "message": "The AniList API has been temporarily disabled due to severe stability issues.", "status": 403, "locations": [ { "line": 1, "column": 1 } ] } ], "data": null }'

    expect(real).toHaveLength(186)
    expect(providerDetail(real)).toBe(real)
  })

  /**
   * **O corte é no texto já RASPADO.** Cortar antes deixaria meia chave na
   * ponta — e meia chave de 16 caracteres é oito caracteres de chave.
   */
  it('corta depois de raspar, nunca antes', () => {
    const segredo = 'abcd1234efgh5678'
    const corpo = `${'y'.repeat(195)} ${segredo} tail`

    const resultado = providerDetail(corpo, [segredo])

    expect(resultado).not.toContain(segredo)
    expect(resultado).not.toContain('abcd')
  })
})

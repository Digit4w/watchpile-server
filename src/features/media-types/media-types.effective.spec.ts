import { describe, expect, it } from 'vitest'
import { effectiveProviderOf } from './media-types.query.js'

describe('o provedor efetivo do tipo', () => {
  it('a escolha explícita vence, mesmo com vários associados', () => {
    expect(effectiveProviderOf('anilist', ['anilist', 'tmdb'])).toBe('anilist')
  })

  it('com UM provedor associado, ele é o efetivo sem decisão nenhuma', () => {
    // Obrigar o admin a confirmar seria pedir que escolhesse entre uma opção.
    expect(effectiveProviderOf(null, ['tmdb'])).toBe('tmdb')
  })

  it('com DOIS e sem escolha, devolve nulo em vez de chutar o primeiro', () => {
    // Inventar o primeiro da lista seria decidir por alfabeto. O nulo é o que
    // a tela de busca vai ter que responder.
    expect(effectiveProviderOf(null, ['anilist', 'tmdb'])).toBeNull()
  })

  it('sem provedor nenhum, nulo', () => {
    expect(effectiveProviderOf(null, [])).toBeNull()
  })

  it('a escolha explícita vence até quando é o único associado', () => {
    expect(effectiveProviderOf('tmdb', ['tmdb'])).toBe('tmdb')
  })
})

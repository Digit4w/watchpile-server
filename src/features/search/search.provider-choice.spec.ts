import { describe, expect, it } from 'vitest'
import { chooseSearchProvider } from './search.provider-choice.js'

describe('quem responde a busca', () => {
  it('sem provedor associado, recusa com o motivo que o brief manda gritar', () => {
    expect(
      chooseSearchProvider({
        requested: null,
        effective: null,
        associated: [],
      }),
    ).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('o efetivo responde', () => {
    expect(
      chooseSearchProvider({
        requested: null,
        effective: 'anilist',
        associated: ['anilist', 'tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })

  it('o pedido requested vence o efetivo — é a troca de fonte da tela', () => {
    expect(
      chooseSearchProvider({
        requested: 'tmdb',
        effective: 'anilist',
        associated: ['anilist', 'tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'tmdb' })
  })

  it('pedir um provedor que não serve o tipo é pedido inválido, não 503', () => {
    // A distinção importa: 503 mandaria a pessoa esperar por uma coisa que
    // nunca vai acontecer.
    expect(
      chooseSearchProvider({
        requested: 'igdb',
        effective: null,
        associated: ['tmdb'],
      }),
    ).toEqual({ ok: false, reason: 'not-associated', provider: 'igdb' })
  })

  it('sem efetivo e com dois, o primeiro por SLUG responde', () => {
    // Diferente de `effectiveProviderOf`, que devolve nulo aqui: lá a pergunta
    // é quem manda no tipo, aqui é quem responde agora — e a tela nomeia quem
    // respondeu e oferece trocar.
    expect(
      chooseSearchProvider({
        requested: null,
        effective: null,
        associated: ['tmdb', 'anilist'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })

  it('a ordem do banco não muda a resposta', () => {
    const a = chooseSearchProvider({
      requested: null,
      effective: null,
      associated: ['tmdb', 'anilist', 'mangadex'],
    })
    const b = chooseSearchProvider({
      requested: null,
      effective: null,
      associated: ['mangadex', 'tmdb', 'anilist'],
    })
    expect(a).toEqual(b)
  })

  it('efetivo que deixou de servir o tipo não trava a busca', () => {
    // A coluna é nulável e a junção muda sem ela; um efetivo órfão faria a
    // busca recusar num tipo que TEM provedor.
    expect(
      chooseSearchProvider({
        requested: null,
        effective: 'igdb',
        associated: ['tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'tmdb' })
  })
})

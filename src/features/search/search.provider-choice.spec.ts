import { describe, expect, it } from 'vitest'
import { chooseSearchProvider } from './search.provider-choice.js'

describe('quem responde a busca', () => {
  it('sem provedor associado, recusa com o motivo que o brief manda gritar', () => {
    expect(
      chooseSearchProvider({
        requested: null,
        preferred: null,
        effective: null,
        associated: [],
      }),
    ).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('o efetivo responde', () => {
    expect(
      chooseSearchProvider({
        requested: null,
        preferred: null,
        effective: 'anilist',
        associated: ['anilist', 'tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })

  it('o pedido requested vence o efetivo — é a troca de fonte da tela', () => {
    expect(
      chooseSearchProvider({
        requested: 'tmdb',
        preferred: null,
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
        preferred: null,
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
        preferred: null,
        effective: null,
        associated: ['tmdb', 'anilist'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })

  it('a ordem do banco não muda a resposta', () => {
    const a = chooseSearchProvider({
      requested: null,
      preferred: null,
      effective: null,
      associated: ['tmdb', 'anilist', 'mangadex'],
    })
    const b = chooseSearchProvider({
      requested: null,
      preferred: null,
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
        preferred: null,
        effective: 'igdb',
        associated: ['tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'tmdb' })
  })

  it('a preferência de quem busca vence o efetivo do admin', () => {
    // A régua de 30/08 põe as duas de lados diferentes: o efetivo é "quem
    // responde a busca NESTE SERVIDOR", a preferência é "com que fonte EU
    // busco". Quem está na frente da tela escolheu por último.
    expect(
      chooseSearchProvider({
        requested: null,
        preferred: 'kitsu',
        effective: 'anilist',
        associated: ['anilist', 'kitsu'],
      }),
    ).toEqual({ ok: true, provider: 'kitsu' })
  })

  it('o pedido explícito vence a preferência — trocar de fonte é por consulta', () => {
    // Sem isto, o seletor deixaria de funcionar dentro da própria busca em que
    // ele foi usado: a escrita da preferência e a consulta acontecem no mesmo
    // gesto, e a segunda não pode obedecer a um valor mais antigo.
    expect(
      chooseSearchProvider({
        requested: 'anilist',
        preferred: 'kitsu',
        effective: 'kitsu',
        associated: ['anilist', 'kitsu'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })

  it('preferência por um provedor que não serve mais o tipo cai no efetivo', () => {
    // Ela chega validada de `preferredSourceFor`, mas a função é pura e não
    // pode depender disso: uma preferência órfã aqui viraria a MESMA recusa
    // que um pedido inválido, culpando a pessoa por uma escolha antiga que ela
    // não tem como ver nem desfazer.
    expect(
      chooseSearchProvider({
        requested: null,
        preferred: 'igdb',
        effective: 'tmdb',
        associated: ['tmdb'],
      }),
    ).toEqual({ ok: true, provider: 'tmdb' })
  })

  it('sem preferência e sem efetivo, o desempate por slug continua valendo', () => {
    expect(
      chooseSearchProvider({
        requested: null,
        preferred: null,
        effective: null,
        associated: ['tmdb', 'anilist'],
      }),
    ).toEqual({ ok: true, provider: 'anilist' })
  })
})

import { describe, expect, it } from 'vitest'
import { conditionsOf } from './notifications.instance-conditions.js'

/**
 * A regra pura, sem banco: o que é condição de instância não depende do
 * relógio nem do que já está gravado.
 */

function provider(over: {
  slug: string
  name?: string
  servesAnyType?: boolean
  credentialSources?: string[]
}) {
  return {
    slug: over.slug,
    name: over.name ?? over.slug.toUpperCase(),
    servesAnyType: over.servesAnyType ?? true,
    credentialSources: over.credentialSources ?? ['stored'],
  }
}

describe('conditionsOf', () => {
  it('flags a provider with no credential at all', () => {
    expect(
      conditionsOf([provider({ slug: 'igdb', credentialSources: ['none'] })]),
    ).toEqual([
      {
        kind: 'provider-missing-key',
        subject: 'igdb',
        params: { provider: 'IGDB', providerSlug: 'igdb' },
      },
    ])
  })

  it('flags a provider running on the key the product ships', () => {
    const [only] = conditionsOf([
      provider({ slug: 'tmdb', credentialSources: ['embedded'] }),
    ])

    expect(only?.kind).toBe('provider-embedded-key')
  })

  /**
   * Sem chave a busca daquele tipo NÃO funciona; na embutida ela funciona e o
   * limite é compartilhado. Dois avisos pro mesmo provedor diriam a mesma coisa
   * duas vezes, e o mais grave é o que precisa ser lido.
   */
  it('says the worse of the two when a provider has both', () => {
    const found = conditionsOf([
      provider({ slug: 'igdb', credentialSources: ['none', 'embedded'] }),
    ])

    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('provider-missing-key')
  })

  it('says nothing about a provider that is configured', () => {
    expect(
      conditionsOf([
        provider({ slug: 'tmdb', credentialSources: ['stored'] }),
        provider({ slug: 'kitsu', credentialSources: ['env'] }),
        provider({ slug: 'x', credentialSources: ['file'] }),
      ]),
    ).toEqual([])
  })

  /**
   * Provedor sem credencial DECLARADA nasce pronto — é o caso do AniList e do
   * Open Library, que não pedem nada pra leitura pública.
   */
  it('says nothing about a provider that declares no credential', () => {
    expect(
      conditionsOf([provider({ slug: 'anilist', credentialSources: [] })]),
    ).toEqual([])
  })

  /**
   * **É este recorte que torna o sinal possível.** Toda instalação semeia
   * provedor que o dono não usa: sem ele o aviso nunca apagaria, e sinal
   * permanentemente aceso ensina a ser ignorado (brief, 3.10 — provedor sem
   * tipo é *ocioso, não quebrado*).
   */
  it('ignores a provider that serves no media type', () => {
    expect(
      conditionsOf([
        provider({
          slug: 'igdb',
          servesAnyType: false,
          credentialSources: ['none'],
        }),
      ]),
    ).toEqual([])
  })

  it('reports one condition per provider, not one per credential', () => {
    const found = conditionsOf([
      provider({ slug: 'igdb', credentialSources: ['none', 'none'] }),
    ])

    expect(found).toHaveLength(1)
  })
})

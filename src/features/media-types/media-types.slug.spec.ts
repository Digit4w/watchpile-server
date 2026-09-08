import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from './media-types.slug.js'

describe('slugify', () => {
  it('derruba acento e caixa', () => {
    expect(slugify('Mangá')).toBe('manga')
    expect(slugify('Série')).toBe('serie')
  })

  it('junta espaço e pontuação num hífen só, sem sobrar nas bordas', () => {
    expect(slugify('  Visual novel / VN!  ')).toBe('visual-novel-vn')
  })

  it('cai no fallback quando o nome não tem nada de latino', () => {
    // O caso que motivou o fallback: slug vazio quebraria a FK e a URL.
    expect(slugify('ポッドキャスト')).toBe('type')
  })
})

describe('uniqueSlug', () => {
  it('devolve a base quando ela está livre', () => {
    expect(uniqueSlug('Podcast', ['movie'])).toBe('podcast')
  })

  it('numera a partir de 2, porque o sufixo conta ocorrências', () => {
    expect(uniqueSlug('Podcast', ['podcast'])).toBe('podcast-2')
    expect(uniqueSlug('Podcast', ['podcast', 'podcast-2'])).toBe('podcast-3')
  })

  it('desempata dois nomes fora do alfabeto latino sem colidir', () => {
    expect(uniqueSlug('ポッドキャスト', ['type'])).toBe('type-2')
  })
})

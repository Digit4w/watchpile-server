import { describe, expect, it } from 'vitest'
import { artUrl } from './providers.client.js'

const TMDB = 'https://image.tmdb.org/t/p/w342{path}'

describe('a URL de arte', () => {
  it('interpola o caminho relativo no molde da definição', () => {
    expect(artUrl('/pB8B.jpg', TMDB)).toBe(
      'https://image.tmdb.org/t/p/w342/pB8B.jpg',
    )
  })

  it('URL absoluta passa direto — provedor assim não precisa de molde', () => {
    const absolute = 'https://cdn.example.test/capa.jpg'
    expect(artUrl(absolute, null)).toBe(absolute)
    expect(artUrl(absolute, TMDB)).toBe(absolute)
  })

  it('relativo SEM molde vira nulo, não uma imagem quebrada', () => {
    // A tela cai no ladrilho com a inicial, que é o fallback do sistema.
    expect(artUrl('/pB8B.jpg', null)).toBeNull()
  })

  it('sem valor nenhum, nulo', () => {
    expect(artUrl(null, TMDB)).toBeNull()
    expect(artUrl('', TMDB)).toBeNull()
  })
})

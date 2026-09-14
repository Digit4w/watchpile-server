import { describe, expect, it } from 'vitest'
import { besideDatabase } from './data-dir.js'

describe('besideDatabase', () => {
  it('cai no volume do Docker, e não no WORKDIR', () => {
    expect(besideDatabase('/data/watchpile.db', 'art')).toBe('/data/art')
  })

  it('segue o userData do Electron', () => {
    expect(
      besideDatabase(
        '/Users/x/Library/Application Support/Watchpile/watchpile.db',
        'art',
      ),
    ).toBe('/Users/x/Library/Application Support/Watchpile/art')
  })

  it('mantém o padrão de desenvolvimento, relativo', () => {
    expect(besideDatabase('./data/watchpile.db', 'art')).toBe('data/art')
  })
})

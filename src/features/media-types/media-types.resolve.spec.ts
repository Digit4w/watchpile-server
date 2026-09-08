import { describe, expect, it } from 'vitest'
import { type NameMap, resolveName } from './media-types.resolve.js'

const name = (name: string) => ({
  name,
  plural: `${name}s`,
  progressUnit: null,
})

describe('resolveName', () => {
  it('prefere o idioma de quem lê', () => {
    const names: NameMap = { en: name('Movie'), 'pt-BR': name('Filme') }
    expect(resolveName(names, 'pt-BR', 'en')?.name).toBe('Filme')
  })

  it('cai no idioma da INSTÂNCIA, não na língua-base do produto', () => {
    // O caso que motivou o degrau 2: servidor brasileiro, tipo criado só em
    // pt-BR, leitor em espanhol. Cair no inglês do produto daria vazio.
    const names: NameMap = { 'pt-BR': name('Mangá') }
    expect(resolveName(names, 'es', 'pt-BR')?.name).toBe('Mangá')
  })

  it('cai no primeiro preenchido quando nem o leitor nem a instância têm', () => {
    const names: NameMap = { 'pt-BR': name('Podcast') }
    expect(resolveName(names, 'es', 'en')?.name).toBe('Podcast')
  })

  it('nunca devolve vazio enquanto houver um idioma — é a garantia do degrau 3', () => {
    expect(
      resolveName({ ja: name('ポッドキャスト') }, 'en', 'en'),
    ).toBeDefined()
  })

  it('só devolve indefinido se o mapa estiver vazio, que a escrita impede', () => {
    expect(resolveName({}, 'en', 'en')).toBeUndefined()
  })
})

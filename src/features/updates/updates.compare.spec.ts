import { describe, expect, it } from 'vitest'
import { isNewer } from './updates.compare.js'

describe('qual versão é a mais nova', () => {
  it('compara número a número, não texto a texto', () => {
    // O caso que texto erra: '0.10.0' < '0.9.0' em ordem alfabética.
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
  })

  it('a tag com `v` e a versão do package.json são a mesma coisa', () => {
    // O repositório nomeia a release `v0.1.0` e o package.json guarda `0.1.0`.
    // Comparados como texto, seriam diferentes toda vez.
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true)
  })

  it('igual não é mais nova', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
  })

  it('cada posição decide antes da seguinte', () => {
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.2.0', '0.1.99')).toBe(true)
    expect(isNewer('0.1.2', '0.1.1')).toBe(true)
  })

  it('sufixo depois do patch é aceito e ignorado', () => {
    // Aceitar erra por chamar de igual duas coisas que quase são. Recusar
    // faria a instalação parar de ver atualização em SILÊNCIO, que é pior.
    expect(isNewer('0.2.0-rc.1', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0-rc.1', '0.1.0')).toBe(false)
  })

  it('o que não casa x.y.z responde NÃO, dos dois lados', () => {
    // A candidata vem de terceiro — é o `tag_name` de uma release. Dizer "há
    // versão nova" errado manda a pessoa reinstalar o que já tem.
    for (const junk of ['', 'latest', 'v', '1', '1.2', 'nightly-2026-09-10']) {
      expect(isNewer(junk, '0.1.0')).toBe(false)
      expect(isNewer('9.9.9', junk)).toBe(false)
    }
  })

  it('não confunde 0.1.0 com 0.1.10', () => {
    expect(isNewer('0.1.10', '0.1.0')).toBe(true)
  })
})

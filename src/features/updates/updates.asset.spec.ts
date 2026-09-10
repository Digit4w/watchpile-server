import { describe, expect, it } from 'vitest'
import { assetFor } from './updates.asset.js'

/** Os três nomes que a `v0.1.0` publicou de verdade. */
const REAL = [
  { name: 'Watchpile-0.1.0-arm64.dmg', url: 'dmg' },
  { name: 'Watchpile-0.1.0.AppImage', url: 'appimage' },
  { name: 'Watchpile.Setup.0.1.0.exe', url: 'exe' },
]

describe('qual arquivo serve esta máquina', () => {
  it('a extensão separa as plataformas', () => {
    expect(assetFor(REAL, 'darwin', 'arm64')?.url).toBe('dmg')
    expect(assetFor(REAL, 'win32', 'x64')?.url).toBe('exe')
    expect(assetFor(REAL, 'linux', 'x64')?.url).toBe('appimage')
  })

  it('sem etiqueta é o build x64, e só o x64 o recebe', () => {
    // O `.AppImage` e o `.exe` saem sem etiqueta porque há um só de cada, e
    // ele vem do runner x64. Entregá-lo a um ARM seria um binário que não roda.
    expect(assetFor(REAL, 'linux', 'arm64')).toBeNull()
    expect(assetFor(REAL, 'win32', 'arm64')).toBeNull()
  })

  it('Mac Intel não tem asset hoje, e isso é resposta', () => {
    // A matriz é `macos-latest`, que é ARM. A tela diz que não há, em vez de
    // oferecer o `.dmg` de arm64 a um Intel.
    expect(assetFor(REAL, 'darwin', 'x64')).toBeNull()
  })

  it('a etiqueta explícita vence o sem etiqueta', () => {
    // No dia em que a matriz publicar `-x64` ao lado do genérico, o x64 pega o
    // dele — senão a mesma máquina receberia arquivos diferentes conforme a
    // ordem da lista.
    const both = [
      { name: 'Watchpile-0.2.0.AppImage', url: 'generico' },
      { name: 'Watchpile-0.2.0-x64.AppImage', url: 'marcado' },
    ]
    expect(assetFor(both, 'linux', 'x64')?.url).toBe('marcado')
  })

  it('a etiqueta é delimitada, não uma busca por substring', () => {
    // Uma regra que só está certa por causa do nome de hoje não é uma regra.
    const trap = [{ name: 'Watchpilearm64-0.2.0.AppImage', url: 'armadilha' }]
    expect(assetFor(trap, 'linux', 'arm64')).toBeNull()
  })

  it('plataforma que o produto não empacota devolve nulo', () => {
    expect(assetFor(REAL, 'freebsd', 'x64')).toBeNull()
  })

  it('release sem asset nenhum devolve nulo', () => {
    expect(assetFor([], 'linux', 'x64')).toBeNull()
  })
})

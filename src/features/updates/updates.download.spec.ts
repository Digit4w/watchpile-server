import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadState,
  readyFilePath,
  resetDownload,
  startDownload,
} from './updates.download.js'

/** Um feed com uma release e os assets que a `v0.1.0` publicou de verdade. */
function feed(bytes: Uint8Array, contentLength = true) {
  return vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('api.github.com')) {
      return Response.json([
        {
          tag_name: 'v9.9.9',
          draft: false,
          html_url: 'https://example.test/v9.9.9',
          assets: [
            {
              name: 'Watchpile-9.9.9-arm64.dmg',
              browser_download_url: 'https://example.test/dmg',
            },
            {
              name: 'Watchpile-9.9.9.AppImage',
              browser_download_url: 'https://example.test/appimage',
            },
            {
              name: 'Watchpile.Setup.9.9.9.exe',
              browser_download_url: 'https://example.test/exe',
            },
          ],
        },
      ])
    }
    return new Response(bytes, {
      headers: contentLength
        ? { 'content-length': String(bytes.length) }
        : undefined,
    })
  }) as unknown as typeof fetch
}

async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (downloadState().state !== 'downloading') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`o download não terminou: ${downloadState().state}`)
}

afterEach(async () => {
  await resetDownload()
})

describe('baixar o instalador', () => {
  it('grava o arquivo e diz que está pronto', async () => {
    const bytes = new Uint8Array(4096).fill(7)

    startDownload('0.1.0', feed(bytes))
    await settle()

    const state = downloadState()
    expect(state.state).toBe('ready')
    const path = readyFilePath()
    expect(path).not.toBeNull()
    expect(readFileSync(path as string)).toHaveLength(4096)
  })

  it('o nome do arquivo vem do ASSET, porque a extensão é o que o sistema lê', async () => {
    // No Windows o instalador é reconhecido pela extensão, e no macOS o `.dmg`
    // precisa dela pra montar. Um nome inventado quebraria os dois.
    startDownload('0.1.0', feed(new Uint8Array(16)))
    await settle()

    expect(readyFilePath()).toMatch(/Watchpile[\w.-]*\.(dmg|exe|AppImage)$/)
  })

  it('recusa quando nada publicado serve esta máquina', async () => {
    // Uma release só com o `.dmg` de ARM não serve um Windows x64. A tela diz
    // isso em vez de entregar um binário que não roda.
    const onlyMac = vi.fn(async (input: unknown) =>
      String(input).includes('api.github.com')
        ? Response.json([
            {
              tag_name: 'v9.9.9',
              draft: false,
              html_url: 'https://example.test/v',
              assets: [
                {
                  name: 'Watchpile-9.9.9-sparc64.dmg',
                  browser_download_url: 'https://example.test/x',
                },
              ],
            },
          ])
        : new Response(new Uint8Array(1)),
    ) as unknown as typeof fetch

    startDownload('0.1.0', onlyMac)
    await settle()

    expect(downloadState()).toEqual({ state: 'failed', reason: 'no-asset' })
  })

  it('recusa quando a release não é mais nova que a instalada', async () => {
    const bytes = new Uint8Array(16)
    startDownload('99.0.0', feed(bytes))
    await settle()

    expect(downloadState()).toEqual({ state: 'failed', reason: 'no-release' })
  })

  it('sem `Content-Length` o total é NULO, e não um número inventado', async () => {
    // A tela cai numa barra indeterminada. Fingir uma fração seria a peça
    // afirmando o que ela não sabe.
    startDownload('0.1.0', feed(new Uint8Array(32), false))
    await settle()

    expect(downloadState().state).toBe('ready')
  })

  it('recomeçar enquanto um está em curso devolve o que já acontece', async () => {
    // Dois downloads do mesmo arquivo gastariam banda e disputariam o mesmo
    // destino — e o gesto que a pessoa quer nesse caso é ver o que já está
    // acontecendo.
    const slow = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.github.com')) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return Response.json([])
      }
      return new Response(new Uint8Array(1))
    }) as unknown as typeof fetch

    startDownload('0.1.0', slow)
    const second = startDownload('0.1.0', slow)

    expect(second.state).toBe('downloading')
    expect(slow).toHaveBeenCalledTimes(1)
    await settle()
  })
})

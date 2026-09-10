import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { assetFor } from './updates.asset.js'
import { isNewer } from './updates.compare.js'
import { readReleases } from './updates.feed.js'

/**
 * Baixar o instalador da versão nova, com progresso.
 *
 * ── O estado vive em MEMÓRIA, e morre com o processo ───────────────────────
 * Mesmo motivo do cache de token da Twitch e do limitador: um processo só
 * (brief, 3.1). E aqui há um segundo motivo que os outros não têm — **o
 * arquivo também morre**, porque ele fica no diretório temporário do sistema.
 * Guardar no banco um `ready` apontando pra um caminho que o próximo boot não
 * tem seria uma promessa que se quebra sozinha; os dois somem juntos, e isso é
 * coerente em vez de descuidado.
 *
 * ── O progresso é BARRA, e é exceção registrada ────────────────────────────
 * A regra de 06/09 diz *progresso de trabalho em segundo plano é NÚMERO, nunca
 * barra*, e o teste dela é *"o denominador é conhecido E o numerador anda de um
 * em um?"*. Num download o denominador é conhecido e o numerador anda aos
 * milhares — **o próprio teste da regra exclui este caso** (decisão do dono).
 * O servidor manda os dois números; quem desenha a barra é a tela.
 */
export type DownloadState =
  | { state: 'idle' }
  | {
      state: 'downloading'
      version: string
      received: number
      /** Nulo quando o servidor não manda `Content-Length` — a tela cai numa
       * barra indeterminada em vez de mentir uma fração. */
      total: number | null
    }
  | { state: 'ready'; version: string; fileName: string }
  | { state: 'failed'; reason: DownloadFailure }

/**
 * `kind`, nunca frase — mesma régua do import: quem escreve a copy é a tela,
 * que sabe o idioma de quem lê.
 */
export type DownloadFailure =
  /** Nenhum arquivo publicado serve esta plataforma e arquitetura. */
  | 'no-asset'
  /** A release sumiu, ou a checagem estava velha. */
  | 'no-release'
  /** Rede, prazo, disco. */
  | 'failed'

let state: DownloadState = { state: 'idle' }
let directory: string | null = null

export function downloadState(): DownloadState {
  return state
}

/** Usado pelos testes e pelo desligamento — apaga o arquivo e volta ao início. */
export async function resetDownload(): Promise<void> {
  state = { state: 'idle' }
  if (directory) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
    directory = null
  }
}

export function readyFilePath(): string | null {
  return state.state === 'ready' && directory
    ? join(directory, state.fileName)
    : null
}

/**
 * Começa o download e **não espera por ele** — quem chama recebe o estado
 * inicial, e a tela acompanha por leitura, como no import.
 *
 * Recomeçar enquanto um está em curso é ignorado: dois downloads do mesmo
 * arquivo gastariam banda e disputariam o mesmo destino, e o gesto que a
 * pessoa quer nesse caso é *ver o que já está acontecendo*.
 */
export function startDownload(
  installed: string | null,
  fetchImpl: typeof fetch = fetch,
): DownloadState {
  if (state.state === 'downloading') {
    return state
  }

  state = { state: 'downloading', version: '', received: 0, total: null }
  void run(installed, fetchImpl).catch(() => {
    state = { state: 'failed', reason: 'failed' }
  })
  return state
}

async function run(
  installed: string | null,
  fetchImpl: typeof fetch,
): Promise<void> {
  const feed = await readReleases(fetchImpl)
  if (!feed.ok) {
    state = { state: 'failed', reason: 'no-release' }
    return
  }

  /**
   * A release é relida AGORA em vez de sair do que a checagem guardou.
   *
   * O que fica gravado em `settings` é versão e endereço, e o arquivo de cada
   * plataforma não cabe ali: guardá-lo faria a instalação carregar a resposta
   * de UMA máquina, e o mesmo servidor pode ser aberto de um Mac e de um
   * Windows. Uma requisição a mais no gesto de baixar centenas de megabytes
   * não é custo.
   */
  let newest: (typeof feed.releases)[number] | null = null
  for (const release of feed.releases) {
    if (!newest || isNewer(release.version, newest.version)) {
      newest = release
    }
  }

  if (!newest || (installed && !isNewer(newest.version, installed))) {
    state = { state: 'failed', reason: 'no-release' }
    return
  }

  const asset = assetFor(newest.assets)
  if (!asset) {
    state = { state: 'failed', reason: 'no-asset' }
    return
  }

  state = {
    state: 'downloading',
    version: newest.version,
    received: 0,
    total: null,
  }

  const res = await fetchImpl(asset.url, {
    headers: { 'User-Agent': 'Watchpile' },
  })
  if (!res.ok || !res.body) {
    state = { state: 'failed', reason: 'failed' }
    return
  }

  const length = Number(res.headers.get('content-length'))
  const total = Number.isFinite(length) && length > 0 ? length : null

  await resetDirectory()
  const dir = directory
  if (!dir) {
    state = { state: 'failed', reason: 'failed' }
    return
  }

  /**
   * **O nome do arquivo vem do asset, não é inventado.** No Windows o
   * instalador é reconhecido pela extensão, e no macOS o `.dmg` precisa dela
   * pra montar. E é saneado assim mesmo: o nome chega de terceiro, e uma barra
   * dentro dele escreveria fora do diretório temporário.
   */
  const fileName = asset.name.replace(/[^\w.-]/g, '_')
  const version = newest.version

  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).map(
        (chunk: Buffer) => {
          if (state.state === 'downloading') {
            state = {
              state: 'downloading',
              version,
              received: state.received + chunk.length,
              total,
            }
          }
          return chunk
        },
      ),
      createWriteStream(join(dir, fileName)),
    )
  } catch {
    state = { state: 'failed', reason: 'failed' }
    return
  }

  state = { state: 'ready', version, fileName }
}

async function resetDirectory(): Promise<void> {
  if (directory) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
  directory = await mkdtemp(join(tmpdir(), 'watchpile-update-'))
}

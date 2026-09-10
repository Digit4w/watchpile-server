/**
 * Qual arquivo de uma release serve ESTA máquina — regra pura.
 *
 * ── Os nomes são os que o `electron-builder` produz, e foram MEDIDOS ───────
 * A `v0.1.0` publicou exatamente três: `Watchpile-0.1.0-arm64.dmg`,
 * `Watchpile-0.1.0.AppImage` e `Watchpile.Setup.0.1.0.exe`. A extensão é o que
 * separa as plataformas, porque é ela que o `electron-builder.config.mjs`
 * declara em `mac.target`, `win.target` e `linux.target`.
 *
 * ── Sem etiqueta de arquitetura quer dizer "o build padrão", que é x64 ─────
 * A matriz da CI é `macos-latest` (arm64), `ubuntu-latest` (x64) e
 * `windows-latest` (x64). O `.AppImage` e o `.exe` saem **sem** etiqueta porque
 * há um só de cada; o `.dmg` sai com `-arm64` porque o runner da Apple é ARM.
 *
 * Então um arquivo sem etiqueta é o build x64, e **oferecê-lo a um ARM seria
 * entregar um binário que não roda**. Fora do x64, só serve o que declara a
 * arquitetura — e é por isso que **Mac Intel e Linux ARM não têm asset hoje**.
 * A tela diz isso em vez de chutar: *affordance descreve o que existe*.
 *
 * ── Nulo é resposta, e é a resposta mais comum de errar ────────────────────
 * Nenhum candidato devolve nulo, e a tela cai no caminho que já tem pra "não
 * dá pra atualizar daqui" — o mesmo do Docker. Chutar o primeiro `.dmg` da
 * lista acertaria hoje e erraria no dia em que a matriz ganhar o segundo.
 */
export type Asset = { name: string; url: string }

const EXTENSION: Record<string, string> = {
  darwin: '.dmg',
  win32: '.exe',
  linux: '.AppImage',
}

export function assetFor(
  assets: readonly Asset[],
  platform: string = process.platform,
  arch: string = process.arch,
): Asset | null {
  const extension = EXTENSION[platform]
  if (!extension) {
    return null
  }

  const candidates = assets.filter((asset) => asset.name.endsWith(extension))

  /**
   * A etiqueta explícita vence sempre, e é conferida ANTES do caso sem
   * etiqueta: no dia em que a matriz publicar `-x64` ao lado do sem etiqueta,
   * o x64 tem que pegar o dele em vez do genérico — senão a mesma máquina
   * receberia arquivos diferentes conforme a ordem da lista.
   */
  const tagged = candidates.find((asset) => hasTag(asset.name, arch))
  if (tagged) {
    return tagged
  }

  if (arch !== 'x64') {
    return null
  }

  return candidates.find((asset) => !hasAnyTag(asset.name)) ?? null
}

/**
 * A etiqueta é delimitada, e não uma busca por substring.
 *
 * `includes('arm64')` casaria dentro de um nome de produto — e casaria
 * `arm64` dentro de nada hoje, o que é justamente o problema: uma regra que
 * só está certa por causa do nome de hoje.
 */
function hasTag(name: string, arch: string): boolean {
  return new RegExp(`[-._]${arch}[-._]`).test(name)
}

function hasAnyTag(name: string): boolean {
  return /[-._](arm64|x64|ia32|armv7l)[-._]/.test(name)
}

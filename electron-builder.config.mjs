import { execSync } from 'node:child_process'

// dev (e qualquer outra branch) = preview, main = stable — mesmo critério do
// fluxo dev→main do repositório (server/CLAUDE.md, "Fluxo de trabalho").
// GITHUB_REF_NAME existe no runner do CI; localmente cai pro branch atual.
function resolveChannel() {
  const branch =
    process.env.GITHUB_REF_NAME ??
    execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  return branch === 'main' ? 'stable' : 'preview'
}

function resolvePlatformDir() {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.fernandoenf.watchpile',
  productName: 'Watchpile',
  asar: false,
  /**
   * **Não recompilar módulo nativo — o `better-sqlite3` é N-API desde a v9.**
   *
   * Verificado em 02/09/2026: o MESMO `prebuilds/darwin-arm64.node` carrega e
   * consulta no Node 22 local (`modules=127`) e no Electron 44 (`modules=149`,
   * Node 24) sem rebuild nenhum. É o que a N-API promete — ela é ABI-estável
   * ATRAVÉS de versões de Node e de Electron, ao contrário da API do V8, que é
   * o que obrigava a recompilar.
   *
   * Com `npmRebuild` ligado (o padrão), todo empacotamento recompila do fonte
   * em cada runner da matriz, o que exige `node-gyp`, Python e um compilador
   * C++ em cada um — e é essa a superfície que o `server/CLAUDE.md` chamava de
   * "o ponto que mais quebra em CI". O pacote leva os oito prebuilds
   * publicados (`darwin`, `linux`, `linuxmusl`, `win32` × `arm64`/`x64`), e o
   * `node-gyp-build` escolhe o certo em tempo de execução.
   */
  npmRebuild: false,
  directories: {
    // builds/<plataforma>/<canal>/ — ex.: builds/mac/preview/
    output: `builds/${resolvePlatformDir()}/${resolveChannel()}`,
  },
  files: ['dist-electron/**/*', 'package.json', 'node_modules/**/*'],
  extraResources: [
    {
      from: '../client/dist',
      to: 'client-dist',
    },
  ],
  mac: {
    target: ['dmg'],
    category: 'public.app-category.utilities',
    icon: 'build/icon.icns',
  },
  win: {
    target: ['nsis'],
    icon: 'build/icon.ico',
  },
  linux: {
    target: ['AppImage'],
    icon: 'build/icons',
    category: 'Utility',
  },
}

export default config

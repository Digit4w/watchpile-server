import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

// único arquivo que importa 'electron' (server/CLAUDE.md) — startServer()
// continua sem saber que está rodando aqui, só recebe env var diferente.
app.setName('Watchpile')

function createWindow(port: number) {
  const window = new BrowserWindow({ width: 1280, height: 800 })
  window.loadURL(`http://localhost:${port}`)
}

app.whenReady().then(async () => {
  // pino-pretty roda numa worker thread separada e falha ao resolver módulo
  // dentro do app empacotado — app.isPackaged já deveria ser produção mesmo.
  process.env.NODE_ENV ??= app.isPackaged ? 'production' : 'development'
  process.env.WATCHPILE_DB_PATH ??= join(
    app.getPath('userData'),
    'watchpile.db',
  )
  process.env.PORT ??= '0'
  /**
   * **A única coisa que o desktop declara sobre rede — e ela declara duas.**
   *
   * O wrapper pode dizer isto porque ele *é* o Electron; o servidor continua
   * sem saber onde roda (brief, 3.4) e lê a variável como lê `PORT`. `ui` faz o
   * padrão do bind virar o loopback E faz o controle de conexões remotas
   * aparecer na tela — as duas perguntas têm sempre a mesma resposta aqui, e o
   * porquê está em `features/network/network.bind.ts`.
   *
   * **`WATCHPILE_HOST` NÃO é definida aqui**, e isso é o ponto: definida, ela
   * venceria o controle e o deixaria desabilitado pra sempre. O que o desktop
   * quer é um padrão fechado, não um endereço cravado.
   *
   * `??=` como as outras: quem sobe o app com a variável na mão continua no
   * comando.
   */
  process.env.WATCHPILE_HOST_CONTROL ??= 'ui'
  process.env.WATCHPILE_CLIENT_DIST_PATH ??= app.isPackaged
    ? join(process.resourcesPath, 'client-dist')
    : join(import.meta.dirname, '../../client/dist')

  const { startServer } = await import('../src/index.js')
  // O host volta junto e é ignorado de propósito: a janela carrega `localhost`,
  // que alcança o servidor tanto no loopback quanto em todas as interfaces.
  const { port } = await startServer()

  createWindow(port)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

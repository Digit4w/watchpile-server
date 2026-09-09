import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'

// único arquivo que importa 'electron' (server/CLAUDE.md) — startServer()
// continua sem saber que está rodando aqui, só recebe env var diferente.
app.setName('Watchpile')

/**
 * **O menu padrão do Electron sai, e o macOS é a exceção que o obriga a ficar.**
 *
 * `File Edit View Window` desenha uma faixa DENTRO da janela no Windows e no
 * Linux, e nenhum dos quatro descreve coisa que este app tenha: a navegação
 * inteira mora na sidebar, e não há documento pra abrir nem pra salvar.
 *
 * No macOS o menu não está dentro da janela — está na barra do sistema — e é
 * dele que saem `Cmd+C/V/X/A/Z`: o Electron entrega essas teclas pelos `role`s
 * do menu, então matá-lo lá quebraria copiar e colar dentro do app. No Windows
 * e no Linux o Chromium trata as mesmas teclas sozinho, e por isso lá ele pode
 * ir embora inteiro.
 *
 * Ficam os três `role`s que nomeiam coisa que existe — o app, a edição de texto
 * e as janelas. `File`, `View` e `Help` não nomeiam nada nosso.
 */
function applyMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  )
}

function createWindow(port: number) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    /**
     * **O piso da janela, e ele é medido do CLIENT — não escolhido aqui.**
     *
     * `390` é a largura de telefone que o projeto já usa como referência
     * (`design/README.md`, e a medição do painel de 352px em 06/09/2026), e é
     * o ramo mais estreito que alguém desenhou: abaixo dela não há layout, só
     * transbordo. Acima de 768px (o `md:` que decide a sidebar) a janela volta
     * ao chrome de desktop sozinha — o piso não escolhe forma, só impede a que
     * não existe.
     *
     * `560` sai da soma do que é fixo no ramo estreito: 56 da barra de cima e
     * 56 da de abas são 112 de chrome, e sobram 448 — o bastante para um widget
     * inteiro da Home (72 de chrome mais uma fileira de 216) com a faixa dupla
     * do cabeçalho acima dele. Menos que isso e a primeira carta já nasce
     * cortada.
     *
     * **Consequência assumida:** entre 390 e 767 a janela veste o chrome de
     * celular, barra de abas inclusive. É layout que existe e funciona, não um
     * estado quebrado — mas se o desktop nunca dever usá-lo, o piso vira 768 e
     * nada mais muda.
     */
    minWidth: 390,
    minHeight: 560,
    /**
     * **As quatro medidas acima falam da PÁGINA, não da moldura.**
     *
     * Medido aqui em 08/09/2026: sem isto, a moldura do macOS come 32px de
     * altura, então `minHeight: 560` entregaria 528 ao app — e o desconto muda
     * com o sistema, o que faria o piso valer um número diferente em cada um
     * dos três. Com `useContentSize` o mínimo passa a ser verificado em cima do
     * conteúdo (medido: pedir 100×100 para em 390×560 de página), e o número
     * escrito é o número que o React recebe.
     *
     * O custo é que a JANELA inicial fica 32px mais alta que antes, porque os
     * 800 deixaram de incluir a barra de título — que é o que eles pareciam
     * dizer o tempo todo.
     */
    useContentSize: true,
    /**
     * A barra de título continua NATIVA e passa a ficar VAZIA (decisão do dono,
     * 08/09/2026): a marca já se apresenta uma vez na sidebar, e repeti-la na
     * faixa é a mesma palavra duas vezes na mesma tela.
     *
     * `title` sozinho não basta — o Electron adota o `<title>` da página assim
     * que ela carrega, e o do client é `Watchpile`. Quem faz a decisão
     * sobreviver ao `loadURL` é o `page-title-updated` abaixo.
     *
     * O custo está assumido e é fora da janela: no Windows o Alt+Tab e a
     * miniatura da barra de tarefas leem esse mesmo título, e passam a mostrar
     * só o ícone. Devolver o nome é devolver a repetição — não há como separar
     * os dois com moldura nativa.
     */
    title: '',
    /**
     * A janela só aparece quando há o que mostrar. Sem isso ela abre pintada de
     * branco e o app escuro entra por cima um quadro depois, que é o flash que
     * denuncia página web dentro de janela nativa.
     *
     * **Sem `backgroundColor` de propósito:** o valor teria de ser o hex de
     * `--color-surface`, e uma segunda cópia de uma cor do design system fora do
     * `tokens.css` é exatamente o que o guia do client recusa — ela envelheceria
     * calada no dia em que o fundo mudasse. Esperar a primeira pintura resolve
     * sem duplicar nada.
     */
    show: false,
  })

  window.once('ready-to-show', () => window.show())
  window.on('page-title-updated', (event) => event.preventDefault())

  // Sem o `View` do menu padrão, o atalho de devtools some junto com o
  // `role: 'toggleDevTools'` que o trazia. Fora do app empacotado ele volta
  // pela tecla, que é onde ele já estava — e no app empacotado ele não volta,
  // porque ali ninguém depurando é o caso comum.
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return
      const i = input.key.toLowerCase() === 'i'
      if (
        input.key === 'F12' ||
        (i && input.control && input.shift) ||
        (i && input.meta && input.alt)
      ) {
        window.webContents.toggleDevTools()
      }
    })
  }

  window.loadURL(`http://localhost:${port}`)
}

app.whenReady().then(async () => {
  applyMenu()

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

import { chmod, copyFile } from 'node:fs/promises'
import { app, shell } from 'electron'
import type { UpdateInstaller } from '../src/features/updates/updates.installer.js'

/**
 * O que ESTA plataforma faz com um instalador baixado.
 *
 * ── Por que isto existe aqui e não no servidor ─────────────────────────────
 * `shell` e `app` só existem dentro do Electron, e o servidor é agnóstico de
 * ambiente (brief, 3.4). Ele expõe um ponto de registro e este arquivo o
 * preenche — mesma forma de `WATCHPILE_HOST_CONTROL`, com a diferença de que
 * aqui a capacidade é uma FUNÇÃO e não um dado.
 *
 * ── Por que NÃO é o `electron-updater` — decisão do dono, 10/09/2026 ───────
 * Ele exige assinatura de código no macOS (o Squirrel.Mac recusa app não
 * assinado), um manifesto `latest*.yml` que o `electron-builder` só gera com
 * `publish` configurado, e um feed. Nada disso existe neste projeto, e a parte
 * do macOS é a que não se resolve com configuração. **O padrão manual faz o
 * mesmo trabalho sem nenhum dos três**: ler a release, baixar, entregar ao
 * sistema.
 *
 * ── As três plataformas terminam DIFERENTE, e a tela diz qual ──────────────
 * É por isso que `hint` viaja junto da capacidade em vez de ser uma constante
 * da tela: o cliente não pode detectar o ambiente, então a frase sobre como a
 * atualização termina tem que vir de quem sabe.
 */
export function installerForThisPlatform(): UpdateInstaller {
  if (process.platform === 'win32') {
    return {
      hint: 'The installer will run and Watchpile will close.',
      apply: async (filePath) => {
        /**
         * O NSIS reconhece a instalação existente pelo `appId` e a substitui —
         * é a mesma peça que já instala o app na primeira vez.
         *
         * **Abrir e sair**, e não esperar: o instalador não consegue
         * substituir um executável que está rodando.
         */
        await shell.openPath(filePath)
        app.quit()
      },
    }
  }

  if (process.platform === 'darwin') {
    return {
      hint: 'The disk image will open. Drag Watchpile to Applications to finish.',
      apply: async (filePath) => {
        /**
         * **O último passo é da pessoa, e isso é honesto.** Substituir o
         * `.app` sozinho é onde o Gatekeeper entra, e este app não é assinado
         * — é exatamente o custo que fez o `electron-updater` cair. Abrir o
         * `.dmg` deixa o Finder na tela de sempre, que é o gesto que quem usa
         * Mac já conhece.
         *
         * Sai depois de abrir porque o app não pode estar rodando quando for
         * substituído.
         */
        await shell.openPath(filePath)
        app.quit()
      },
    }
  }

  /**
   * AppImage: o "instalado" é o próprio arquivo, e `APPIMAGE` diz onde ele
   * está. Sem essa variável o app não foi iniciado a partir de um AppImage
   * (rodando do fonte, por exemplo), e aí não há o que substituir.
   */
  const target = process.env.APPIMAGE
  if (!target) {
    return {
      hint: 'The download will be saved; replace your AppImage with it.',
      apply: async (filePath) => {
        await shell.showItemInFolder(filePath)
      },
    }
  }

  return {
    hint: 'Watchpile will be replaced in place and restart.',
    apply: async (filePath) => {
      /**
       * **Copiar por cima, e não renomear:** o temporário costuma estar noutro
       * sistema de arquivos, onde `rename` falha com `EXDEV`.
       *
       * Se a cópia falhar — AppImage em lugar sem permissão de escrita, que é
       * comum quando ele foi posto em `/opt` — o arquivo baixado ainda existe,
       * e mostrar a pasta deixa a pessoa terminar à mão. **Falhar em silêncio
       * seria pior que não ter oferecido.**
       */
      try {
        await copyFile(filePath, target)
        await chmod(target, 0o755)
      } catch {
        await shell.showItemInFolder(filePath)
        return
      }

      app.relaunch()
      app.quit()
    },
  }
}

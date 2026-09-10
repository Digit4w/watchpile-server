import { readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A versão deste servidor, lida do `package.json` que o empacotou.
 *
 * ── Por que SUBIR procurando, e não um caminho relativo ────────────────────
 * O mesmo código roda em três layouts, e a profundidade muda em um deles:
 *
 * | Onde | O módulo | O `package.json` |
 * | --- | --- | --- |
 * | dev (`tsx src/index.ts`) | `<repo>/src/lib/` | `<repo>/` |
 * | Docker | `/app/dist/lib/` | `/app/` |
 * | Electron empacotado | `<res>/app/dist-electron/src/lib/` | `<res>/app/` |
 *
 * Um `../../package.json` acerta dois e erra o terceiro — e erra **calado**,
 * porque a leitura falha e a versão vira desconhecida numa tela que ninguém
 * abre em CI. Subir até achar acerta os três sem saber qual é, que é a mesma
 * regra de `startServer()` não saber onde está rodando.
 *
 * ── Por que não é um valor gerado no build ─────────────────────────────────
 * `providers.embedded.ts` é preenchido pelo CI e serve de precedente, mas ele
 * guarda **segredo**, que não pode estar no repositório. Versão não é segredo:
 * ela já está no `package.json` versionado, e gerá-la de novo criaria uma
 * segunda cópia que o dev esqueceria de atualizar — o `package.json` é o que o
 * CI lê pra nomear a imagem e cortar a release, então ele é a fonte.
 *
 * ── Lido uma vez ───────────────────────────────────────────────────────────
 * O arquivo não muda enquanto o processo vive, e a rota que o serve é chamada
 * a cada visita ao `About`.
 */
export const APP_VERSION: string | null = readVersion()

function readVersion(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  const { root } = parse(dir)

  while (true) {
    try {
      const raw: unknown = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      )
      if (typeof raw === 'object' && raw !== null) {
        const { version } = raw as Record<string, unknown>
        if (typeof version === 'string' && version !== '') {
          return version
        }
      }
      /**
       * Achou um `package.json` sem versão utilizável: **para aqui em vez de
       * continuar subindo**. Seguir encontraria o `package.json` de um
       * diretório de cima que não descreve este binário — numa máquina de
       * desenvolvimento isso é qualquer pasta pai, e a resposta errada seria
       * plausível.
       */
      return null
    } catch {
      const parent = dirname(dir)
      if (parent === dir || dir === root) {
        return null
      }
      dir = parent
    }
  }
}

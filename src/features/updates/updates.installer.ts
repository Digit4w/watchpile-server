/**
 * O que ESTA instalação consegue fazer com um instalador baixado.
 *
 * ── Por que é um callback registrado, e não uma checagem de ambiente ───────
 * As duas pontas estão proibidas de se conhecer: o **cliente é agnóstico de
 * host** (nada de `window.electron`, nada de detectar ambiente) e o
 * **servidor é agnóstico de ambiente** (`startServer()` não sabe se está no
 * Docker ou no Electron) — brief, 3.4, os dois lados. Então quem sabe é quem
 * está por fora, e ele **declara a capacidade** em vez de o servidor deduzi-la.
 *
 * É a mesma forma de `WATCHPILE_HOST_CONTROL`, um degrau adiante: aquela
 * declara capacidade por variável de ambiente porque o valor é um dado; esta
 * precisa de uma FUNÇÃO, porque o que o wrapper sabe fazer é executar algo que
 * só existe dentro do Electron. Os dois processos são o mesmo — o wrapper
 * importa `startServer()` —, então a referência atravessa sem serialização.
 *
 * ── No Docker ninguém registra, e isso é a resposta certa ──────────────────
 * Container não se substitui sozinho: a atualização é `docker compose pull &&
 * up -d`, que acontece **fora** do processo. Sem registro, a rota responde que
 * não há como daqui e a tela mostra o comando — que é o que quem hospeda
 * precisa, e é honesto em vez de um botão que finge.
 */
export type UpdateInstaller = {
  /**
   * O que a plataforma faz com o arquivo. Ela **termina o processo** na maioria
   * dos casos — o instalador precisa substituir o que está rodando —, então
   * quem chama não deve contar com voltar daqui.
   */
  apply: (filePath: string) => Promise<void> | void
  /**
   * A frase que a tela mostra sobre COMO isso termina, porque termina
   * diferente em cada plataforma: no Windows o instalador substitui e o app
   * fecha; no macOS o `.dmg` abre e a última etapa é arrastar. **Quem sabe é
   * quem registrou**, e uma constante na tela precisaria detectar o ambiente,
   * que é justamente o que ela não pode fazer.
   */
  hint: string
}

let installer: UpdateInstaller | null = null

/**
 * Chamado pelo wrapper antes de `startServer()`.
 *
 * Aceita `null` porque a suíte precisa voltar ao estado de quem não registrou
 * nada — que é o Docker, e é o caminho que mais importa não quebrar: um teste
 * que deixasse a capacidade ligada faria o vizinho achar que dá pra instalar.
 */
export function registerInstaller(next: UpdateInstaller | null): void {
  installer = next
}

export function currentInstaller(): UpdateInstaller | null {
  return installer
}

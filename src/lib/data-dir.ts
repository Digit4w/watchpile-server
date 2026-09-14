import { dirname, join } from 'node:path'

/**
 * Um diretório AO LADO do arquivo do banco — 14/09/2026.
 *
 * O banco é o único caminho que os dois hosts declaram: o Dockerfile aponta
 * `WATCHPILE_DB_PATH` pro volume `/data`, e o Electron pro `userData`. Tudo que
 * o servidor grava e precisa sobreviver junto dele (o cache de arte, o log)
 * deriva dali, em vez de ter um padrão próprio relativo ao cwd.
 *
 * **O defeito que isto corrige:** o cache de arte tinha `./data/art` como
 * padrão, relativo ao `WORKDIR /app` do container — fora do volume. O
 * comentário ao lado da variável dizia exatamente o contrário ("next to the
 * database on purpose"), e a arte se perderia em toda recriação do container,
 * calada, porque ela se regenera. No Electron empacotado, o mesmo padrão caía
 * onde o cwd do processo estivesse.
 */
export function besideDatabase(dbPath: string, name: string): string {
  return join(dirname(dbPath), name)
}

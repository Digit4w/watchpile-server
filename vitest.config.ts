import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      WATCHPILE_DB_PATH: ':memory:',
      // O cache de arte escreve em disco de verdade — não há ':memory:' pra
      // sistema de arquivos. Diretório próprio pra que o teste não encoste no
      // cache de quem está rodando o servidor na mesma máquina.
      WATCHPILE_ART_CACHE_PATH: './data/art-test',
    },
    setupFiles: ['./test/setup.ts'],
  },
})

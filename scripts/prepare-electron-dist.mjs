// tsc compila electron/*.ts + src/*.ts pra dist-electron/, mas não copia os
// .sql das migrations (não é código TS) — sem isso, db/client.js tenta
// migrar contra uma pasta que não existe no pacote. cpSync é cross-platform
// (mac/linux/windows), diferente de `cp -r` num script de shell.
import { cpSync } from 'node:fs'

cpSync('src/db/migrations', 'dist-electron/src/db/migrations', {
  recursive: true,
})

console.log('migrations copiadas para dist-electron/src/db/migrations')

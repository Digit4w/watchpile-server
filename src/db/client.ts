import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { env } from '../env.js'

const dbDir = dirname(env.WATCHPILE_DB_PATH)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

const sqlite = new Database(env.WATCHPILE_DB_PATH)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)

// relativo ao próprio arquivo, não ao cwd do processo — cwd é previsível no
// Docker (WORKDIR fixo) mas não num app empacotado do Electron.
migrate(db, { migrationsFolder: join(import.meta.dirname, 'migrations') })

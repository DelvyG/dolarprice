import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Carga .env sin dependencias externas. Las variables ya presentes en el
// entorno (las que inyecta systemd) tienen prioridad sobre el archivo.
const envFile = join(ROOT, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

const num = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) ? v : fallback
}

export const config = {
  port: num('PORT', 3200),
  host: process.env.HOST || '127.0.0.1',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num('DB_PORT', 3306),
    database: process.env.DB_NAME || 'dolarprice',
    user: process.env.DB_USER || 'dolarprice',
    password: process.env.DB_PASS || '',
  },
  binance: {
    rows: num('BINANCE_ROWS', 20),
    trimPct: num('BINANCE_TRIM_PCT', 10),
  },
  staleAfterSeconds: num('STALE_AFTER_SECONDS', 2700),
}

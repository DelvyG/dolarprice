import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

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
  // PostgreSQL de verificavenezuela.org, solo lectura.
  vv: {
    host: process.env.VV_DB_HOST || '127.0.0.1',
    port: num('VV_DB_PORT', 5432),
    database: process.env.VV_DB_NAME || 'verifica_venezuela',
    user: process.env.VV_DB_USER || 'dolarprice_ro',
    password: process.env.VV_DB_PASS || '',
  },
  staleAfterSeconds: num('STALE_AFTER_SECONDS', 2700),

  // Panel de estadisticas. Sin ADMIN_PASS_HASH el panel existe pero no deja
  // entrar a nadie: es a proposito, para que un despliegue en un servidor nuevo
  // no quede abierto mientras alguien se acuerda de ponerle contrasena.
  admin: {
    hash: process.env.ADMIN_PASS_HASH || '',
    // Si no se define, se genera una al arrancar: las sesiones abiertas se caen
    // en cada reinicio, pero nunca hay una clave de firma por defecto que
    // alguien pueda sacar leyendo el repo, que es publico.
    secret: process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString('hex'),
    // En local se entra por http://127.0.0.1 y el navegador tira una cookie
    // Secure. En produccion siempre va con Secure.
    cookieSegura: process.env.ADMIN_COOKIE_INSEGURA !== '1',
  },

  analytics: {
    // Venezuela es UTC-4 todo el ano, sin horario de verano. Manda el
    // agrupamiento por dia y por hora del panel; en la base se guarda UTC.
    tzOffset: num('TZ_OFFSET_HORAS', -4),
    retencionDias: num('ANALYTICS_RETENCION_DIAS', 180),
  },
}

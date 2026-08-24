import mysql from 'mysql2/promise'
import { config } from './config.js'

let pool = null

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 8,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
    })
  }
  return pool
}

export const query = async (sql, params = []) => {
  const [rows] = await getPool().execute(sql, params)
  return rows
}

export const closePool = async () => {
  if (pool) { await pool.end(); pool = null }
}

// Fecha en formato MySQL, siempre en UTC para que no dependa del huso del server.
export const ahora = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/**
 * Guarda una lectura. Solo toca el historico si el valor cambio respecto al
 * ultimo guardado, asi el grafico no se llena de puntos identicos.
 */
export async function guardarTasa({ code, source, rate, buy = null, sell = null, valueDate = null, meta = null }) {
  const t = ahora()
  const previo = await query('SELECT `rate` FROM `rates_current` WHERE `code` = ? AND `source` = ?', [code, source])
  const cambio = previo.length === 0 || Math.abs(Number(previo[0].rate) - rate) > 0.00000001

  if (cambio) {
    await query(
      'INSERT INTO `rates_history` (`code`,`source`,`rate`,`buy`,`sell`,`value_date`,`fetched_at`) VALUES (?,?,?,?,?,?,?)',
      [code, source, rate, buy, sell, valueDate, t]
    )
  }

  await query(
    `INSERT INTO \`rates_current\` (\`code\`,\`source\`,\`rate\`,\`buy\`,\`sell\`,\`value_date\`,\`meta\`,\`changed_at\`,\`checked_at\`)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       \`rate\` = VALUES(\`rate\`), \`buy\` = VALUES(\`buy\`), \`sell\` = VALUES(\`sell\`),
       \`value_date\` = VALUES(\`value_date\`), \`meta\` = VALUES(\`meta\`),
       \`checked_at\` = VALUES(\`checked_at\`),
       \`changed_at\` = IF(ABS(\`rate\` - VALUES(\`rate\`)) > 0.00000001, VALUES(\`changed_at\`), \`changed_at\`)`,
    [code, source, rate, buy, sell, valueDate, meta ? JSON.stringify(meta) : null, t, t]
  )

  return cambio
}

export async function registrarCorrida(source, ok, message, durationMs) {
  await query(
    'INSERT INTO `ingest_runs` (`source`,`ok`,`message`,`duration_ms`,`ran_at`) VALUES (?,?,?,?,?)',
    [source, ok ? 1 : 0, message ? String(message).slice(0, 500) : null, durationMs, ahora()]
  )
}

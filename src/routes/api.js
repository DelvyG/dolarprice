import { query } from '../db.js'
import { config } from '../config.js'

const num = (v) => (v === null || v === undefined ? null : Number(v))
const iso = (v) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null)

// Cache en memoria: la ingesta corre cada 10 min, no tiene sentido golpear la
// base en cada visita.
let cache = { data: null, expira: 0 }

async function construirRespuesta() {
  const filas = await query(
    'SELECT `code`,`source`,`rate`,`buy`,`sell`,`value_date`,`changed_at`,`checked_at` FROM `rates_current`'
  )

  const monedas = {}
  let bcvChecked = null
  let bcvChanged = null
  let fechaValor = null
  let binance = null
  let binanceChecked = null
  let binanceChanged = null

  for (const f of filas) {
    if (f.source === 'BCV') {
      monedas[f.code] = num(f.rate)
      if (!bcvChecked || f.checked_at > bcvChecked) bcvChecked = f.checked_at
      if (!bcvChanged || f.changed_at > bcvChanged) bcvChanged = f.changed_at
      if (f.value_date) fechaValor = f.value_date
    } else if (f.source === 'BINANCE') {
      binance = { promedio: num(f.rate), compra: num(f.buy), venta: num(f.sell) }
      binanceChecked = f.checked_at
      binanceChanged = f.changed_at
    }
  }

  const ultimoChequeo = [bcvChecked, binanceChecked].filter(Boolean).sort().pop() ?? null
  const edadSegundos = ultimoChequeo
    ? Math.round((Date.now() - new Date(ultimoChequeo.replace(' ', 'T') + 'Z').getTime()) / 1000)
    : null

  let brecha = null
  if (monedas.USD && binance?.promedio) {
    brecha = {
      absoluta: +(binance.promedio - monedas.USD).toFixed(4),
      porcentaje: +(((binance.promedio / monedas.USD) - 1) * 100).toFixed(2),
    }
  }

  return {
    bcv: {
      monedas,
      fechaValor,
      actualizado: iso(bcvChanged),
      consultado: iso(bcvChecked),
      disponible: Boolean(monedas.USD),
    },
    binance: binance
      ? { ...binance, actualizado: iso(binanceChanged), consultado: iso(binanceChecked), disponible: true }
      : { promedio: null, compra: null, venta: null, actualizado: null, consultado: null, disponible: false },
    brecha,
    edadSegundos,
    desactualizado: edadSegundos === null || edadSegundos > config.staleAfterSeconds,
    servidor: new Date().toISOString(),
  }
}

export default async function apiRoutes(app) {
  app.get('/api/v1/rates', async (req, reply) => {
    const ahora = Date.now()
    if (!cache.data || ahora > cache.expira) {
      cache = { data: await construirRespuesta(), expira: ahora + 15000 }
    }
    reply.header('Cache-Control', 'public, max-age=30, s-maxage=60')
    return cache.data
  })

  app.get('/api/v1/history', async (req, reply) => {
    const code = String(req.query.code ?? 'USD').toUpperCase().slice(0, 10)
    const source = code === 'USDT' ? 'BINANCE' : 'BCV'
    const dias = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)

    // Un punto por dia: el ultimo valor registrado de cada fecha.
    const filas = await query(
      `SELECT DATE(h.\`fetched_at\`) AS dia, h.\`rate\` AS rate
         FROM \`rates_history\` h
         JOIN (
           SELECT DATE(\`fetched_at\`) d, MAX(\`id\`) mid
             FROM \`rates_history\`
            WHERE \`code\` = ? AND \`source\` = ? AND \`fetched_at\` >= (NOW() - INTERVAL ? DAY)
            GROUP BY DATE(\`fetched_at\`)
         ) u ON u.mid = h.\`id\`
        ORDER BY dia ASC`,
      [code, source, dias]
    )

    reply.header('Cache-Control', 'public, max-age=300, s-maxage=600')
    return { code, source, dias, puntos: filas.map((f) => ({ fecha: f.dia, valor: num(f.rate) })) }
  })

  app.get('/api/v1/news', async (req, reply) => {
    // El limite se acota y se interpola porque LIMIT no admite parametro en
    // sentencias preparadas de MySQL; el valor ya viene forzado a entero.
    const limite = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 30, 1), 60)
    const filas = await query(
      `SELECT \`id\`,\`title\`,\`excerpt\`,\`verdict\`,\`category\`,\`image_url\`,\`url\`,\`published_at\`,\`synced_at\`
         FROM \`news_cache\`
        ORDER BY \`published_at\` DESC
        LIMIT ${limite}`
    )

    reply.header('Cache-Control', 'public, max-age=300, s-maxage=600')
    return {
      noticias: filas.map((f) => ({
        id: Number(f.id),
        titulo: f.title,
        resumen: f.excerpt,
        veredicto: f.verdict,
        categoria: f.category,
        imagen: f.image_url,
        url: f.url,
        publicado: iso(f.published_at),
      })),
      sincronizado: iso(filas[0]?.synced_at ?? null),
      fuente: 'verificavenezuela.org',
    }
  })

  app.get('/api/v1/health', async (reply) => {
    const [{ n } = { n: 0 }] = await query('SELECT COUNT(*) AS n FROM `rates_current`')
    const fallos = await query(
      'SELECT `source`, `ok`, `message`, `ran_at` FROM `ingest_runs` ORDER BY `id` DESC LIMIT 6'
    )
    return { ok: n > 0, tasas: n, ultimasCorridas: fallos }
  })
}

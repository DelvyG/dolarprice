// Consultas del panel de estadisticas.
//
// ── Zona horaria ───────────────────────────────────────────────────────────
// En la base todo se guarda en UTC, igual que las tasas (ver db.js: ahora()).
// Pero el panel lo mira alguien en Venezuela, y "hoy" para el empieza a las
// 00:00 VET, que son las 04:00 UTC. Si se agrupara por DATE(created_at) a
// secas, cada dia del grafico llevaria las cuatro primeras horas del dia
// siguiente y las visitas de la madrugada apareceria en el dia equivocado.
// Es exactamente el fallo que ya se corrigio una vez en la fecha de las
// noticias, asi que aqui TODO agrupamiento por dia u hora pasa por local().
//
// Venezuela no cambia la hora en verano, asi que un desfase fijo basta y no
// hace falta la tabla de husos de MySQL (que ademas suele venir vacia).

import { query } from '../db.js'
import { config } from '../config.js'

// Validado en config.js, pero se vuelve a acotar aqui porque se interpola en
// SQL: MySQL no admite un parametro dentro de INTERVAL ? HOUR en este sitio.
const OFF = Math.trunc(config.analytics.tzOffset)
const DESFASE = Number.isFinite(OFF) && OFF >= -12 && OFF <= 14 ? OFF : -4

const local = (col) => `DATE_ADD(${col}, INTERVAL ${DESFASE} HOUR)`

const sql = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z') : null)
const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ')
const n = (v) => Number(v || 0)

/* ─── limites del rango ─── */

export const RANGOS = { hoy: 1, '7d': 7, '30d': 30, '90d': 90, todo: null }

/**
 * Devuelve el rango pedido y el inmediatamente anterior de la misma longitud,
 * para poder mostrar "un 12% mas que la semana pasada".
 */
export function limites(rango = '7d') {
  const dias = RANGOS[rango] === undefined ? 7 : RANGOS[rango]

  // Medianoche de hoy en hora local, expresada en UTC.
  const hoyLocal = new Date(Date.now() + DESFASE * 3600000)
  const medianocheLocal = Date.UTC(hoyLocal.getUTCFullYear(), hoyLocal.getUTCMonth(), hoyLocal.getUTCDate())
  const medianocheUTC = medianocheLocal - DESFASE * 3600000

  if (dias === null) {
    return { rango, dias: null, desde: '2000-01-01 00:00:00', desdePrev: null, hastaPrev: null }
  }

  const desde = new Date(medianocheUTC - (dias - 1) * 86400000)
  return {
    rango,
    dias,
    desde: utc(desde),
    desdePrev: utc(new Date(desde.getTime() - dias * 86400000)),
    hastaPrev: utc(desde),
  }
}

/* ─── piezas reutilizables ─── */

// Solo las visitas de verdad. Los eventos 'tab', 'fin' e 'instalar' son
// telemetria de la misma visita: contarlos infla el numero por cuatro.
const SOLO_VISTAS = "`event` = 'view'"

const topDe = (columna, desde, limite = 10, extra = '') => query(
  `SELECT ${columna} AS clave, COUNT(*) AS visitas, COUNT(DISTINCT \`visitor_id\`) AS visitantes
     FROM \`visits\`
    WHERE ${SOLO_VISTAS} AND \`created_at\` >= ? AND ${columna} IS NOT NULL AND ${columna} <> '' ${extra}
    GROUP BY ${columna}
    ORDER BY visitas DESC
    LIMIT ${Math.trunc(limite)}`,
  [desde]
).then((f) => f.map((r) => ({ clave: r.clave, visitas: n(r.visitas), visitantes: n(r.visitantes) })))

/* ─── resumen ─── */

async function resumen(l) {
  const [[act], [prev], [ahoraMismo], [dur]] = await Promise.all([
    query(
      `SELECT COUNT(*) AS visitas,
              COUNT(DISTINCT \`visitor_id\`) AS visitantes,
              COUNT(DISTINCT \`ip\`) AS ips,
              COUNT(DISTINCT \`session_id\`) AS sesiones
         FROM \`visits\` WHERE ${SOLO_VISTAS} AND \`created_at\` >= ?`,
      [l.desde]
    ),
    l.desdePrev
      ? query(
          `SELECT COUNT(*) AS visitas, COUNT(DISTINCT \`visitor_id\`) AS visitantes
             FROM \`visits\` WHERE ${SOLO_VISTAS} AND \`created_at\` >= ? AND \`created_at\` < ?`,
          [l.desdePrev, l.hastaPrev]
        )
      : Promise.resolve([{ visitas: 0, visitantes: 0 }]),
    // "Ahora mismo": cualquier evento en los ultimos cinco minutos, incluidos
    // los cambios de pestana. Alguien leyendo las noticias sigue estando ahi
    // aunque no haya recargado.
    query(
      'SELECT COUNT(DISTINCT `visitor_id`) AS n FROM `visits` WHERE `created_at` >= (NOW() - INTERVAL 5 MINUTE)'
    ),
    query(
      "SELECT AVG(`duracion_ms`) AS media, MAX(`duracion_ms`) AS maxima FROM `visits` " +
      "WHERE `event` = 'fin' AND `created_at` >= ? AND `duracion_ms` BETWEEN 1000 AND 3600000",
      [l.desde]
    ),
  ])

  // Nuevos = personas cuya primerisima visita cae dentro del rango. Sale de
  // `visitors`, no de `visits`: ahi esta la fecha real de la primera vez,
  // aunque aquella visita ya se haya purgado.
  const [[nuevos]] = await Promise.all([
    query('SELECT COUNT(*) AS n FROM `visitors` WHERE `primera` >= ?', [l.desde]),
  ])

  const visitas = n(act?.visitas)
  const visitasPrev = n(prev?.visitas)
  const visitantes = n(act?.visitantes)

  return {
    visitas,
    visitantes,
    ips: n(act?.ips),
    sesiones: n(act?.sesiones),
    nuevos: n(nuevos?.n),
    recurrentes: Math.max(0, visitantes - n(nuevos?.n)),
    enLinea: n(ahoraMismo?.n),
    duracionMediaSeg: dur?.media ? Math.round(n(dur.media) / 1000) : null,
    visitasPrev,
    // null y no 0 cuando no hay con que comparar: "+100%" seria mentira.
    variacion: l.desdePrev && visitasPrev > 0
      ? +(((visitas / visitasPrev) - 1) * 100).toFixed(1)
      : null,
  }
}

/* ─── series ─── */

// Se rellenan los dias sin visitas: sin esto el grafico une el 3 con el 9 en
// linea recta y parece que hubo trafico los dias que no hubo ninguno.
function rellenarDias(filas, l) {
  if (!l.dias) return filas.map((f) => ({ fecha: f.dia, visitas: n(f.visitas), visitantes: n(f.visitantes) }))
  const porDia = new Map(filas.map((f) => [String(f.dia), f]))
  const salida = []
  const inicio = sql(l.desde).getTime() + DESFASE * 3600000
  for (let i = 0; i < l.dias; i++) {
    const d = new Date(inicio + i * 86400000).toISOString().slice(0, 10)
    const f = porDia.get(d)
    salida.push({ fecha: d, visitas: n(f?.visitas), visitantes: n(f?.visitantes) })
  }
  return salida
}

const serieDiaria = (l) => query(
  `SELECT DATE(${local('`created_at`')}) AS dia,
          COUNT(*) AS visitas,
          COUNT(DISTINCT \`visitor_id\`) AS visitantes
     FROM \`visits\`
    WHERE ${SOLO_VISTAS} AND \`created_at\` >= ?
    GROUP BY dia ORDER BY dia ASC`,
  [l.desde]
).then((f) => rellenarDias(f, l))

const porHora = (l) => query(
  `SELECT HOUR(${local('`created_at`')}) AS hora, COUNT(*) AS visitas
     FROM \`visits\`
    WHERE ${SOLO_VISTAS} AND \`created_at\` >= ?
    GROUP BY hora`,
  [l.desde]
).then((f) => {
  const mapa = new Map(f.map((r) => [n(r.hora), n(r.visitas)]))
  return Array.from({ length: 24 }, (_, h) => ({ hora: h, visitas: mapa.get(h) || 0 }))
})

/* ─── el APK ─── */

async function apk(l) {
  // Ojo con la desestructuracion: `usuarios` y `serie` NO llevan corchetes.
  // Las demas son consultas que devuelven una sola fila y se saca con [x]; esas
  // dos ya vienen transformadas -- un objeto la primera, una lista la segunda.
  const [[desc], usuarios, [instalPwa], [relacionada], serie] = await Promise.all([
    query(
      'SELECT COUNT(*) AS total, COUNT(DISTINCT `ip`) AS unicas FROM `apk_downloads` WHERE `created_at` >= ?',
      [l.desde]
    ),
    query(
      'SELECT `modo`, COUNT(DISTINCT `visitor_id`) AS personas, COUNT(*) AS visitas ' +
      'FROM `visits` WHERE ' + SOLO_VISTAS + ' AND `created_at` >= ? GROUP BY `modo`',
      [l.desde]
    ).then((f) => Object.fromEntries(f.map((r) => [r.modo || 'navegador', { personas: n(r.personas), visitas: n(r.visitas) }]))),
    query(
      "SELECT COUNT(DISTINCT `visitor_id`) AS n FROM `visits` WHERE `event` = 'instalar' AND `created_at` >= ?",
      [l.desde]
    ),
    // De los que entran por navegador, cuantos YA tienen el APK instalado.
    // Solo Chrome en Android sabe responder; en el resto llega null, por eso se
    // devuelve tambien "consultados": el porcentaje sin ese denominador enganaria.
    query(
      'SELECT COUNT(DISTINCT CASE WHEN `apk_instalado` = 1 THEN `visitor_id` END) AS con, ' +
      '       COUNT(DISTINCT CASE WHEN `apk_instalado` IS NOT NULL THEN `visitor_id` END) AS consultados ' +
      'FROM `visits` WHERE ' + SOLO_VISTAS + ' AND `created_at` >= ?',
      [l.desde]
    ),
    query(
      `SELECT DATE(${local('`created_at`')}) AS dia, COUNT(DISTINCT \`ip\`) AS descargas
         FROM \`apk_downloads\` WHERE \`created_at\` >= ?
        GROUP BY dia ORDER BY dia ASC`,
      [l.desde]
    ),
  ])

  return {
    descargas: n(desc?.total),
    descargasUnicas: n(desc?.unicas),
    usanApk: usuarios.apk?.personas || 0,
    visitasApk: usuarios.apk?.visitas || 0,
    usanPwa: usuarios.pwa?.personas || 0,
    usanNavegador: usuarios.navegador?.personas || 0,
    instalacionesPwa: n(instalPwa?.n),
    conApkInstalado: n(relacionada?.con),
    consultadosApk: n(relacionada?.consultados),
    serie: serie.map((r) => ({ fecha: r.dia, descargas: n(r.descargas) })),
  }
}

/* ─── todo junto ─── */

export async function estadisticas(rango) {
  const l = limites(rango)

  const [
    res, serie, horas, paises, ciudades, navegadores, sistemas,
    dispositivos, idiomas, referentes, pestanas, rutas, trafico, datosApk,
  ] = await Promise.all([
    resumen(l),
    serieDiaria(l),
    porHora(l),
    query(
      `SELECT \`country_code\` AS cc, MAX(\`country\`) AS nombre,
              COUNT(*) AS visitas, COUNT(DISTINCT \`visitor_id\`) AS visitantes
         FROM \`visits\`
        WHERE ${SOLO_VISTAS} AND \`created_at\` >= ? AND \`country_code\` IS NOT NULL
        GROUP BY \`country_code\` ORDER BY visitas DESC LIMIT 25`,
      [l.desde]
    ).then((f) => f.map((r) => ({ cc: r.cc, nombre: r.nombre || r.cc, visitas: n(r.visitas), visitantes: n(r.visitantes) }))),
    query(
      `SELECT \`city\` AS clave, MAX(\`country_code\`) AS cc,
              COUNT(*) AS visitas, COUNT(DISTINCT \`visitor_id\`) AS visitantes
         FROM \`visits\`
        WHERE ${SOLO_VISTAS} AND \`created_at\` >= ? AND \`city\` IS NOT NULL
        GROUP BY \`city\` ORDER BY visitas DESC LIMIT 15`,
      [l.desde]
    ).then((f) => f.map((r) => ({ clave: r.clave, cc: r.cc, visitas: n(r.visitas), visitantes: n(r.visitantes) }))),
    topDe('`browser`', l.desde, 8),
    topDe('`os`', l.desde, 8),
    topDe('`device`', l.desde, 5),
    topDe('`lang`', l.desde, 8),
    topDe('`ref_host`', l.desde, 12),
    topDe('`tab`', l.desde, 6),
    topDe('`path`', l.desde, 10),
    query(
      `SELECT DATE(\`dia\`) AS dia, \`peticiones\`, \`api\`, \`bots\`
         FROM \`traffic_daily\` WHERE \`dia\` >= DATE(?) ORDER BY \`dia\` ASC`,
      [l.desde]
    ).then((f) => f.map((r) => ({ fecha: r.dia, peticiones: n(r.peticiones), api: n(r.api), bots: n(r.bots) }))),
    apk(l),
  ])

  return {
    rango: l.rango,
    desde: l.desde,
    dias: l.dias,
    desfaseHoras: DESFASE,
    resumen: res,
    serie,
    horas,
    paises,
    ciudades,
    navegadores,
    sistemas,
    dispositivos,
    idiomas,
    referentes,
    pestanas,
    rutas,
    trafico,
    apk: datosApk,
  }
}

/* ─── detalle ─── */

export const ultimasVisitas = (limite = 50) => query(
  `SELECT \`visitor_id\`,\`ip\`,\`country_code\`,\`country\`,\`city\`,\`region\`,\`browser\`,\`browser_ver\`,
          \`os\`,\`device\`,\`modo\`,\`ref_host\`,\`tab\`,\`path\`,\`lang\`,\`created_at\`
     FROM \`visits\`
    WHERE ${SOLO_VISTAS}
    ORDER BY \`id\` DESC LIMIT ${Math.min(Math.max(Math.trunc(limite) || 50, 1), 200)}`
)

/** Historial de una persona, buscando por su id anonimo o por su IP. */
export async function detalleVisitante({ visitorId = null, ip = null }) {
  const porId = Boolean(visitorId)
  const filtro = porId ? '`visitor_id` = ?' : '`ip` = ?'
  const valor = porId ? visitorId : ip

  const [ficha, historial, [totales]] = await Promise.all([
    porId
      ? query('SELECT * FROM `visitors` WHERE `visitor_id` = ?', [visitorId])
      : query('SELECT * FROM `visitors` WHERE `last_ip` = ? ORDER BY `ultima` DESC LIMIT 5', [ip]),
    query(
      `SELECT \`event\`,\`tab\`,\`path\`,\`ref_host\`,\`ip\`,\`city\`,\`country\`,\`browser\`,\`os\`,
              \`device\`,\`modo\`,\`duracion_ms\`,\`created_at\`
         FROM \`visits\` WHERE ${filtro}
        ORDER BY \`id\` DESC LIMIT 100`,
      [valor]
    ),
    query(
      `SELECT COUNT(*) AS eventos, COUNT(DISTINCT \`session_id\`) AS sesiones,
              MIN(\`created_at\`) AS primera, MAX(\`created_at\`) AS ultima
         FROM \`visits\` WHERE ${filtro}`,
      [valor]
    ),
  ])

  return { ficha, historial, totales }
}

/** Las IPs mas repetidas: quien entra mucho, y desde donde. */
export const topIps = (rango, limite = 20) => {
  const l = limites(rango)
  return query(
    `SELECT \`ip\`, MAX(\`country_code\`) AS cc, MAX(\`country\`) AS pais, MAX(\`city\`) AS ciudad,
            COUNT(*) AS visitas, COUNT(DISTINCT \`visitor_id\`) AS personas,
            MAX(\`created_at\`) AS ultima
       FROM \`visits\`
      WHERE ${SOLO_VISTAS} AND \`created_at\` >= ?
      GROUP BY \`ip\` ORDER BY visitas DESC LIMIT ${Math.min(Math.max(Math.trunc(limite) || 20, 1), 100)}`,
    [l.desde]
  )
}

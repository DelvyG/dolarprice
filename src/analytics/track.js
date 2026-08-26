// Registro de visitas. Todo lo que escribe la analitica pasa por aqui.
//
// Regla de oro: la analitica JAMAS puede tumbar el sitio ni hacerlo lento. Por
// eso el beacon responde 204 antes de tocar la base, los fallos se tragan con un
// log y la cola tiene tope: si MariaDB se pone lenta se pierden visitas, que es
// muchisimo mejor que acumular memoria hasta que el servicio muera.

import { query, ahora } from '../db.js'
import { leerUA } from './ua.js'
import { ubicar } from './geo.js'

const TOPE_COLA = 500          // eventos en espera antes de empezar a descartar
const TOPE_POR_IP = 120        // eventos por IP y por minuto
const VENTANA_MS = 60000

/* ─── IP real ───────────────────────────────────────────────────────────────
   El vhost ya trae `real_ip_header CF-Connecting-IP` y el bloque
   `set_real_ip_from` con los rangos de Cloudflare, asi que $remote_addr en
   nginx YA es la IP del visitante y no la del borde de Cloudflare. Se prefiere
   X-Real-IP (un solo valor, puesto por nuestro propio nginx) antes que
   X-Forwarded-For, que es una lista y la puede falsificar el cliente. */
export function ipDe(req) {
  const real = req.headers['x-real-ip']
  if (real && typeof real === 'string') return real.trim().slice(0, 45)
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim().slice(0, 45)
  return (req.ip || '').slice(0, 45)
}

/* ─── limite por IP ─── */
const golpes = new Map()

function pasaLimite(ip) {
  const t = Date.now()
  const v = golpes.get(ip)
  if (!v || t > v.hasta) { golpes.set(ip, { n: 1, hasta: t + VENTANA_MS }); return true }
  v.n += 1
  return v.n <= TOPE_POR_IP
}

// La tabla de golpes se limpia sola: sin esto crece con cada IP nueva y no baja.
setInterval(() => {
  const t = Date.now()
  for (const [ip, v] of golpes) if (t > v.hasta) golpes.delete(ip)
}, VENTANA_MS).unref()

/* ─── contadores de trafico bruto ───────────────────────────────────────────
   Cuentan TODA peticion, incluidas las de bots y las de ficheros, que el beacon
   no ve. Se acumulan en memoria y se vuelcan una vez por minuto: una escritura
   por minuto en vez de una por peticion. */
const bruto = { peticiones: 0, api: 0, bots: 0 }

export function contarPeticion(req) {
  bruto.peticiones += 1
  if (req.url?.startsWith('/api/')) bruto.api += 1
  if (leerUA(req.headers['user-agent'] || '').bot) bruto.bots += 1
}

export async function volcarTrafico(log) {
  if (bruto.peticiones === 0) return
  const { peticiones, api, bots } = bruto
  bruto.peticiones = 0; bruto.api = 0; bruto.bots = 0
  try {
    await query(
      'INSERT INTO `traffic_daily` (`dia`,`peticiones`,`api`,`bots`) VALUES (CURDATE(),?,?,?) ' +
      'ON DUPLICATE KEY UPDATE ' +
      '  `peticiones` = `peticiones` + VALUES(`peticiones`), ' +
      '  `api`        = `api`        + VALUES(`api`), ' +
      '  `bots`       = `bots`       + VALUES(`bots`)',
      [peticiones, api, bots]
    )
  } catch (e) {
    log?.warn(`analitica: no se pudo volcar el trafico (${e.message})`)
  }
}

/* ─── cola de escritura ─── */
const cola = []
let vaciando = false
let descartados = 0

async function vaciarCola(log) {
  if (vaciando) return
  vaciando = true
  while (cola.length) {
    const v = cola.shift()
    try {
      await escribir(v)
    } catch (e) {
      log?.warn(`analitica: fallo al guardar la visita (${e.message})`)
    }
  }
  vaciando = false
  if (descartados) {
    log?.warn(`analitica: ${descartados} eventos descartados por cola llena`)
    descartados = 0
  }
}

async function escribir(v) {
  await query(
    'INSERT INTO `visits` ' +
    '  (`visitor_id`,`session_id`,`event`,`path`,`tab`,`referrer`,`ref_host`,`ip`,' +
    '   `country_code`,`country`,`region`,`city`,`browser`,`browser_ver`,`os`,`os_ver`,' +
    '   `device`,`modo`,`apk_instalado`,`screen_w`,`screen_h`,`lang`,`user_agent`,`duracion_ms`,`created_at`) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [v.visitorId, v.sessionId, v.event, v.path, v.tab, v.referrer, v.refHost, v.ip,
     v.countryCode, v.country, v.region, v.city, v.browser, v.browserVer, v.os, v.osVer,
     v.device, v.modo, v.apkInstalado, v.screenW, v.screenH, v.lang, v.userAgent, v.duracionMs, v.t]
  )

  // 'fin' solo trae la duracion de una visita ya contada e 'instalar' es un
  // aviso suelto: sumarlos al total del visitante lo contaria dos veces.
  if (v.event === 'fin' || v.event === 'instalar') return

  await query(
    'INSERT INTO `visitors` ' +
    '  (`visitor_id`,`primera`,`ultima`,`visitas`,`last_ip`,`country_code`,`country`,`city`,`device`,`browser`,`os`,`modo`) ' +
    'VALUES (?,?,?,1,?,?,?,?,?,?,?,?) ' +
    'ON DUPLICATE KEY UPDATE ' +
    '  `ultima` = VALUES(`ultima`), ' +
    '  `visitas` = `visitas` + 1, ' +
    '  `last_ip` = VALUES(`last_ip`), ' +
    '  `country_code` = COALESCE(VALUES(`country_code`), `country_code`), ' +
    '  `country` = COALESCE(VALUES(`country`), `country`), ' +
    '  `city` = COALESCE(VALUES(`city`), `city`), ' +
    '  `device` = VALUES(`device`), `browser` = VALUES(`browser`), ' +
    '  `os` = VALUES(`os`), `modo` = VALUES(`modo`)',
    [v.visitorId, v.t, v.t, v.ip, v.countryCode, v.country, v.city, v.device, v.browser, v.os, v.modo]
  )
}

/* ─── saneado de lo que manda el cliente ─── */

const EVENTOS = new Set(['view', 'tab', 'fin', 'instalar'])
const TABS = new Set(['inicio', 'monedas', 'noticias', 'historial'])
const MODOS = new Set(['navegador', 'pwa', 'apk'])
const ID = /^[a-f0-9]{32}$/

const txt = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)
const ent = (v, max) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 && n <= max ? n : null
}

// El host del referente, ya normalizado, para poder agrupar por dominio sin
// hacer malabares en SQL. Se descarta el propio dominio: no es "de donde viene".
function hostDe(ref) {
  if (!ref) return null
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '').toLowerCase()
    return h === 'dolarprice.com' ? null : h.slice(0, 150)
  } catch {
    return null
  }
}

/**
 * Encola una visita. No espera a la base: devuelve enseguida.
 * @returns {boolean} false si se descarto (bot, limite, cola llena o datos malos)
 */
export function registrar(req, cuerpo, log) {
  const ua = req.headers['user-agent'] || ''
  const info = leerUA(ua)
  if (info.bot) return false

  const ip = ipDe(req)
  if (!ip || !pasaLimite(ip)) return false

  if (cola.length >= TOPE_COLA) { descartados += 1; return false }

  const visitorId = ID.test(cuerpo?.v || '') ? cuerpo.v : null
  const sessionId = ID.test(cuerpo?.s || '') ? cuerpo.s : null
  if (!visitorId || !sessionId) return false

  const event = EVENTOS.has(cuerpo?.event) ? cuerpo.event : 'view'
  const geo = ubicar(ip, req.headers['cf-ipcountry'] || null)
  const referrer = txt(cuerpo?.r, 500)

  cola.push({
    visitorId,
    sessionId,
    event,
    path: txt(cuerpo?.p, 300) || '/',
    tab: TABS.has(cuerpo?.t) ? cuerpo.t : null,
    referrer,
    refHost: hostDe(referrer),
    ip,
    countryCode: geo.countryCode,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    browser: info.browser,
    browserVer: info.browserVer,
    os: info.os,
    osVer: info.osVer,
    device: info.device,
    modo: MODOS.has(cuerpo?.m) ? cuerpo.m : 'navegador',
    // null cuando el navegador no sabe responder (todo lo que no sea Chrome en
    // Android). Ojo con esto al leerlo: null no significa "no lo tiene".
    apkInstalado: typeof cuerpo?.k === 'boolean' ? (cuerpo.k ? 1 : 0) : null,
    screenW: ent(cuerpo?.w, 20000),
    screenH: ent(cuerpo?.h, 20000),
    lang: txt(cuerpo?.l, 20),
    userAgent: txt(ua, 400),
    duracionMs: event === 'fin' ? ent(cuerpo?.d, 86400000) : null,
    t: ahora(),
  })

  vaciarCola(log)
  return true
}

/* ─── descargas del APK ─────────────────────────────────────────────────────
   Esta si se cuenta del lado del servidor: bajarse un fichero no ejecuta nada
   en el navegador, no hay beacon que valga. Se llama desde el hook onResponse
   de server.js cuando alguien pide /descargas/DolarPrice.apk y el servidor
   responde 200 o 206 (Chrome en Android pide el fichero por trozos).

   Un mismo aparato puede generar varias filas si reanuda la descarga; por eso
   el panel muestra las descargas unicas por IP y por dia, no las filas crudas. */
export function registrarDescargaApk(req, log) {
  const ua = req.headers['user-agent'] || ''
  if (leerUA(ua).bot) return
  const ip = ipDe(req)
  if (!ip) return
  const geo = ubicar(ip, req.headers['cf-ipcountry'] || null)

  query(
    'INSERT INTO `apk_downloads` (`ip`,`country_code`,`country`,`city`,`referrer`,`user_agent`,`created_at`) ' +
    'VALUES (?,?,?,?,?,?,?)',
    [ip, geo.countryCode, geo.country, geo.city, txt(req.headers.referer, 500), txt(ua, 400), ahora()]
  ).catch((e) => log?.warn(`analitica: no se pudo anotar la descarga del APK (${e.message})`))
}

/* ─── purga ─────────────────────────────────────────────────────────────────
   `visits` es la unica tabla que crece sin freno. Se borra por tandas y no de
   un golpe para no bloquear la tabla entera mientras el sitio esta sirviendo.
   `visitors` no se purga: es una fila por persona y ahi vive el "desde cuando
   nos visita", que es lo que se perderia para siempre. */
export async function purgar(dias, log) {
  let total = 0
  for (let i = 0; i < 40; i++) {
    const r = await query(
      'DELETE FROM `visits` WHERE `created_at` < (NOW() - INTERVAL ? DAY) LIMIT 2000',
      [dias]
    )
    total += r.affectedRows || 0
    if (!r.affectedRows) break
  }
  await query('DELETE FROM `admin_sessions` WHERE `expira` < NOW()')
  await query('DELETE FROM `admin_logins` WHERE `intento_at` < (NOW() - INTERVAL 7 DAY)')
  if (total) log?.info(`analitica: purgadas ${total} visitas de mas de ${dias} dias`)
  return total
}

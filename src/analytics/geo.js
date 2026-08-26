// Geolocalizacion por IP. Base local, sin llamar a ningun servicio externo.
//
// Se descarta consultar una API tipo ip-api.com en cada visita por tres razones:
// mandaria la IP de cada usuario a un tercero, anadiria latencia a una escritura
// que debe ser instantanea, y el sitio se quedaria sin paises el dia que ese
// servicio falle. Con la base en disco la consulta son microsegundos.
//
// Si el fichero no esta (servidor recien montado, o la descarga fallo) esto no
// revienta: cae en la cabecera CF-IPCountry que Cloudflare ya manda en cada
// peticion. Se pierde la ciudad, no el pais. Ver scripts/update-geoip.js.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import maxmind from 'maxmind'
import { ROOT } from '../config.js'

export const DESTINO_MMDB = process.env.GEOIP_MMDB || join(ROOT, 'data', 'dbip-city-lite.mmdb')

let lector = null
let intentado = false

// Nombres en espanol de los paises que de verdad salen en el trafico. Para el
// resto se usa el que trae la base, que viene en ingles.
const PAISES = {
  VE: 'Venezuela', US: 'Estados Unidos', ES: 'Espana', CO: 'Colombia', PE: 'Peru',
  CL: 'Chile', AR: 'Argentina', MX: 'Mexico', BR: 'Brasil', EC: 'Ecuador',
  PA: 'Panama', DO: 'Republica Dominicana', PT: 'Portugal', IT: 'Italia',
  CA: 'Canada', FR: 'Francia', DE: 'Alemania', GB: 'Reino Unido', UY: 'Uruguay',
  BO: 'Bolivia', PY: 'Paraguay', CR: 'Costa Rica', GT: 'Guatemala', CU: 'Cuba',
  TR: 'Turquia', CN: 'China', RU: 'Rusia', NL: 'Paises Bajos', AU: 'Australia',
}

export async function cargarGeo(log) {
  if (intentado) return lector
  intentado = true
  if (!existsSync(DESTINO_MMDB)) {
    log?.warn(`GeoIP: falta ${DESTINO_MMDB}. Se usara CF-IPCountry (pais, sin ciudad). Corre: npm run geoip`)
    return null
  }
  try {
    // cache: la mayoria del trafico repite un punado de IPs de operadoras
    // venezolanas; con esto casi ninguna consulta llega a tocar el disco.
    lector = await maxmind.open(DESTINO_MMDB, { cache: { max: 6000 } })
    log?.info('GeoIP: base cargada')
  } catch (e) {
    log?.error(`GeoIP: no se pudo abrir la base (${e.message}). Se usara CF-IPCountry.`)
    lector = null
  }
  return lector
}

const es = (v) => (typeof v === 'string' ? v : v?.es || v?.en || null)
const corta = (v, n) => (v ? String(v).slice(0, n) : null)

/** Bandera emoji a partir del codigo ISO, sin tabla de imagenes. */
export const bandera = (cc) =>
  cc && /^[A-Za-z]{2}$/.test(cc)
    ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : ''

/**
 * @param {string} ip
 * @param {string|null} ccCloudflare valor de la cabecera CF-IPCountry, si llego
 * @returns {{countryCode, country, region, city}}
 */
export function ubicar(ip, ccCloudflare = null) {
  const vacio = { countryCode: null, country: null, region: null, city: null }

  let dato = null
  try {
    dato = lector && ip ? lector.get(ip) : null
  } catch {
    dato = null   // IP malformada o rango que la base no cubre
  }

  // XX es lo que manda Cloudflare cuando no sabe, y T1 cuando viene por Tor.
  const ccCF = ccCloudflare && /^[A-Z]{2}$/.test(ccCloudflare) && ccCloudflare !== 'XX'
    ? ccCloudflare
    : null

  const cc = dato?.country?.iso_code || dato?.registered_country?.iso_code || ccCF
  if (!cc) return vacio

  const nombreBase = es(dato?.country?.names) || es(dato?.registered_country?.names)

  return {
    countryCode: cc,
    country: corta(PAISES[cc] || nombreBase || cc, 80),
    region: corta(es(dato?.subdivisions?.[0]?.names), 80),
    city: corta(es(dato?.city?.names), 120),
  }
}

export const hayBaseGeo = () => Boolean(lector)

// Correo y contrasena del panel.
//
// Viven en la tabla `admin_config` y no en el .env para que se puedan cambiar
// desde el propio panel, sin SSH y sin reiniciar el servicio. El .env sigue
// sirviendo de arranque: mientras la tabla este vacia se usa lo que haya alli,
// y en cuanto se cambia algo desde el panel manda la base.
//
// Se cachean en memoria porque se leen en cada intento de entrada; la cache se
// invalida al escribir, que es lo unico que puede cambiarlos.

import { query, ahora } from '../db.js'
import { config } from '../config.js'

const CORREO_POR_DEFECTO = 'digitalgroup21@gmail.com'

let cache = null

async function cargar() {
  if (cache) return cache
  let filas = []
  try {
    filas = await query('SELECT `clave`,`valor` FROM `admin_config`')
  } catch {
    filas = []   // la tabla aun no existe: se cae al .env
  }
  const enBase = Object.fromEntries(filas.map((f) => [f.clave, f.valor]))
  cache = {
    crudo: enBase,
    email: (enBase.email || process.env.ADMIN_EMAIL || CORREO_POR_DEFECTO).toLowerCase(),
    hash: enBase.pass_hash || config.admin.hash || '',
    // De donde salio cada cosa. El panel lo muestra para que se vea si la clave
    // sigue siendo la del .env o ya se cambio desde aqui.
    origenHash: enBase.pass_hash ? 'panel' : (config.admin.hash ? 'env' : 'ninguno'),
  }
  return cache
}

export const correoAdmin = async () => (await cargar()).email
export const hashAdmin = async () => (await cargar()).hash
export const origenHash = async () => (await cargar()).origenHash

/**
 * Lector generico de la misma tabla. Lo usan los ajustes del programa de
 * referidos, que se editan desde el panel para no tener que desplegar cada vez
 * que se cambia el monto que se paga.
 */
export async function valor(clave, defecto = null) {
  const v = (await cargar()).crudo[clave]
  return v === undefined ? defecto : v
}

export async function numero(clave, defecto) {
  const crudo = await valor(clave, null)
  // Ojo con el orden: Number(null) es 0, y 0 es finito. Comprobar solo
  // Number.isFinite() haria que una clave que NO existe devolviera 0 en vez del
  // valor por defecto -- que en el programa de referidos significaba pagar cero
  // a todo el mundo y un minimo de retiro de cero.
  if (crudo === null || crudo === undefined || crudo === '') return defecto
  const n = Number(crudo)
  return Number.isFinite(n) ? n : defecto
}

export const guardarValor = (clave, v) => guardar(clave, String(v))

async function guardar(clave, valor) {
  await query(
    'INSERT INTO `admin_config` (`clave`,`valor`,`actualizado`) VALUES (?,?,?) ' +
    'ON DUPLICATE KEY UPDATE `valor` = VALUES(`valor`), `actualizado` = VALUES(`actualizado`)',
    [clave, valor, ahora()]
  )
  cache = null
}

export const guardarHash = (hash) => guardar('pass_hash', hash)
export const guardarCorreo = (email) => guardar('email', String(email).trim().toLowerCase())

/** Comprobacion deliberadamente laxa: aqui no se manda correo, solo se compara. */
export const correoValido = (v) =>
  typeof v === 'string' && v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())

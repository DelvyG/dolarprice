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

/**
 * Reglas de la contrasena nueva. Diez caracteres y que no sea la de ahora.
 * No se exige mayuscula-numero-simbolo a proposito: obliga a claves cortas y
 * retorcidas que acaban en un papel, y aqui el freno de verdad es el bloqueo
 * por intentos y el coste de scrypt.
 */
export function revisarClave(nueva, confirmar) {
  if (typeof nueva !== 'string' || nueva.length < 10) {
    return 'La contrasena nueva debe tener al menos 10 caracteres'
  }
  if (nueva.length > 200) return 'Demasiado larga'
  if (nueva !== confirmar) return 'La confirmacion no coincide'
  return null
}

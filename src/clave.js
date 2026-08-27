// Hasheo y comprobacion de contrasenas. Lo comparten el panel de /admin y las
// cuentas de usuario del programa de referidos: una sola implementacion, para
// que endurecer el coste beneficie a las dos y no haya una version floja.

import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

// N=32768 son unos 32 MB y ~60 ms por intento: imperceptible al entrar, y a un
// atacante que se llevara la base le deja unos 15 intentos por segundo y por
// nucleo en vez de millones. Se probo con 16384 y salia en 27 ms, que ya es
// poco freno para el hardware de hoy.
//
// maxmem hay que darlo explicitamente: el tope por defecto de Node son 32 MB
// justos y con N=32768 se pasa por poco, asi que scrypt lanzaria. El limite se
// aplica tambien al verificar, que lee la N guardada en el propio hash.
const SCRYPT = { N: 32768, r: 8, p: 1, len: 64 }
const MAXMEM = 128 * 1024 * 1024

const igual = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function hashear(pass) {
  const salt = randomBytes(16)
  const dk = await scrypt(pass, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$')
}

export async function verificarPass(pass, guardado) {
  // Se calcula un scrypt aunque no haya hash: si no, el tiempo de respuesta
  // delataria que esa cuenta no existe, o que el panel no tiene clave puesta.
  const partes = String(guardado || '').split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') {
    await scrypt(pass, 'sin-configurar', SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM })
    return false
  }

  // Los parametros salen del hash guardado, no de las constantes de arriba: asi
  // subir el coste no invalida las contrasenas ya creadas. Pero se acotan antes
  // de usarlos -- una N disparatada colgaria el proceso en cada intento.
  const [, N, r, p, salt, dk] = partes
  const nN = Number(N), nR = Number(r), nP = Number(p)
  if (!(nN >= 1024 && nN <= 1048576 && nR >= 1 && nR <= 32 && nP >= 1 && nP <= 16)) return false

  const calc = await scrypt(pass, Buffer.from(salt, 'base64'), Buffer.from(dk, 'base64').length,
    { N: nN, r: nR, p: nP, maxmem: MAXMEM })
  return igual(calc.toString('base64'), dk)
}

export { igual as igualSeguro }

/**
 * Reglas de una contrasena nueva. Diez caracteres y que coincida la
 * confirmacion. No se exige mayuscula-numero-simbolo a proposito: obliga a
 * claves cortas y retorcidas que acaban apuntadas en un papel, y el freno de
 * verdad es el bloqueo por intentos mas el coste de scrypt.
 *
 * @returns {string|null} el problema, o null si esta bien
 */
export function revisarClave(nueva, confirmar) {
  if (typeof nueva !== 'string' || nueva.length < 10) {
    return 'La contrasena debe tener al menos 10 caracteres'
  }
  if (nueva.length > 200) return 'Demasiado larga'
  if (confirmar !== undefined && nueva !== confirmar) return 'La confirmacion no coincide'
  return null
}

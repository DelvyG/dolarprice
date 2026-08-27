// Autenticacion del panel.
//
// El panel de la version vieja de DolarPrice sembraba admin@dolarprice.com con
// la contrasena "password", la tenia quemada en el codigo y no limitaba los
// intentos. Este se hizo de cero justamente por eso, asi que aqui:
//
//   - la contrasena solo existe como hash scrypt en el .env, que nunca esta en
//     el repo. Se genera con `npm run admin:pass`;
//   - la sesion es un token aleatorio de 32 bytes; en la base se guarda solo su
//     sha256, de modo que ni con un volcado de MariaDB se puede suplantar a
//     nadie. Y al estar en tabla, se pueden cerrar de verdad desde el panel;
//   - la cookie va firmada con HMAC ademas de guardada, para descartar los
//     tokens inventados sin ni siquiera consultar la base;
//   - seis fallos por IP en quince minutos y se cierra la puerta;
//   - todas las comparaciones son timingSafeEqual.
//
// Sin dependencias: node:crypto trae todo esto de serie.

import { createHmac, randomBytes, createHash } from 'node:crypto'
import { hashear, verificarPass, igualSeguro as igual, revisarClave } from '../clave.js'
import { query, ahora } from '../db.js'
import { config } from '../config.js'
import { correoAdmin, hashAdmin, guardarHash, guardarCorreo, correoValido } from './ajustes.js'

// hashear() y verificarPass() viven ahora en src/clave.js, compartidos con las
// cuentas de usuario del programa de referidos: una sola implementacion, para
// que endurecer el coste beneficie a las dos y no quede una version floja.
// Se reexportan porque scripts/admin-pass.js los importa desde aqui.
export { hashear, verificarPass }

const COOKIE = 'dp_admin'
const DIAS_SESION = 7
const MAX_FALLOS = 6
const VENTANA_MIN = 15

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/* ─── cookie firmada ─── */

const firmar = (token) =>
  createHmac('sha256', config.admin.secret).update(token).digest('base64url')

function leerCookie(req) {
  const crudo = req.headers.cookie
  if (!crudo) return null
  for (const trozo of crudo.split(';')) {
    const i = trozo.indexOf('=')
    if (i < 0) continue
    if (trozo.slice(0, i).trim() === COOKIE) return trozo.slice(i + 1).trim()
  }
  return null
}

function tokenValido(valor) {
  if (!valor) return null
  const i = valor.lastIndexOf('.')
  if (i < 0) return null
  const token = valor.slice(0, i)
  return igual(valor.slice(i + 1), firmar(token)) ? token : null
}

/** Marca si la peticion trae la cookie del panel, aunque no se valide contra la base. */
export const pareceAdmin = (req) => Boolean(leerCookie(req))

function ponerCookie(reply, valor, maxAge) {
  const partes = [
    `${COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',      // basta como defensa CSRF: ningun POST de otro sitio la lleva
    `Max-Age=${maxAge}`,
  ]
  // En local se entra por http://127.0.0.1 y con Secure el navegador la tiraria.
  if (config.admin.cookieSegura) partes.push('Secure')
  reply.header('Set-Cookie', partes.join('; '))
}

/* ─── intentos fallidos ─── */

export async function bloqueado(ip) {
  const [f] = await query(
    'SELECT COUNT(*) AS n, MAX(`intento_at`) AS ultimo FROM `admin_logins` ' +
    'WHERE `ip` = ? AND `ok` = 0 AND `intento_at` > (NOW() - INTERVAL ? MINUTE)',
    [ip, VENTANA_MIN]
  )
  if (Number(f?.n || 0) < MAX_FALLOS) return null
  const desde = new Date(String(f.ultimo).replace(' ', 'T') + 'Z').getTime()
  const restan = Math.max(1, Math.ceil((desde + VENTANA_MIN * 60000 - Date.now()) / 60000))
  return restan
}

const anotarIntento = (ip, ok) =>
  query('INSERT INTO `admin_logins` (`ip`,`ok`,`intento_at`) VALUES (?,?,?)', [ip, ok ? 1 : 0, ahora()])

/* ─── sesiones ─── */

export async function abrirSesion(reply, ip, ua) {
  const token = randomBytes(32).toString('base64url')
  const t = ahora()
  const expira = new Date(Date.now() + DIAS_SESION * 86400000).toISOString().slice(0, 19).replace('T', ' ')

  await query(
    'INSERT INTO `admin_sessions` (`token_hash`,`creada`,`ultima`,`expira`,`ip`,`user_agent`) VALUES (?,?,?,?,?,?)',
    [sha256(token), t, t, expira, ip, (ua || '').slice(0, 300)]
  )

  ponerCookie(reply, `${token}.${firmar(token)}`, DIAS_SESION * 86400)
  return expira
}

export async function cerrarSesion(req, reply) {
  const token = tokenValido(leerCookie(req))
  if (token) await query('DELETE FROM `admin_sessions` WHERE `token_hash` = ?', [sha256(token)])
  ponerCookie(reply, '', 0)
}

export const cerrarTodas = () => query('DELETE FROM `admin_sessions`')

export const sesionesAbiertas = () =>
  query('SELECT `creada`,`ultima`,`expira`,`ip`,`user_agent` FROM `admin_sessions` ' +
        'WHERE `expira` > NOW() ORDER BY `ultima` DESC LIMIT 20')

/** @returns {boolean} true si la peticion trae una sesion viva. */
export async function haySesion(req) {
  const token = tokenValido(leerCookie(req))
  if (!token) return false
  const hash = sha256(token)
  const filas = await query(
    'SELECT `token_hash` FROM `admin_sessions` WHERE `token_hash` = ? AND `expira` > NOW()',
    [hash]
  )
  if (!filas.length) return false
  // Se refresca sin esperar: llevar la cuenta de la ultima actividad no debe
  // meterle latencia a cada peticion del panel.
  query('UPDATE `admin_sessions` SET `ultima` = ? WHERE `token_hash` = ?', [ahora(), hash]).catch(() => {})
  return true
}

/* ─── entrada ─── */

/**
 * @returns {{ok: true} | {ok: false, motivo: string, minutos?: number}}
 */
export async function entrar(reply, { email, pass, ip, ua }) {
  const guardado = await hashAdmin()
  if (!guardado) {
    await verificarPass(String(pass || ''), null)   // gasta el mismo tiempo igual
    return { ok: false, motivo: 'sin-configurar' }
  }

  const minutos = await bloqueado(ip)
  if (minutos) return { ok: false, motivo: 'bloqueado', minutos }

  // El correo se comprueba igual que la contrasena y se responde lo mismo en
  // los dos casos: decir "ese correo no existe" le regalaria al atacante la
  // mitad del trabajo. Y se verifica la clave aunque el correo ya haya fallado,
  // para que el tiempo de respuesta no delate cual de las dos estaba mal.
  const correoOk = igual(String(email || '').trim().toLowerCase(), await correoAdmin())
  const claveOk = await verificarPass(String(pass || ''), guardado)
  const bien = correoOk && claveOk

  await anotarIntento(ip, bien)
  if (!bien) return { ok: false, motivo: 'credenciales' }

  await abrirSesion(reply, ip, ua)
  return { ok: true }
}

/**
 * Cambia la contrasena. Exige la actual: sin eso, a quien te dejara la sesion
 * abierta un momento le bastaria con cambiarla para quedarse con el panel.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export async function cambiarClave(req, { actual, nueva, confirmar }) {
  const guardado = await hashAdmin()
  if (!(await verificarPass(String(actual || ''), guardado))) {
    return { ok: false, error: 'La contrasena actual no es correcta' }
  }

  const problema = revisarClave(nueva, confirmar)
  if (problema) return { ok: false, error: problema }
  if (await verificarPass(nueva, guardado)) {
    return { ok: false, error: 'La contrasena nueva es igual a la de ahora' }
  }

  await guardarHash(await hashear(nueva))

  // Se cierran las demas sesiones, no la de quien esta cambiando la clave: si
  // alguien mas la tenia abierta, el cambio no sirve de nada mientras siga
  // dentro. Es justo el caso en el que se cambia una contrasena.
  const mia = tokenValido(leerCookie(req))
  if (mia) {
    await query('DELETE FROM `admin_sessions` WHERE `token_hash` <> ?', [sha256(mia)])
  } else {
    await query('DELETE FROM `admin_sessions`')
  }

  return { ok: true }
}

/** Cambiar el correo tambien pide la contrasena: es una credencial de entrada. */
export async function cambiarCorreo({ correo, pass }) {
  if (!(await verificarPass(String(pass || ''), await hashAdmin()))) {
    return { ok: false, error: 'La contrasena no es correcta' }
  }
  if (!correoValido(correo)) return { ok: false, error: 'Ese correo no tiene buena pinta' }
  await guardarCorreo(correo)
  return { ok: true }
}

/**
 * Guardia de las rutas /api/admin. Ademas de la sesion comprueba el Origin en
 * todo lo que no sea GET: la cookie ya es SameSite=Strict, pero esto cubre el
 * caso de un navegador viejo que no lo respete.
 */
export async function exigirSesion(req, reply) {
  if (req.method !== 'GET') {
    const origen = req.headers.origin
    if (origen && origen !== `https://${req.headers.host}` && origen !== `http://${req.headers.host}`) {
      reply.code(403).send({ error: 'Origen no permitido' })
      return false
    }
  }
  if (await haySesion(req)) return true
  reply.code(401).send({ error: 'No autorizado' })
  return false
}

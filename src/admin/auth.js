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

import { createHmac, randomBytes, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { query, ahora } from '../db.js'
import { config } from '../config.js'

const scrypt = promisify(scryptCb)

const COOKIE = 'dp_admin'
const DIAS_SESION = 7
const MAX_FALLOS = 6
const VENTANA_MIN = 15

// N=32768 son unos 32 MB y ~60 ms por intento: imperceptible al entrar, y a un
// atacante que se hubiera llevado el .env le deja unos 15 intentos por segundo
// y por nucleo en vez de millones. Se probo con 16384 y salia en 27 ms, que ya
// es poco freno para el hardware de hoy.
//
// maxmem hay que darlo explicitamente: el tope por defecto de Node son 32 MB
// justos y con N=32768 se pasa por poco, asi que scrypt lanzaria. El limite se
// aplica tambien al verificar, que lee la N guardada en el propio hash.
const SCRYPT = { N: 32768, r: 8, p: 1, len: 64 }
const MAXMEM = 128 * 1024 * 1024

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const igual = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/* ─── hash de la contrasena ─── */

export async function hashear(pass) {
  const salt = randomBytes(16)
  const dk = await scrypt(pass, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$')
}

export async function verificarPass(pass, guardado) {
  // Se calcula un scrypt aunque no haya hash configurado: si no, el tiempo de
  // respuesta delataria que el panel todavia no tiene contrasena puesta.
  const partes = String(guardado || '').split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') {
    await scrypt(pass, 'sin-configurar', SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM })
    return false
  }

  // Los parametros salen del hash guardado, no de las constantes de arriba: asi
  // subir el coste no invalida las contrasenas ya creadas. Pero se acotan antes
  // de usarlos -- una N disparatada en el .env colgaria el proceso en cada
  // intento de entrada.
  const [, N, r, p, salt, dk] = partes
  const nN = Number(N), nR = Number(r), nP = Number(p)
  if (!(nN >= 1024 && nN <= 1048576 && nR >= 1 && nR <= 32 && nP >= 1 && nP <= 16)) return false

  const calc = await scrypt(pass, Buffer.from(salt, 'base64'), Buffer.from(dk, 'base64').length,
    { N: nN, r: nR, p: nP, maxmem: MAXMEM })
  return igual(calc.toString('base64'), dk)
}

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
export async function entrar(reply, { pass, ip, ua }) {
  if (!config.admin.hash) {
    await verificarPass(String(pass || ''), null)   // gasta el mismo tiempo igual
    return { ok: false, motivo: 'sin-configurar' }
  }

  const minutos = await bloqueado(ip)
  if (minutos) return { ok: false, motivo: 'bloqueado', minutos }

  const bien = await verificarPass(String(pass || ''), config.admin.hash)
  await anotarIntento(ip, bien)
  if (!bien) return { ok: false, motivo: 'credenciales' }

  await abrirSesion(reply, ip, ua)
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

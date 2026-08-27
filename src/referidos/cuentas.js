// Cuentas de usuario del programa de referidos.
//
// Mismo esqueleto que la sesion del panel (/admin), y a proposito: token
// aleatorio del que en la base solo vive el sha256, cookie firmada con HMAC
// ademas de guardada, y bloqueo por intentos. Lo que cambia es la escala --
// aqui hay muchas cuentas en vez de una -- y que hay correo de por medio para
// verificar y para restablecer la clave.
//
// La cuenta es de la PERSONA. `ref_devices` engancha los navegadores a la
// cuenta, y por eso el mismo usuario ve su saldo desde el telefono y desde la
// PC. Quien solo consulta el dolar sigue siendo anonimo: no hay que registrarse
// para usar la app, solo para cobrar por referir.

import { createHmac, randomBytes, createHash } from 'node:crypto'
import { query, ahora } from '../db.js'
import { config } from '../config.js'
import { hashear, verificarPass, revisarClave, igualSeguro } from '../clave.js'
import { enviar, correoVerificar, correoReset, hayCorreo } from '../correo.js'

const COOKIE = 'dp_user'
const DIAS_SESION = 30
const MAX_FALLOS = 8
const VENTANA_MIN = 15
const HORAS_TOKEN = { verificar: 48, reset: 1 }

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ID = /^[a-f0-9]{32}$/

const enMinutos = (min) =>
  new Date(Date.now() + min * 60000).toISOString().slice(0, 19).replace('T', ' ')

/* ─── codigo de referido ────────────────────────────────────────────────────
   Sin 0/O ni 1/I/L: el codigo se dicta por WhatsApp y en voz alta, y esas
   parejas son justo las que se escriben mal. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODIGO = /^[A-Z2-9]{5,12}$/

function codigoNuevo() {
  const b = randomBytes(7)
  return [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('')
}

/* ─── cookie ─── */

const firmar = (token) =>
  createHmac('sha256', config.referidos.secret).update(token).digest('base64url')

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
  return igualSeguro(valor.slice(i + 1), firmar(token)) ? token : null
}

function ponerCookie(reply, valor, maxAge) {
  const partes = [`${COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  // SameSite=Lax y no Strict: al usuario le llega el enlace de verificacion por
  // correo, y con Strict el navegador no mandaria la cookie al llegar desde
  // fuera, asi que aterrizaria sin sesion justo despues de confirmar.
  if (config.admin.cookieSegura) partes.push('Secure')
  reply.header('Set-Cookie', partes.join('; '))
}

async function abrirSesion(reply, userId, ip, ua) {
  const token = randomBytes(32).toString('base64url')
  const t = ahora()
  await query(
    'INSERT INTO `ref_sessions` (`token_hash`,`user_id`,`creada`,`ultima`,`expira`,`ip`,`user_agent`) ' +
    'VALUES (?,?,?,?,?,?,?)',
    [sha256(token), userId, t, t, enMinutos(DIAS_SESION * 1440), ip, (ua || '').slice(0, 300)]
  )
  ponerCookie(reply, `${token}.${firmar(token)}`, DIAS_SESION * 86400)
}

/** @returns {number|null} el id del usuario con sesion abierta, o null. */
export async function usuarioDe(req) {
  const token = tokenValido(leerCookie(req))
  if (!token) return null
  const hash = sha256(token)
  const [f] = await query(
    'SELECT `user_id` FROM `ref_sessions` WHERE `token_hash` = ? AND `expira` > NOW()', [hash]
  )
  if (!f) return null
  query('UPDATE `ref_sessions` SET `ultima` = ? WHERE `token_hash` = ?', [ahora(), hash]).catch(() => {})
  return Number(f.user_id)
}

export async function salir(req, reply) {
  const token = tokenValido(leerCookie(req))
  if (token) await query('DELETE FROM `ref_sessions` WHERE `token_hash` = ?', [sha256(token)])
  ponerCookie(reply, '', 0)
}

/* ─── intentos fallidos ─── */

async function bloqueado(ip) {
  const [f] = await query(
    'SELECT COUNT(*) AS n, MAX(`intento_at`) AS ultimo FROM `ref_logins` ' +
    'WHERE `ip` = ? AND `ok` = 0 AND `intento_at` > (NOW() - INTERVAL ? MINUTE)',
    [ip, VENTANA_MIN]
  )
  if (Number(f?.n || 0) < MAX_FALLOS) return null
  const desde = new Date(String(f.ultimo).replace(' ', 'T') + 'Z').getTime()
  return Math.max(1, Math.ceil((desde + VENTANA_MIN * 60000 - Date.now()) / 60000))
}

const anotar = (ip, email, ok) =>
  query('INSERT INTO `ref_logins` (`ip`,`email`,`ok`,`intento_at`) VALUES (?,?,?,?)',
    [ip, String(email || '').slice(0, 160), ok ? 1 : 0, ahora()])

/* ─── enlaces de un solo uso ─── */

async function crearToken(userId, tipo) {
  const token = randomBytes(32).toString('base64url')
  // Solo uno vivo por tipo: pedir el enlace otra vez invalida el anterior, que
  // es lo que la gente espera y evita dejar enlaces validos rodando por ahi.
  await query('DELETE FROM `ref_tokens` WHERE `user_id` = ? AND `tipo` = ?', [userId, tipo])
  await query(
    'INSERT INTO `ref_tokens` (`token_hash`,`user_id`,`tipo`,`expira`,`creado`) VALUES (?,?,?,?,?)',
    [sha256(token), userId, tipo, enMinutos(HORAS_TOKEN[tipo] * 60), ahora()]
  )
  return token
}

async function gastarToken(token, tipo) {
  if (typeof token !== 'string' || token.length < 20) return null
  const hash = sha256(token)
  const [f] = await query(
    'SELECT `user_id` FROM `ref_tokens` WHERE `token_hash` = ? AND `tipo` = ? AND `usado` = 0 AND `expira` > NOW()',
    [hash, tipo]
  )
  if (!f) return null
  // Marcar usado ANTES de actuar: si dos peticiones llegan a la vez, solo una
  // ve affectedRows y la otra se queda fuera.
  const r = await query('UPDATE `ref_tokens` SET `usado` = 1 WHERE `token_hash` = ? AND `usado` = 0', [hash])
  return r.affectedRows ? Number(f.user_id) : null
}

/* ─── registro ─── */

export async function registrar(reply, { email, pass, confirmar, visitorId, ip, ua }, log) {
  const correo = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(correo) || correo.length > 160) return { ok: false, error: 'Ese correo no es valido' }

  const problema = revisarClave(pass, confirmar)
  if (problema) return { ok: false, error: problema }

  const minutos = await bloqueado(ip)
  if (minutos) return { ok: false, error: `Demasiados intentos. Prueba en ${minutos} min.` }

  const [ya] = await query('SELECT `id` FROM `ref_users` WHERE `email` = ?', [correo])
  if (ya) return { ok: false, error: 'Ya hay una cuenta con ese correo' }

  const hash = await hashear(pass)
  const t = ahora()

  let userId = null
  for (let i = 0; i < 6; i++) {
    try {
      const r = await query(
        'INSERT INTO `ref_users` (`email`,`pass_hash`,`code`,`creado`,`ultimo_acceso`) VALUES (?,?,?,?,?)',
        [correo, hash, codigoNuevo(), t, t]
      )
      userId = Number(r.insertId)
      break
    } catch (e) {
      // Choque de codigo: se reintenta. Choque de correo: dos registros a la vez.
      if (!String(e.code || '').includes('DUP_ENTRY')) throw e
      const [otro] = await query('SELECT `id` FROM `ref_users` WHERE `email` = ?', [correo])
      if (otro) return { ok: false, error: 'Ya hay una cuenta con ese correo' }
    }
  }
  if (!userId) return { ok: false, error: 'No se pudo crear la cuenta, intenta de nuevo' }

  await anotar(ip, correo, true)
  await enlazarDispositivo(userId, visitorId)
  await abrirSesion(reply, userId, ip, ua)

  // El correo de verificacion se manda sin esperarlo y sin que su fallo impida
  // registrarse: no poder mandar un correo no puede dejar a nadie fuera.
  if (hayCorreo()) {
    crearToken(userId, 'verificar')
      .then((tok) => enviar({ para: correo, ...correoVerificar(tok) }, log))
      .catch((e) => log?.warn(`referidos: no se pudo mandar la verificacion (${e.message})`))
  }

  return { ok: true, userId, correoEnviado: hayCorreo() }
}

/* ─── entrada ─── */

export async function entrar(reply, { email, pass, visitorId, ip, ua }) {
  const correo = String(email || '').trim().toLowerCase()

  const minutos = await bloqueado(ip)
  if (minutos) return { ok: false, error: `Demasiados intentos. Prueba en ${minutos} min.` }

  const [u] = await query('SELECT `id`,`pass_hash`,`bloqueado` FROM `ref_users` WHERE `email` = ?', [correo])

  // Se verifica siempre, aunque la cuenta no exista: si no, el tiempo de
  // respuesta diria cuales de los correos probados estan registrados.
  const bien = await verificarPass(String(pass || ''), u?.pass_hash || null)
  await anotar(ip, correo, Boolean(u) && bien)

  if (!u || !bien) return { ok: false, error: 'Correo o contrasena incorrectos' }
  if (u.bloqueado) return { ok: false, error: 'Esta cuenta esta en revision. Escribenos.' }

  await query('UPDATE `ref_users` SET `ultimo_acceso` = ? WHERE `id` = ?', [ahora(), u.id])
  await enlazarDispositivo(u.id, visitorId)
  await abrirSesion(reply, u.id, ip, ua)
  return { ok: true, userId: Number(u.id) }
}

/* ─── dispositivos ─── */

/**
 * Engancha este navegador a la cuenta. Sirve para dos cosas: reconocer al
 * usuario en la analitica, y bloquear el autorreferido -- si el aparato ya
 * estaba enlazado a una cuenta, no puede contarse como referido de nadie.
 */
export async function enlazarDispositivo(userId, visitorId) {
  if (!ID.test(visitorId || '')) return
  await query(
    'INSERT INTO `ref_devices` (`visitor_id`,`user_id`,`enlazado`) VALUES (?,?,?) ' +
    'ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`)',
    [visitorId, userId, ahora()]
  ).catch(() => {})
}

export const cuentaDelDispositivo = async (visitorId) => {
  if (!ID.test(visitorId || '')) return null
  const [f] = await query('SELECT `user_id` FROM `ref_devices` WHERE `visitor_id` = ?', [visitorId])
  return f ? Number(f.user_id) : null
}

/* ─── verificacion y restablecimiento ─── */

export async function verificarCorreo(token) {
  const userId = await gastarToken(token, 'verificar')
  if (!userId) return { ok: false, error: 'Ese enlace ya se uso o caduco' }
  await query('UPDATE `ref_users` SET `verificado` = 1 WHERE `id` = ?', [userId])
  return { ok: true }
}

export async function reenviarVerificacion(userId, log) {
  const [u] = await query('SELECT `email`,`verificado` FROM `ref_users` WHERE `id` = ?', [userId])
  if (!u) return { ok: false, error: 'Cuenta no encontrada' }
  if (u.verificado) return { ok: false, error: 'Tu correo ya esta confirmado' }
  if (!hayCorreo()) return { ok: false, error: 'El envio de correos no esta configurado' }
  const tok = await crearToken(userId, 'verificar')
  const enviado = await enviar({ para: u.email, ...correoVerificar(tok) }, log)
  return enviado ? { ok: true } : { ok: false, error: 'No se pudo enviar el correo' }
}

/**
 * Siempre responde que si, exista o no la cuenta: responder distinto convierte
 * este formulario en una forma de averiguar que correos estan registrados.
 */
export async function pedirReset(email, log) {
  const correo = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(correo)) return { ok: true }

  const [u] = await query('SELECT `id` FROM `ref_users` WHERE `email` = ?', [correo])
  if (u && hayCorreo()) {
    const tok = await crearToken(u.id, 'reset')
    await enviar({ para: correo, ...correoReset(tok) }, log)
  }
  return { ok: true }
}

export async function aplicarReset({ token, nueva, confirmar }) {
  const problema = revisarClave(nueva, confirmar)
  if (problema) return { ok: false, error: problema }

  const userId = await gastarToken(token, 'reset')
  if (!userId) return { ok: false, error: 'Ese enlace ya se uso o caduco' }

  await query('UPDATE `ref_users` SET `pass_hash` = ? WHERE `id` = ?', [await hashear(nueva), userId])
  // Cambiar la clave cierra las sesiones: es justo para lo que se cambia.
  await query('DELETE FROM `ref_sessions` WHERE `user_id` = ?', [userId])
  return { ok: true }
}

export async function cambiarClave(userId, { actual, nueva, confirmar }) {
  const [u] = await query('SELECT `pass_hash` FROM `ref_users` WHERE `id` = ?', [userId])
  if (!u || !(await verificarPass(String(actual || ''), u.pass_hash))) {
    return { ok: false, error: 'La contrasena actual no es correcta' }
  }
  const problema = revisarClave(nueva, confirmar)
  if (problema) return { ok: false, error: problema }
  await query('UPDATE `ref_users` SET `pass_hash` = ? WHERE `id` = ?', [await hashear(nueva), userId])
  return { ok: true }
}

/* ─── limpieza ─── */

export async function limpiarSesiones(log) {
  const a = await query('DELETE FROM `ref_sessions` WHERE `expira` < NOW()')
  await query('DELETE FROM `ref_tokens` WHERE `expira` < NOW() OR `usado` = 1')
  await query('DELETE FROM `ref_logins` WHERE `intento_at` < (NOW() - INTERVAL 7 DAY)')
  if (a.affectedRows) log?.info(`referidos: ${a.affectedRows} sesiones caducadas borradas`)
}

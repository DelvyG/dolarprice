// Cuentas de usuario y programa de referidos: la API que consume la app.
//
// Todo lo que mueve saldo va por POST y comprueba el Origin. La cookie de
// sesion ya es SameSite=Lax --que bloquea los POST de otros sitios-- pero esto
// cubre al navegador viejo que no lo respete, y aqui hay dinero de por medio.
//
// El identificador de aparato (`v`) que manda el cliente NO autoriza nada: solo
// sirve para enganchar el navegador a la cuenta. Quien manda es la cookie.

import {
  registrar, entrar, salir, usuarioDe, verificarCorreo, reenviarVerificacion,
  pedirReset, aplicarReset, cambiarClave,
} from '../referidos/cuentas.js'
import { panelUsuario, pedirRetiro } from '../referidos/index.js'
import { ajustesReferidos } from '../referidos/ajustes.js'
import { ipDe } from '../analytics/track.js'
import { hayCorreo } from '../correo.js'

export default async function referidosRoutes(app) {
  const noCache = (reply) => reply.header('Cache-Control', 'no-store')

  // Guardia comun de los POST. Se registra como hook para que anadir una ruta
  // nueva no pueda dejarse sin proteger por descuido.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/cuenta') && !req.url.startsWith('/api/v1/ref')) return
    if (req.method === 'GET') return
    const origen = req.headers.origin
    if (origen && origen !== `https://${req.headers.host}` && origen !== `http://${req.headers.host}`) {
      return reply.code(403).send({ error: 'Origen no permitido' })
    }
  })

  const conSesion = async (req, reply) => {
    const userId = await usuarioDe(req)
    if (!userId) { reply.code(401).send({ error: 'Entra a tu cuenta' }); return null }
    return userId
  }

  /* ─── lo que se puede ver sin cuenta ─── */

  // Las reglas del programa, para poder ensenar "gana $X por amigo" a quien
  // todavia no se ha registrado. Nada sensible.
  app.get('/api/v1/ref/reglas', async (req, reply) => {
    noCache(reply)
    const cfg = await ajustesReferidos()
    return {
      activo: cfg.activo,
      aviso: cfg.aviso,
      recompensa: cfg.recompensa,
      minimoRetiro: cfg.minimoRetiro,
      diasActivos: cfg.diasActivos,
      diasCuarentena: cfg.diasCuarentena,
      correo: hayCorreo(),
    }
  })

  /* ─── cuenta ─── */

  app.post('/api/v1/cuenta/registro', async (req, reply) => {
    noCache(reply)
    const r = await registrar(reply, {
      email: req.body?.email,
      pass: req.body?.pass,
      confirmar: req.body?.confirmar,
      visitorId: req.body?.v,
      ip: ipDe(req),
      ua: req.headers['user-agent'],
    }, app.log)
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true, correoEnviado: r.correoEnviado }
  })

  app.post('/api/v1/cuenta/entrar', async (req, reply) => {
    noCache(reply)
    const r = await entrar(reply, {
      email: req.body?.email,
      pass: req.body?.pass,
      visitorId: req.body?.v,
      ip: ipDe(req),
      ua: req.headers['user-agent'],
    })
    if (!r.ok) return reply.code(401).send({ error: r.error })
    return { ok: true }
  })

  app.post('/api/v1/cuenta/salir', async (req, reply) => {
    noCache(reply)
    await salir(req, reply)
    return { ok: true }
  })

  // El panel del usuario. Devuelve dentro:false en vez de 401 para que la app
  // pueda pintar la tarjeta de "registrate" sin tratarlo como un error.
  app.get('/api/v1/cuenta/yo', async (req, reply) => {
    noCache(reply)
    const userId = await usuarioDe(req)
    if (!userId) return { dentro: false }
    const datos = await panelUsuario(userId)
    return datos ? { dentro: true, ...datos } : { dentro: false }
  })

  app.post('/api/v1/cuenta/verificar', async (req, reply) => {
    noCache(reply)
    const r = await verificarCorreo(req.body?.token)
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true }
  })

  app.post('/api/v1/cuenta/reenviar', async (req, reply) => {
    noCache(reply)
    const userId = await conSesion(req, reply)
    if (!userId) return reply
    const r = await reenviarVerificacion(userId, app.log)
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true }
  })

  // Siempre responde ok, exista o no la cuenta: responder distinto convertiria
  // este formulario en una forma de averiguar que correos estan registrados.
  app.post('/api/v1/cuenta/olvide', async (req, reply) => {
    noCache(reply)
    await pedirReset(req.body?.email, app.log)
    return { ok: true }
  })

  app.post('/api/v1/cuenta/reset', async (req, reply) => {
    noCache(reply)
    const r = await aplicarReset({
      token: req.body?.token,
      nueva: req.body?.nueva,
      confirmar: req.body?.confirmar,
    })
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true }
  })

  app.post('/api/v1/cuenta/clave', async (req, reply) => {
    noCache(reply)
    const userId = await conSesion(req, reply)
    if (!userId) return reply
    const r = await cambiarClave(userId, {
      actual: req.body?.actual,
      nueva: req.body?.nueva,
      confirmar: req.body?.confirmar,
    })
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true }
  })

  /* ─── retiro ─── */

  app.post('/api/v1/ref/retiro', async (req, reply) => {
    noCache(reply)
    const userId = await conSesion(req, reply)
    if (!userId) return reply
    const r = await pedirRetiro({ userId, email: req.body?.email, ip: ipDe(req) })
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true, monto: r.monto }
  })
}

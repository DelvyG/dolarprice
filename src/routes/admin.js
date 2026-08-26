// Panel de estadisticas: la pagina y su API.
//
// La pagina se sirve leida a memoria y no con reply.sendFile() porque
// @fastify/static escribe su propio Cache-Control al servir un fichero y pisa
// cualquier reply.header() de antes (ya paso con /promo y /app, ver
// routes/pages.js). Y aqui el no-store no es un detalle: el panel no puede
// quedarse guardado en el disco de nadie.
//
// No hace falta tocar el vhost para nada de esto: /admin cae en `location /`
// -> try_files -> @app, y /api/admin/ cae en `location /api/`. Los dos llegan
// a Node tal cual.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, config } from '../config.js'
import { query } from '../db.js'
import { entrar, cerrarSesion, cerrarTodas, haySesion, exigirSesion, sesionesAbiertas } from '../admin/auth.js'
import { ipDe, purgar } from '../analytics/track.js'
import { estadisticas, ultimasVisitas, detalleVisitante, topIps, RANGOS } from '../analytics/queries.js'
import { hayBaseGeo } from '../analytics/geo.js'

const PAGINA = join(ROOT, 'public', 'admin.html')

// Se lee una vez al arrancar. Un despliegue reinicia el servicio, asi que no
// hace falta recargarla en caliente.
let html = null

const rangoDe = (req) => (RANGOS[req.query?.rango] !== undefined ? req.query.rango : '7d')

export default async function adminRoutes(app) {
  try {
    html = readFileSync(PAGINA, 'utf8')
  } catch (e) {
    app.log.error(`admin: no se pudo leer ${PAGINA} (${e.message})`)
  }

  // Ni cache ni buscadores. El X-Robots-Tag va aqui y no en el vhost para no
  // tener que tocar nginx.
  const cabeceras = (reply) =>
    reply
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .header('X-Robots-Tag', 'noindex, nofollow, noarchive')

  app.get('/admin', async (req, reply) => {
    if (!html) return cabeceras(reply).code(503).type('text/plain').send('Panel no disponible')
    return cabeceras(reply).type('text/html; charset=utf-8').send(html)
  })

  /* ─── sesion ─── */

  app.post('/api/admin/login', async (req, reply) => {
    cabeceras(reply)
    const r = await entrar(reply, {
      pass: req.body?.pass,
      ip: ipDe(req),
      ua: req.headers['user-agent'],
    })

    if (r.ok) return { ok: true }

    if (r.motivo === 'sin-configurar') {
      return reply.code(503).send({
        error: 'El panel todavia no tiene contrasena. En el servidor: npm run admin:pass',
      })
    }
    if (r.motivo === 'bloqueado') {
      return reply.code(429).send({
        error: `Demasiados intentos. Vuelve a probar en ${r.minutos} minuto${r.minutos === 1 ? '' : 's'}.`,
      })
    }
    return reply.code(401).send({ error: 'Contrasena incorrecta' })
  })

  app.post('/api/admin/logout', async (req, reply) => {
    cabeceras(reply)
    await cerrarSesion(req, reply)
    return { ok: true }
  })

  app.get('/api/admin/sesion', async (req, reply) => {
    cabeceras(reply)
    return { dentro: await haySesion(req), configurado: Boolean(config.admin.hash) }
  })

  /* ─── datos ─── */

  // Todo lo de abajo exige sesion. Se registra como hook del ambito para que no
  // se pueda anadir una ruta nueva y olvidarse de protegerla.
  app.register(async (privado) => {
    privado.addHook('onRequest', async (req, reply) => {
      cabeceras(reply)
      if (!(await exigirSesion(req, reply))) return reply
    })

    privado.get('/api/admin/stats', async (req) => estadisticas(rangoDe(req)))

    privado.get('/api/admin/recientes', async (req) => ({
      visitas: await ultimasVisitas(Number(req.query?.limit) || 60),
    }))

    privado.get('/api/admin/ips', async (req) => ({
      ips: await topIps(rangoDe(req), Number(req.query?.limit) || 25),
    }))

    privado.get('/api/admin/visitante', async (req, reply) => {
      const visitorId = /^[a-f0-9]{32}$/.test(req.query?.id || '') ? req.query.id : null
      const ip = typeof req.query?.ip === 'string' ? req.query.ip.slice(0, 45) : null
      if (!visitorId && !ip) return reply.code(400).send({ error: 'Falta id o ip' })
      return detalleVisitante({ visitorId, ip })
    })

    // Estado del capturador y de las fuentes, para no tener que entrar por SSH
    // a preguntarle a systemd si el BCV sigue respondiendo.
    privado.get('/api/admin/salud', async () => {
      const [corridas, [tasas], sesiones] = await Promise.all([
        query('SELECT `source`,`ok`,`message`,`duration_ms`,`ran_at` FROM `ingest_runs` ORDER BY `id` DESC LIMIT 12'),
        query('SELECT COUNT(*) AS n FROM `rates_current`'),
        sesionesAbiertas(),
      ])
      const [tamanos] = await Promise.all([
        query(
          'SELECT TABLE_NAME AS tabla, TABLE_ROWS AS filas, ' +
          '       ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS mb ' +
          'FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC',
          [config.db.database]
        ).catch(() => []),
      ])
      return {
        corridas,
        tasas: Number(tasas?.n || 0),
        sesiones,
        tablas: tamanos,
        geoip: hayBaseGeo(),
        retencionDias: config.analytics.retencionDias,
      }
    })

    privado.post('/api/admin/sesiones/cerrar-todas', async (req, reply) => {
      await cerrarTodas()
      return reply.code(200).send({ ok: true })
    })

    privado.post('/api/admin/purgar', async (req) => {
      const dias = Math.min(Math.max(Math.trunc(Number(req.body?.dias)) || config.analytics.retencionDias, 7), 3650)
      return { borradas: await purgar(dias, app.log), dias }
    })
  })
}

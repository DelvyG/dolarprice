import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { config, ROOT } from './config.js'
import apiRoutes from './routes/api.js'
import pagesRoutes from './routes/pages.js'
import collectRoutes from './routes/collect.js'
import adminRoutes from './routes/admin.js'
import referidosRoutes from './routes/referidos.js'
import { cargarGeo } from './analytics/geo.js'
import { contarPeticion, volcarTrafico, purgar, registrarDescargaApk } from './analytics/track.js'
import { madurarSaldos } from './referidos/index.js'
import { limpiarSesiones } from './referidos/cuentas.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
})

// La base de geolocalizacion se abre una sola vez, antes de escuchar. Si no
// esta, la analitica sigue funcionando con el pais que manda Cloudflare.
await cargarGeo(app.log)

/* ─── contadores de trafico bruto ───────────────────────────────────────────
   El beacon del cliente cuenta personas; esto cuenta peticiones, que es otra
   cosa: incluye bots, ficheros y llamadas a la API. Los dos numeros hacen
   falta para leer bien el panel. Se acumula en memoria, no toca la base aqui. */
app.addHook('onResponse', async (req, reply) => {
  try {
    contarPeticion(req)
    // Descarga del APK: es lo unico que se cuenta del lado del servidor, porque
    // bajarse un fichero no ejecuta JavaScript y no hay beacon que lo avise.
    // Chrome en Android pide el fichero por trozos y responde 206.
    if (req.method === 'GET' &&
        req.url?.startsWith('/descargas/') && req.url.endsWith('.apk') &&
        (reply.statusCode === 200 || reply.statusCode === 206)) {
      registrarDescargaApk(req, app.log)
    }
  } catch { /* la analitica nunca puede romper una respuesta ya enviada */ }
})

await app.register(apiRoutes)
await app.register(collectRoutes)
await app.register(referidosRoutes)

await app.register(fastifyStatic, {
  root: join(ROOT, 'public'),
  index: ['index.html'],
  dotfiles: 'allow', // hace falta para servir /.well-known/assetlinks.json
  // Ojo: desde @fastify/static v10 el primer argumento es un FastifyReply, no la
  // respuesta cruda de Node. Va reply.header(), no res.setHeader().
  setHeaders(reply, path) {
    if (path.endsWith('assetlinks.json')) {
      // Digital Asset Links exige application/json o la app de Play no valida.
      reply.header('Content-Type', 'application/json')
      reply.header('Cache-Control', 'public, max-age=3600')
    } else if (path.endsWith('sw.js')) {
      reply.header('Cache-Control', 'no-cache')
    } else if (/\.(png|svg|webp|woff2)$/.test(path)) {
      reply.header('Cache-Control', 'public, max-age=604800')
    }
  },
})

// Despues de @fastify/static: estas rutas usan reply.sendFile().
await app.register(pagesRoutes)
await app.register(adminRoutes)

// Cualquier ruta desconocida devuelve la app (SPA), salvo bajo /api.
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'No encontrado' })
  }
  return reply.code(404).type('text/html').sendFile('index.html')
})

app.setErrorHandler((err, req, reply) => {
  req.log.error(err)
  reply.code(500).send({ error: 'Error interno' })
})

/* ─── mantenimiento ─────────────────────────────────────────────────────────
   Va dentro del propio proceso y no en un timer de systemd aparte porque son
   dos consultas cada tanto, no un trabajo pesado: montar una unidad nueva en un
   servidor con 11 sitios en produccion es riesgo que no compensa.
   unref() para que estos temporizadores no impidan que el proceso termine. */

setInterval(() => volcarTrafico(app.log), 60000).unref()

const PURGA_CADA_MS = 6 * 3600000
const purga = async () => {
  try { await purgar(config.analytics.retencionDias, app.log) } catch (e) { app.log.warn(`purga: ${e.message}`) }
  try { await madurarSaldos(app.log) } catch (e) { app.log.warn(`referidos: cuarentena (${e.message})`) }
  try { await limpiarSesiones(app.log) } catch (e) { app.log.warn(`referidos: limpieza (${e.message})`) }
}

setTimeout(purga, 120000).unref()          // dos minutos despues de arrancar
setInterval(purga, PURGA_CADA_MS).unref()

// Al apagar, lo que quede en los contadores se guarda en vez de perderse.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.once(senal, async () => {
    try { await volcarTrafico(app.log) } catch { /* se cierra igual */ }
    await app.close()
    process.exit(0)
  })
}

await app.listen({ port: config.port, host: config.host })

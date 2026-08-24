import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { config, ROOT } from './config.js'
import apiRoutes from './routes/api.js'
import pagesRoutes from './routes/pages.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
})

await app.register(apiRoutes)

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

await app.listen({ port: config.port, host: config.host })

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
import { config, ROOT } from './config.js'
import apiRoutes from './routes/api.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
})

await app.register(apiRoutes)

await app.register(fastifyStatic, {
  root: join(ROOT, 'public'),
  index: ['index.html'],
  dotfiles: 'allow', // hace falta para servir /.well-known/assetlinks.json
  setHeaders(res, path) {
    if (path.endsWith('assetlinks.json')) {
      // Digital Asset Links exige application/json o la app de Play no valida.
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'public, max-age=3600')
    } else if (path.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache')
    } else if (/\.(png|svg|webp|woff2)$/.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=604800')
    }
  },
})

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

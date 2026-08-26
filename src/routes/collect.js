// Recogida de visitas: el unico endpoint que escribe analitica desde el cliente.
//
// Por que el conteo es del cliente y no del servidor: con el service worker
// instalado, una visita repetida se sirve desde la cache y NO llega a tocar el
// servidor. Contar en nginx o en un hook de Fastify perderia justo a los
// usuarios de la PWA y del APK, que son los mas fieles. Ver scripts/schema.sql.
//
// La ruta es corta a proposito (/api/v1/e): algunos bloqueadores de anuncios
// cazan por nombre y "analytics", "track" o "collect" estan en todas las listas.
// No es por esconderse de nadie -- los datos no salen del servidor y no hay
// terceros de por medio -- sino porque si no, la mitad del trafico no se cuenta.

import { registrar } from '../analytics/track.js'
import { pareceAdmin } from '../admin/auth.js'

export default async function collectRoutes(app) {
  // navigator.sendBeacon manda text/plain cuando se le pasa una cadena, y es la
  // unica forma de que el aviso salga cuando la pestana se esta cerrando.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, cuerpo, hecho) => {
    try {
      hecho(null, cuerpo ? JSON.parse(cuerpo) : {})
    } catch {
      hecho(null, {})   // basura entrando: se ignora, no se devuelve error
    }
  })

  // Handler sincrono a proposito: responde 204 y encola despues, sin que el
  // cliente espere por la escritura. Un async aqui haria que Fastify avisara de
  // "reply already sent" al terminar la promesa.
  app.post('/api/v1/e', (req, reply) => {
    reply.header('Cache-Control', 'no-store').code(204).send()

    try {
      // El trafico propio no cuenta: si no, mirar el panel infla las visitas.
      // Basta con ver si viene la cookie, sin validarla contra la base: esto
      // corre en CADA visita y no puede permitirse una consulta de mas.
      if (pareceAdmin(req)) return
      registrar(req, req.body, app.log)
    } catch (e) {
      app.log.warn(`analitica: ${e.message}`)
    }
  })
}

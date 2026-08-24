// Paginas sueltas que no forman parte de la app de una sola pagina.
//
// Van como rutas explicitas y no como archivos sueltos en public/ porque
// @fastify/static serviria /promo.html, no /promo, y el catch-all de server.js
// devolveria index.html para ambas. Este archivo se registra despues de
// @fastify/static, que es de donde sale reply.sendFile().
//
// Ojo con /promo: es lo unico del sitio que se deja enmarcar desde fuera. La
// cabecera que lo permite NO esta aqui sino en el vhost -- nginx añade
// X-Frame-Options: SAMEORIGIN a todo el server y un add_header desde Node no
// puede quitarselo. Ver el bloque `location = /promo` en
// deploy/nginx-dolarprice.conf.
export default async function pagesRoutes(app) {
  // Creativo que se embebe en el interstitial de verificavenezuela.org.
  app.get('/promo', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=120')
    return reply.type('text/html').sendFile('promo.html')
  })

  // Landing de la campaña: aqui es donde de verdad se instala la PWA, porque
  // beforeinstallprompt solo lo dispara Chrome en el propio dominio.
  app.get('/app', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300')
    return reply.type('text/html').sendFile('app.html')
  })
}

# DolarPrice — notas del proyecto

App de tasas del dólar en Venezuela. **dolarprice.com**, servida desde el VPS de Contabo.
Repo público: `DelvyG/dolarprice`.

Antes de tocar el servidor lee `F:\Archivos\INFRAESTRUCTURA-VPS.md`. Contabo tiene
**11 sitios más en producción**: todo cambio ahí debe ser aditivo y hay que verificar
los otros sitios después de cada paso. El estado de referencia de los 10 vhosts previos
está en ese documento, y el respaldo de `/etc/nginx` de antes de este proyecto en
`/root/dolarprice-baseline/`.

## Dónde vive

| | |
|---|---|
| Servidor | Contabo `158.220.110.201`, puerto 22 |
| Ruta | `/var/www/dolarprice` (checkout de git, dueño `dolarprice:dolarprice`) |
| Runtime | Node 22 + Fastify en `127.0.0.1:3200` |
| Servicios | `dolarprice.service` · `dolarprice-ingest.timer` (cada 10 min) |
| Base | MariaDB `dolarprice`, credenciales en `/root/.dolarprice-db-credentials` |
| vhost | `/etc/nginx/sites-available/dolarprice.com` |
| Despliegue | `/usr/local/bin/dolarprice-deploy`, lo invoca GitHub Actions |

## Trampas de este proyecto

**El BCV manda un intermedio TLS equivocado.** Su certificado lo emitió *Sectigo Public
Server Authentication CA DV R36* pero el servidor envía el de *Sectigo RSA DV*. En un
Ubuntu limpio eso falla con `unable to get local issuer certificate`, y desde el navegador
en Windows funciona — así que es fácil perder rato creyendo que es un bloqueo geográfico.
No lo es, y **no se arregla desactivando la verificación**: el intermedio correcto está en
`certs/sectigo-dv-r36.pem` y se inyecta en el almacén de confianza en `src/http.js`.
Si algún día el BCV arregla su cadena, esto sigue funcionando igual.

**Binance sí es alcanzable desde Contabo**, sin proxy ni nada. Se probó.

**Al cambiar `styles.css` o `app.js` hay que subir el `?v=N`** en tres lugares:
`public/index.html`, la lista `SHELL` de `public/sw.js` y la constante `VERSION` de ese
mismo archivo. Si no, los usuarios con el service worker instalado se quedan con la
versión vieja.

**`sw.js` se sirve con `no-store`** desde el vhost. Es a propósito.

**`/.well-known/assetlinks.json` tiene que salir como `application/json`.** Hay una
`location` dedicada en el vhost. Si se sirve como HTML, la app de Google Play
(`com.dolarprice.twa`) deja de validar Digital Asset Links y abre con la barra del
navegador visible. Era uno de los fallos de la versión anterior.

**nginx 1.24 no acepta `http2 on;`** — va `listen 443 ssl http2;`.

## Desarrollo en local

El `.env` local apunta a la base de producción **a través de un túnel SSH** (por eso
`DB_PORT=3307`). Para levantarlo:

```bash
ssh -i ~/.ssh/id_ed25519 -N -L 3307:127.0.0.1:3306 root@158.220.110.201 &
node src/server.js
```

`npm run ingest:dry` prueba las dos fuentes sin escribir en la base. Es lo primero que
hay que correr si se sospecha que el BCV cambió su HTML.

## Cosas que quedaron fuera a propósito

- **No hay panel de administración.** El de la versión anterior sembraba el usuario
  `admin@dolarprice.com` con la contraseña `password`, tenía el correo quemado en el
  código y no tenía CSRF ni límite de intentos. Los ajustes que ofrecía (horas de
  captura, cantidad de anuncios) hoy son variables del `.env`. Si se vuelve a querer un
  panel, hay que hacerlo de cero.
- **No se migró el histórico viejo.** Eran tasas de hace meses y además equivocadas.
- **No se tocó el paquete de Google Play.** Sigue sirviendo el mismo `com.dolarprice.twa`
  ya firmado; el keystore está en `F:\Archivos\Proyecto Cambios\DolarPrice - Google Play
  package`. Al mantener el dominio y arreglar `assetlinks.json`, la app existente empieza
  a funcionar a pantalla completa sin publicar una versión nueva.

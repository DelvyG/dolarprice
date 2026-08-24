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
| Servicios | `dolarprice.service` · `dolarprice-ingest.timer` (10 min) · `dolarprice-news.timer` (20 min) |
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

**Las noticias salen de la base de verificavenezuela.org, no de una API.** Ese proyecto
(Laravel + PostgreSQL, `/var/www/verificavenezuela`) no expone endpoint de noticias. Se
creó el rol `dolarprice_ro` con `SELECT` solo sobre `news`, `media` y `categories`;
credenciales en `/root/.dolarprice-vv-credentials`. **No hay que desplegar ni modificar
verificavenezuela para nada de esto.** El riesgo es el acoplamiento al esquema ajeno: si
cambian esas tablas, `src/sources/noticias.js` deja de leer — pero la pestaña sigue
mostrando la última copia de `news_cache` y solo queda vieja, no rota. Para diagnosticar:
`node src/ingest-news.js --dry-run`.

Las portadas son de Spatie MediaLibrary. La ruta útil es
`/storage/media/{media_id}/conversions/{nombre-sin-extension}-thumb.webp` (13 KB); el
original del mismo directorio pesa unos 270 KB. Algunas conversiones faltan en disco aunque
`generated_conversions` diga que existen, por eso la lista tiene respaldo ante `error` de
la imagen.

**Al cambiar `styles.css` o `app.js` hay que subir el `?v=N`** en tres lugares:
`public/index.html`, la lista `SHELL` de `public/sw.js` y la constante `VERSION` de ese
mismo archivo. Si no, los usuarios con el service worker instalado se quedan con la
versión vieja.

**`sw.js` se sirve con `no-store`** desde el vhost. Es a propósito.

**`/promo` es lo único enmarcable del sitio.** Es el creativo que verificavenezuela.org
mete en un iframe dentro de su interstitial. El server manda
`X-Frame-Options: SAMEORIGIN` a todo, y desde Node **no se puede quitar** esa cabecera
porque la añade nginx. Por eso hay un `location = /promo` en el vhost que repite las otras
cabeceras de seguridad y cambia el candado por
`Content-Security-Policy: frame-ancestors`, que sí sabe de orígenes concretos
(`X-Frame-Options: ALLOW-FROM` está muerto y ningún navegador lo respeta). Un `add_header`
dentro de un `location` **cancela todos los heredados**: de ahí que haya que repetirlos.
Si algún día se enmarca desde otro dominio, se añade a esa lista y no en otro sitio.

**`/promo` y `/app` son rutas explícitas, no archivos sueltos.** Viven en
`src/routes/pages.js`, registrado *después* de `@fastify/static` porque usan
`reply.sendFile()`. Si se dejaran como `public/promo.html` a secas, la URL sería
`/promo.html` y `/promo` caería en el catch-all que devuelve `index.html`.
Las dos páginas llevan su CSS y su JS embebidos a propósito: así cambiar el creativo no
obliga a subir el `?v=N` en los tres sitios de siempre. `/app` sí carga el manifest y
registra `sw.js`, porque sin eso Chrome no dispara `beforeinstallprompt`.

**Desde otro sitio no se puede instalar esta PWA.** `beforeinstallprompt` solo lo dispara
el navegador en el propio dominio: no existe API para que una web instale la app de otra.
Por eso el anuncio de Verifica Venezuela solo puede *llevar* a `/app`, y es ahí donde
aparece el botón. En iPhone ni siquiera ahí hay prompt — Safari obliga al gesto manual de
Compartir → Añadir a pantalla de inicio, y la landing lo explica.

**`/.well-known/assetlinks.json` tiene que salir como `application/json`.** Hay una
`location` dedicada en el vhost. Si se sirve como HTML, la app de Google Play
(`com.dolarprice.twa`) deja de validar Digital Asset Links y abre con la barra del
navegador visible. Era uno de los fallos de la versión anterior.

**nginx 1.24 no acepta `http2 on;`** — va `listen 443 ssl http2;`.

**El APK no está en el repo.** Vive en `public/descargas/DolarPrice.apk` del servidor y
está en `.gitignore` por ser un binario de 1 MB. `git reset --hard` no lo borra porque
está ignorado, así que sobrevive a los despliegues — **pero un servidor nuevo no lo
tendría**: hay que volver a subirlo desde
`F:\Archivos\Proyecto Cambios\DolarPrice - Google Play package\DolarPrice.apk`.
Se sirve como `application/octet-stream`, que basta para que el navegador lo descargue.

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
- **No se tocó el paquete de Android.** Es una **TWA** hecha con PWABuilder (contiene
  `TrustedWebActivity` y `androidbrowserhelper`, apunta a `https://dolarprice.com`), no un
  WebView: corre el motor real de Chrome, así que hereda el service worker y el offline.
  El keystore está en `F:\Archivos\Proyecto Cambios\DolarPrice - Google Play package`.
  **No está publicada en Google Play** — la ficha de `com.dolarprice.twa` da 404. Se
  distribuye descargando el APK desde el propio sitio. Al arreglar `assetlinks.json` la
  TWA valida Digital Asset Links y abre a pantalla completa, sin la barra del navegador,
  también instalada a mano.

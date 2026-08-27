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

- **No hay panel de *ajustes*.** El de la versión anterior sembraba el usuario
  `admin@dolarprice.com` con la contraseña `password`, tenía el correo quemado en el
  código y no tenía CSRF ni límite de intentos. Los ajustes que ofrecía (horas de
  captura, cantidad de anuncios) hoy son variables del `.env` y ahí se quedan.
  Lo que sí existe, desde el 26/08/2026, es un panel de **estadísticas** hecho de
  cero y de solo lectura. Ver el apartado siguiente.
- **No se migró el histórico viejo.** Eran tasas de hace meses y además equivocadas.
- **No se tocó el paquete de Android.** Es una **TWA** hecha con PWABuilder (contiene
  `TrustedWebActivity` y `androidbrowserhelper`, apunta a `https://dolarprice.com`), no un
  WebView: corre el motor real de Chrome, así que hereda el service worker y el offline.
  El keystore está en `F:\Archivos\Proyecto Cambios\DolarPrice - Google Play package`.
  **No está publicada en Google Play** — la ficha de `com.dolarprice.twa` da 404. Se
  distribuye descargando el APK desde el propio sitio. Al arreglar `assetlinks.json` la
  TWA valida Digital Asset Links y abre a pantalla completa, sin la barra del navegador,
  también instalada a mano.

## Panel de estadísticas (`/admin`)

Analítica propia, sin Google Analytics ni ningún tercero: los datos no salen del
servidor. Se descartaron Umami (no muestra IPs ni visitantes individuales, y era otro
servicio más en un VPS con 11 sitios) y Matomo (PHP pesado, otro vhost, otra base que
mantener parcheada).

**No hace falta tocar nginx para nada de esto.** `/admin` cae en `location /` →
`try_files` → `@app` y `/api/admin/` cae en `location /api/`. Los dos llegan a Node
tal cual. Es la razón principal por la que se hizo así.

### Lo que de verdad hay que saber

**Las visitas se cuentan desde el cliente, no desde el servidor.** Con el service
worker instalado, una visita repetida se sirve desde la caché y **no llega a tocar el
servidor**: contar en un hook de Fastify o leyendo el log de nginx perdería justo a
los usuarios de la PWA y del APK, que son los más fieles. Por eso hay un beacon en
`public/app.js` que golpea `POST /api/v1/e`. La ruta es corta a propósito: los
bloqueadores de anuncios cazan por nombre y `analytics`, `track` y `collect` están en
todas las listas.

**El service worker deja pasar `/admin` y `/api/admin/` sin tocarlos.** Si no, las
cifras del sitio quedarían guardadas en el disco de cualquiera que abra el panel, y
además mostraría números viejos sin avisar. Está al principio del handler de `fetch`
en `sw.js` — no quitarlo.

**Distinguir APK / PWA / navegador sale del referente.** Al lanzar la TWA, Android
pone `document.referrer` en `android-app://com.dolarprice.twa`. Eso no lo puede fingir
un navegador y es lo único fiable: el User-Agent de la TWA es idéntico al de Chrome
normal, porque *es* Chrome. Solo aparece en la primera navegación de la sesión, así
que en cuanto se ve una vez se guarda en `localStorage` y ya no se pierde.
`getInstalledRelatedApps()` responde además si quien entra por navegador ya tiene el
APK instalado — pero **solo en Chrome sobre Android**; en el resto llega `null`, que
significa "no se sabe", no "no lo tiene". Por eso el panel muestra el denominador.

**Las descargas del APK sí se cuentan del lado del servidor**, en el hook `onResponse`
de `server.js`: bajarse un fichero no ejecuta JavaScript y no hay beacon que valga.
Chrome en Android pide el fichero por trozos y responde **206**, no 200 — de ahí que se
acepten los dos códigos. Una misma descarga puede generar varias filas, por eso el
panel enseña IPs distintas y no filas.

**Zona horaria.** En la base todo se guarda en UTC. El panel agrupa por día y por hora
en hora de Venezuela (UTC−4, sin horario de verano) pasando cada columna por `local()`
en `src/analytics/queries.js`. Sin eso, cada día del gráfico llevaría las cuatro
primeras horas del día siguiente — que es el mismo fallo que ya hubo una vez en la
fecha de las noticias. **Todo agrupamiento por fecha tiene que pasar por `local()`.**

**La IP real ya viene resuelta.** El vhost trae `real_ip_header CF-Connecting-IP` con
los rangos de Cloudflare en `set_real_ip_from`, así que `$remote_addr` en nginx ya es
la del visitante. Se lee `X-Real-IP` (un solo valor, que pone nuestro nginx) y no
`X-Forwarded-For`, que es una lista y la puede falsificar el cliente.

**La geolocalización es un fichero en disco, no una API.** `data/dbip-city-lite.mmdb`,
unos 124 MB, de DB-IP (licencia CC BY 4.0 — la atribución está al pie del panel, no
quitarla). Se eligió DB-IP y no GeoLite2 porque MaxMind exige cuenta y clave de
licencia para cada descarga. **No está en el repo** y está en `.gitignore`, así que
sobrevive al `git reset --hard` del despliegue igual que el APK — **pero un servidor
nuevo no lo tendría**: hay que correr `npm run geoip`. Sin el fichero nada se rompe;
se cae en la cabecera `CF-IPCountry`, que da el país pero no la ciudad. Conviene
rebajarlo una vez al mes.

**La analítica nunca puede tumbar el sitio.** El beacon responde 204 *antes* de tocar
la base, la cola de escritura tiene tope (si MariaDB se pone lenta se pierden visitas,
que es mejor que acumular memoria hasta morir), y todos los fallos se tragan con un
`log.warn`.

### Entrar

Se entra con **correo y contraseña**. Los dos viven en la tabla `admin_config`, no en el
`.env`, para poder cambiarlos desde la pestaña **Cuenta** del propio panel sin entrar por
SSH ni reiniciar el servicio. El `.env` sigue sirviendo de arranque: mientras esa tabla
esté vacía manda `ADMIN_PASS_HASH`, y en cuanto se cambia algo desde el panel manda la
tabla. El correo por defecto es `digitalgroup21@gmail.com`.

Para el arranque en un servidor nuevo, o si se pierde el acceso:

```bash
cd /var/www/dolarprice && npm run admin:pass     # pide la contraseña, escupe 2 líneas
# pegar ADMIN_PASS_HASH y ADMIN_SESSION_SECRET en .env
systemctl restart dolarprice
```

**Ojo:** si ya se cambió la contraseña desde el panel, tocar `ADMIN_PASS_HASH` no sirve
de nada — manda la fila `pass_hash` de `admin_config`. Para volver al `.env` hay que
borrarla: `DELETE FROM admin_config WHERE clave = 'pass_hash'`.

Cambiar `ADMIN_SESSION_SECRET` cierra todas las sesiones abiertas; para cambiar solo la
contraseña, dejar el secret que ya estaba. Seis fallos por IP en quince minutos y se
cierra la puerta. La cookie va `HttpOnly`, `Secure`, `SameSite=Strict` y firmada con
HMAC además de guardada en tabla, y en la base solo vive el sha256 del token.

Cambiar la contraseña desde el panel exige la actual y confirmarla, y **cierra las demás
sesiones abiertas menos la propia**: si alguien más la tenía abierta, cambiar la clave no
serviría de nada mientras siguiera dentro.

Sin contraseña configurada el panel existe pero no deja entrar a nadie. Es a propósito: un
despliegue en un servidor nuevo no puede quedar abierto mientras alguien se acuerda de
ponerle contraseña.

Al equivocarse, el mensaje es el mismo tanto si falla el correo como si falla la clave, y
la contraseña se verifica igual aunque el correo ya haya fallado — si no, el tiempo de
respuesta delataría cuál de los dos estaba mal.

### Ojo con el diseño

El panel tiene **dos formatos, no uno estirado**: barra lateral a partir de 960 px y barra
de pestañas abajo por debajo. La primera versión servía la interfaz de teléfono estirada a
1900 px y quedaba fatal — tarjetas enormes vacías y emojis por iconos.

Los gráficos **calculan su `viewBox` con el ancho real en píxeles**. No usar
`preserveAspectRatio="none"` con una caja fija: en un monitor ancho deforma hasta las
letras. Como el ancho depende de la ventana, hay que llamar a `redibujar()` al
redimensionar **y al cambiar de pestaña** — un SVG dentro de una `section[hidden]` mide
0 px y saldría vacío.

### Tablas y retención

`visits` (evento por evento), `visitors` (una fila por persona), `traffic_daily`
(contadores brutos volcados desde memoria cada minuto), `apk_downloads`,
`admin_sessions` y `admin_logins`. Se purgan las visitas de más de
`ANALYTICS_RETENCION_DIAS` (180 por defecto) cada 6 horas desde el propio proceso —
sin timer de systemd nuevo: son dos consultas, y montar una unidad más en un servidor
con 11 sitios en producción es riesgo que no compensa. **`visitors` no se purga
nunca**: ahí vive el "desde cuándo nos visita", que es lo único que no se puede
recuperar.

### Ojo al tocar el panel

`public/admin.html` lleva su CSS y su JS embebidos, igual que `/promo` y `/app`: así
cambiarlo **no** obliga a subir el `?v=N` en los tres sitios de siempre. Si en cambio
se toca `public/app.js` (donde vive el beacon), sí hay que subirlo en `index.html`, en
la lista `SHELL` de `sw.js` y en la constante `VERSION` de ese mismo archivo.

## Trampas del despliegue (aprendidas el 26/08/2026)

**No lanzar `gh workflow run` después de un `git push`.** El push ya dispara el
workflow; lanzar además el manual hace correr dos despliegues a la vez sobre el mismo
checkout y el segundo muere con
`cannot lock ref 'refs/remotes/origin/main'`. Es inofensivo —falla en el `git fetch`,
antes de tocar dependencias— pero deja un run en rojo que parece un problema y no lo es.

Ojo: **a veces el push no dispara nada**. Pasó una vez ese mismo día: el commit llegó al
repo, Actions estaba activo y el workflow en estado `active`, pero no se creó ningún run.
Ahí sí toca `gh workflow run deploy.yml --ref main`, que el workflow acepta porque tiene
`workflow_dispatch`. La regla práctica: hacer el push, **mirar si apareció el run**, y
solo lanzarlo a mano si no apareció.

**`npm ci` borra `node_modules` antes de reinstalar.** Si falla a medias lo deja vacío y
el servicio sigue vivo *solo* porque Node ya tiene los módulos en memoria: el sitio se cae
en el siguiente reinicio, horas después y sin relación aparente. Pasó una vez. El script
de despliegue ya reintenta y **comprueba que los módulos cargan antes de reiniciar**, pero
si alguna vez se ve `node_modules` vacío con el servicio `active`, eso es una bomba de
relojería — arreglarlo antes de reiniciar nada:

```bash
cd /var/www/dolarprice && sudo -u dolarprice npm ci --omit=dev
```

## Programa de referidos (`/api/v1/cuenta`, `/api/v1/ref`, pestaña Referidos de `/admin`)

Encendido el 27/08/2026. El usuario comparte su código, gana dinero real cuando sus
referidos usan la app, y cobra por Binance. Los montos y las reglas se editan desde el
panel, no desde el `.env`: lo que se paga es justo lo que hay que poder subir o bajar en
caliente. Al cierre: **$0,20 por referido, mínimo $10 para retirar, tope $100/mes.**

### Las dos decisiones que explican todo el diseño

**Un referido NO cuenta por instalar, sino por usar la app N días DISTINTOS** (3 por
defecto), y después el saldo pasa una cuarentena (7 días) antes de poder retirarse. Aquí
sale dinero real y pagar por instalación se farmea: levantar mil instalaciones falsas es
barato, mantenerlas abriendo la app tres días no lo es. La cuarentena es la ventana para
cazar el fraude **antes** de pagarlo. No cambiar esto por "es que así ven su premio
antes".

**La cuenta es de la PERSONA, no del aparato.** La primera versión ató el saldo al
`visitor_id` del navegador y se cae sola: quien cambiara de teléfono o quisiera mirar sus
ganancias desde la PC perdería el dinero. De ahí `ref_users` (la cuenta) + `ref_devices`
(los navegadores enlazados). Para consultar el dólar **no** hay que registrarse; solo
para cobrar.

### Cómo se atribuye una instalación del APK

Sale gratis de que el APK sea una **TWA** y no un WebView: corre Chrome de verdad, así
que **comparte cookies y `localStorage` con el navegador** para dolarprice.com. Alguien
abre `dolarprice.com/app?ref=CODIGO` en Chrome, instala el APK, lo abre — y el código
sigue en `localStorage`, así que el beacon lo manda igual. **No hace falta ningún sistema
de atribución de instalaciones.** Queda pendiente confirmarlo en un teléfono real.

### Trampas ya pisadas

**El código de referido viaja en el beacon** (`/api/v1/e`), no en una ruta aparte: el
beacon es lo único que llega en CADA visita, que es justo lo que hace falta para contar
los días de actividad.

**`atribuir()` y `marcarDia()` van encadenados, no en paralelo.** Lanzarlos a la vez era
una carrera: en la primera visita se intentaba contar el día antes de que la relación
existiera, así que ese día se perdía y hacían falta cuatro días para lo que debían ser
tres. Ya pasó una vez.

**Al rechazar un retiro hay que DEVOLVER el saldo.** Se descuenta al pedirlo (en la misma
sentencia que comprueba que alcanza, con `WHERE saldo_libre >= ?`, para que dos
peticiones simultáneas no cobren dos veces). Si al rechazar no se devolviera, el dinero
del usuario se quedaría en el limbo.

**Descartar un marcado lo cierra como `validado = 1, madurado = 1, recompensa = 0.**
Parece raro pero es lo que lo saca de la lista de pendientes sin pagar nada. Si solo se
cambiara el texto de `sospechoso`, seguiría apareciendo para siempre.

**`numero()` en `src/admin/ajustes.js` comprueba null ANTES de `Number()`.** `Number(null)`
es `0` y `0` sí es finito: comprobar solo `isFinite()` hacía que una clave inexistente
devolviera 0 en vez de su valor por defecto — o sea, **pagar cero a todo el mundo**.

### Antifraude

Un aparato se refiere una sola vez en la vida (PK de `referrals`). Autorreferido
bloqueado vía `ref_devices`. Más de N referidos desde la misma IP se **marca**, no se
descarta —una familia comparte wifi— y no se paga sin aprobarlo a mano. Tope diario por
referidor y **tope mensual global**: al llegar se deja de validar, no de contar, así que
al subir el tope o al entrar el mes siguiente esos referidos se validan solos.

### Pagos

**Se pagan a mano.** El botón "Pagado" del panel NO envía dinero: lo anota y avisa al
usuario por correo. Automatizarlo exigiría claves de Binance **con permiso de retiro** en
un VPS compartido con sitios de clientes; si esa máquina se compromete, se van los fondos.
No hacerlo.

### Correo

Resend, dominio `dolarprice.com` verificado. `src/correo.js` soporta además Brevo y SMTP
y elige solo según qué variable haya en el `.env`. El remitente es `noreply@` pero lleva
**Reply-To** a una dirección real: aquí se mueve dinero y una respuesta de "no me llegó el
pago" no puede caer en un buzón que nadie lee. Si no hay proveedor configurado, el
registro **sigue funcionando**: que no se pueda mandar un correo no puede dejar a nadie
fuera.

### Al tocar la interfaz

La tarjeta vive en Inicio, junto al botón de compartir, y **no** como quinta pestaña:
cinco iconos en la barra de abajo se aprietan demasiado en pantalla pequeña. Está en
`public/index.html` + `app.js` + `styles.css`, así que **cualquier cambio obliga a subir
el `?v=N` en los tres sitios de siempre** (index.html, la lista `SHELL` de sw.js y su
constante `VERSION`).

**Ojo con `String.replace()` al editar estos ficheros con scripts:** en la cadena de
reemplazo, `$'` y `$&` tienen significado propio y se comen el texto. Un `const usd = (v)
=> '$' + ...` corrompió `admin.html` entero por esto. Usar siempre una **función** de
reemplazo.

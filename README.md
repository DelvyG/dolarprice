# DolarPrice

Precio del dólar **BCV** y del **paralelo (Binance P2P)** en Venezuela, con conversor
e histórico. Aplicación web instalable (PWA), en producción en
[dolarprice.com](https://dolarprice.com).

Sin framework de frontend: el bundle completo son unos 12 KB (6,7 KB comprimido),
así que abre al instante incluso en una conexión móvil mala.

---

## Cómo se calcula cada tasa

### Dólar BCV

Se lee del portal de tasas informativas del Banco Central de Venezuela:
`https://www.bcv.org.ve/tasas-informativas-sistema-bancario`. De ahí salen USD, EUR,
CNY, TRY y RUB, más la *fecha valor* que publica el propio BCV.

> **Detalle importante del BCV.** Su servidor entrega una cadena de certificados
> incompleta: el certificado de `*.bcv.org.ve` lo emitió *Sectigo Public Server
> Authentication CA DV R36*, pero el servidor envía como intermedio el de *Sectigo
> RSA Domain Validation Secure Server CA*. Resultado: la verificación TLS falla con
> `unable to get local issuer certificate` en cualquier máquina cuyo almacén no
> tenga ese intermedio suelto — que es el caso de un Ubuntu limpio.
>
> La salida fácil es desactivar la verificación TLS. Aquí **no** se hace eso: el
> intermedio correcto vive en `certs/sectigo-dv-r36.pem` y se añade al almacén de
> confianza solo para estas peticiones (`src/http.js`). La validación sigue activa.

### Paralelo (Binance P2P)

Se piden los 20 anuncios más competitivos de USDT/VES a la API pública del P2P, por
los dos lados del libro (`BUY` y `SELL`), y se promedia cada lado con un **promedio
recortado al 10 %**: se ordenan los 20 precios, se descartan los 2 más altos y los 2
más bajos, y se promedian los 16 del centro. El precio que se muestra es el punto
medio entre ambos lados.

El recorte no es un lujo. En el P2P venezolano aparecen constantemente anuncios
atípicos: en una lectura real, el lado `SELL` traía `980` y `933` cuando el mercado
estaba en `918`. Un promedio simple de los 20 se iba unos 5 Bs por encima del precio
al que de verdad se puede operar. El porcentaje de recorte se ajusta con
`BINANCE_TRIM_PCT` (poner `0` da el promedio simple de los 20).

### Nunca se inventa una tasa

Si una fuente falla, **no** se sustituye por un valor por defecto ni se deja el último
valor pasando por actual. Se conserva el último dato conocido, la API informa su
antigüedad en `edadSegundos` y marca `desactualizado: true` pasado el umbral
(`STALE_AFTER_SECONDS`, 45 min por defecto). La interfaz muestra entonces un aviso
visible. Un número viejo sin avisar es peor que no tener número.

---

## Arquitectura

```
┌──────────┐   systemd timer (10 min)   ┌──────────────┐
│   BCV    │◄───────────────────────────│              │
├──────────┤                            │  ingest.js   │──► MariaDB
│ Binance  │◄───────────────────────────│              │
└──────────┘                            └──────────────┘
                                                │
   navegador ──► nginx ──┬── estáticos (disco)  │
                         └── /api/* ──► Fastify ┘
```

La captura de datos y el servidor web son **procesos separados**. Una petición del
usuario nunca dispara un scraping: si la fuente está caída o lenta, la web sigue
respondiendo igual de rápido.

### Base de datos

| Tabla | Para qué |
|---|---|
| `rates_current` | Última tasa por moneda y fuente. Es la que lee la API. |
| `rates_history` | Solo se inserta cuando el valor **cambia**, así el gráfico no se llena de puntos repetidos. |
| `ingest_runs` | Bitácora de cada corrida, para ver si una fuente lleva rato fallando. |

---

## API pública

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/v1/rates` | Todas las tasas actuales, la brecha y la antigüedad del dato. |
| `GET /api/v1/history?code=USD&days=30` | Un punto por día. `code` acepta `USD`, `EUR`, `CNY`, `TRY`, `RUB` y `USDT`. |
| `GET /api/v1/health` | Cuántas tasas hay cargadas y las últimas corridas del capturador. |

```jsonc
// GET /api/v1/rates
{
  "bcv": {
    "monedas": { "USD": 784.6633, "EUR": 916.00808978, "CNY": 116.75668477, "TRY": 16.32674365, "RUB": 9.48718559 },
    "fechaValor": "2026-08-24",
    "consultado": "2026-08-24T04:37:40.000Z",
    "disponible": true
  },
  "binance": { "promedio": 919.7616, "compra": 921.5436, "venta": 917.9796, "disponible": true },
  "brecha": { "absoluta": 135.0983, "porcentaje": 17.22 },
  "edadSegundos": 2,
  "desactualizado": false
}
```

---

## Correr en local

Hace falta Node 22 o superior y un MariaDB/MySQL.

```bash
npm install
cp .env.example .env        # y poner los datos de la base
mysql tu_base < scripts/schema.sql

npm run ingest:dry          # prueba las dos fuentes sin escribir nada
npm run ingest              # captura de verdad
npm start                   # http://127.0.0.1:3200
```

`npm run ingest:dry` es la forma rápida de comprobar si el BCV cambió su HTML: no
toca la base y muestra en pantalla lo que leyó de cada fuente.

---

## Despliegue

En producción corre sobre nginx + systemd. Los archivos de referencia están en
`deploy/`:

| Archivo | Destino |
|---|---|
| `deploy/nginx-dolarprice.conf` | `/etc/nginx/sites-available/dolarprice.com` |
| `deploy/dolarprice.service` | Servicio del web (Fastify) |
| `deploy/dolarprice-ingest.service` + `.timer` | Captura cada 10 minutos |
| `deploy/dolarprice-deploy` | `/usr/local/bin/dolarprice-deploy`, lo invoca GitHub Actions |

Notas de operación:

- **nginx 1.24 no acepta `http2 on;`.** Va `listen 443 ssl http2;`.
- El service worker se sirve con `no-store`. Sin eso, un usuario se queda clavado en
  una versión vieja de la app para siempre.
- Al cambiar `styles.css` o `app.js` hay que subir el `?v=N` en `index.html`, en la
  lista `SHELL` de `sw.js` y la constante `VERSION` del propio `sw.js`.
- El servicio corre como el usuario `dolarprice`, sin privilegios, con
  `ProtectSystem=strict`.

### Aplicación de Android

La app publicada en Google Play es una TWA (`com.dolarprice.twa`) que envuelve este
mismo sitio. Para que arranque a pantalla completa en vez de mostrar la barra del
navegador, `/.well-known/assetlinks.json` tiene que servirse con
`Content-Type: application/json`. Si se sirve como HTML, Digital Asset Links no valida
y la app se ve como un navegador con marco. Hay una `location` en el vhost dedicada
justo a eso.

---

## Licencia

MIT. Ver [LICENSE](LICENSE).

Los datos provienen del Banco Central de Venezuela y de la API pública del P2P de
Binance. Este proyecto no está afiliado a ninguno de los dos.

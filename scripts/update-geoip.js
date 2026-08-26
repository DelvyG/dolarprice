// Descarga la base de geolocalizacion DB-IP City Lite del mes en curso.
//
// Se eligio DB-IP y no GeoLite2 de MaxMind porque MaxMind exige crear una cuenta
// y una clave de licencia para cada descarga; DB-IP publica el fichero abierto.
// Licencia CC BY 4.0: la atribucion esta al pie del panel, no quitarla.
//
// El .mmdb NO va en el repo (unos 90 MB). Vive en data/ y esta en .gitignore,
// asi que sobrevive al `git reset --hard` del despliegue igual que el APK.
//
//   node scripts/update-geoip.js          descarga si falta o si cambio el mes
//   node scripts/update-geoip.js --force  descarga siempre
//
// Conviene correrlo una vez al mes. Sin el fichero la app no se rompe: cae en la
// cabecera CF-IPCountry de Cloudflare, que da el pais pero no la ciudad.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { ROOT } from '../src/config.js'
import { DESTINO_MMDB } from '../src/analytics/geo.js'

const forzar = process.argv.includes('--force')
const ahora = new Date()

// Al principio de mes el fichero del mes en curso puede no estar publicado
// todavia: se intenta ese y, si da 404, el anterior.
const meses = [0, 1].map((atras) => {
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - atras, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
})

if (!forzar && existsSync(DESTINO_MMDB)) {
  const edadDias = (Date.now() - statSync(DESTINO_MMDB).mtimeMs) / 86400000
  if (edadDias < 25) {
    console.log(`La base ya esta al dia (${edadDias.toFixed(0)} dias). Usa --force para bajarla igual.`)
    process.exit(0)
  }
}

mkdirSync(join(ROOT, 'data'), { recursive: true })
const temporal = `${DESTINO_MMDB}.parcial`

let bajado = false
for (const mes of meses) {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${mes}.mmdb.gz`
  process.stdout.write(`Probando ${mes}... `)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) { console.log(`no disponible (${res.status})`); continue }

  // Se escribe a un temporal y se renombra al final: si la descarga se corta,
  // el fichero bueno que ya estaba en disco sigue intacto.
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(temporal))
  renameSync(temporal, DESTINO_MMDB)
  const mb = (statSync(DESTINO_MMDB).size / 1048576).toFixed(1)
  console.log(`listo. ${mb} MB en ${DESTINO_MMDB}`)
  bajado = true
  break
}

if (!bajado) {
  if (existsSync(temporal)) unlinkSync(temporal)
  console.error('No se pudo descargar ninguna de las dos versiones. Se sigue con CF-IPCountry.')
  process.exit(1)
}

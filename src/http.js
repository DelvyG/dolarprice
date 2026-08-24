import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.js'

// El servidor del BCV presenta una cadena incompleta: su certificado lo emitio
// "Sectigo Public Server Authentication CA DV R36" pero envia como intermedio el
// de "Sectigo RSA DV", asi que la verificacion falla con "unable to get local
// issuer certificate". En vez de desactivar la verificacion TLS -que es lo que
// hacia la version anterior- agregamos el intermedio correcto al almacen de
// confianza solo para estas peticiones. La validacion sigue activa.
const extraCA = readFileSync(join(ROOT, 'certs', 'sectigo-dv-r36.pem'), 'utf8')
const caBundle = [...tls.rootCertificates, extraCA]

const decompress = (buf, encoding) => {
  if (encoding === 'gzip') return zlib.gunzipSync(buf)
  if (encoding === 'deflate') return zlib.inflateSync(buf)
  if (encoding === 'br') return zlib.brotliDecompressSync(buf)
  return buf
}

export function request(url, { method = 'GET', headers = {}, body = null, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        ca: caBundle,
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept-Language': 'es-VE,es;q=0.9',
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(request(new URL(res.headers.location, url).href, { method, headers, body, timeout }))
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} en ${url}`))
          }
          try {
            const raw = decompress(Buffer.concat(chunks), res.headers['content-encoding'])
            resolve(raw.toString('utf8'))
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`Tiempo agotado (${timeout}ms) en ${url}`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

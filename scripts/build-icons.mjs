// Genera los iconos de la PWA a partir del logo original.
// Se corre a mano cuando cambia la marca: node scripts/build-icons.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = process.argv[2] || 'F:/TODO/RESPALDO-PC-DELVY-2024/Varios/DolarPrice/logo-dolarprice.png'
const SALIDA = join(ROOT, 'public', 'icons')
mkdirSync(SALIDA, { recursive: true })

const out = (n) => join(SALIDA, n)

// Iconos "any": el logo tal cual, que ya viene con su propio margen.
for (const size of [96, 128, 180, 192, 256, 384, 512]) {
  await sharp(ORIGEN).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 }).toFile(out(`icon-${size}.png`))
}

// Icono "maskable": Android le recorta hasta un 20% por lado, asi que el logo
// va al 62% sobre fondo verde a sangre para que nunca se corte la marca.
for (const size of [192, 512]) {
  const interno = Math.round(size * 0.62)
  const logo = await sharp(ORIGEN).resize(interno, interno, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 21, g: 128, b: 61, alpha: 1 } } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 }).toFile(out(`maskable-${size}.png`))
}

// Favicon pequeno
await sharp(ORIGEN).resize(32, 32).png({ compressionLevel: 9 }).toFile(out('favicon-32.png'))

console.log('Iconos generados en public/icons')

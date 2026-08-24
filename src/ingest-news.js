// Sincroniza las noticias de verificavenezuela.org a la base de DolarPrice.
// Va aparte del capturador de tasas a proposito: si las noticias fallan, las
// tasas no se enteran, y al reves.
import { fetchNoticias } from './sources/noticias.js'
import { query, registrarCorrida, ahora, closePool } from './db.js'

const DRY = process.argv.includes('--dry-run')
const CUANTAS = 60

const log = (...args) => console.log(new Date().toISOString(), ...args)

// Formato DATETIME de MySQL, en UTC.
const fecha = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : null)

async function main() {
  const inicio = Date.now()

  let noticias
  try {
    noticias = await fetchNoticias(CUANTAS)
    log(`[NOTICIAS] leidas ${noticias.length} de verificavenezuela`)
  } catch (err) {
    log(`[NOTICIAS] FALLO: ${err.message}`)
    // No se borra nada: la copia anterior sigue sirviendo.
    if (!DRY) await registrarCorrida('NOTICIAS', false, err.message, Date.now() - inicio).catch(() => {})
    if (!DRY) await closePool()
    process.exitCode = 1
    return
  }

  if (DRY) {
    for (const n of noticias.slice(0, 5)) {
      log(`  [${n.veredicto}] ${n.titulo.slice(0, 70)}`)
      log(`     ${n.categoria ?? 'sin categoria'} · ${n.imagen ? 'con portada' : 'SIN PORTADA'} · ${n.url}`)
    }
    log(`  (${noticias.length} en total; sin escribir por --dry-run)`)
    return
  }

  const t = ahora()
  for (const n of noticias) {
    await query(
      `INSERT INTO \`news_cache\`
         (\`id\`,\`title\`,\`excerpt\`,\`verdict\`,\`category\`,\`image_url\`,\`url\`,\`pinned\`,\`published_at\`,\`synced_at\`)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         \`title\` = VALUES(\`title\`), \`excerpt\` = VALUES(\`excerpt\`),
         \`verdict\` = VALUES(\`verdict\`), \`category\` = VALUES(\`category\`),
         \`image_url\` = VALUES(\`image_url\`), \`url\` = VALUES(\`url\`),
         \`pinned\` = VALUES(\`pinned\`), \`published_at\` = VALUES(\`published_at\`),
         \`synced_at\` = VALUES(\`synced_at\`)`,
      [n.id, n.titulo, n.resumen, n.veredicto, n.categoria, n.imagen, n.url, n.destacada ? 1 : 0, fecha(n.publicado), t]
    )
  }

  // La copia local queda exactamente igual a lo que la fuente acaba de devolver.
  // Asi, si cambia el filtro de veredictos, lo que deja de calificar desaparece
  // en la siguiente corrida en vez de quedarse pegado por ser reciente.
  if (noticias.length) {
    const ids = noticias.map((n) => n.id)
    await query(
      `DELETE FROM \`news_cache\` WHERE \`id\` NOT IN (${ids.map(() => '?').join(',')})`,
      ids
    )
  }

  await registrarCorrida('NOTICIAS', true, null, Date.now() - inicio)
  const [{ n } = { n: 0 }] = await query('SELECT COUNT(*) AS n FROM `news_cache`')
  log(`[NOTICIAS] guardadas. En cache: ${n}`)

  await closePool()
}

main().catch(async (err) => {
  log('Error fatal:', err.message)
  process.exitCode = 1
  if (!DRY) await closePool().catch(() => {})
})

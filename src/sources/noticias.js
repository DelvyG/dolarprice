import pg from 'pg'
import { config } from '../config.js'

// Las noticias salen de verificavenezuela.org, que corre en el mismo servidor
// sobre PostgreSQL. Se leen con un rol que solo tiene SELECT sobre news, media
// y categories: ese proyecto no se toca ni se despliega para esto.
//
// El resultado se copia a la base de DolarPrice (ver ingest-news.js). Si
// verificavenezuela esta caido o cambia su esquema, la pestana sigue mostrando
// lo ultimo sincronizado en vez de romperse.

const BASE = 'https://verificavenezuela.org'

// verificavenezuela guarda published_at como "timestamp without time zone" y su
// Laravel corre en America/Caracas (config/app.php), asi que esos valores estan
// en hora de Caracas. El servidor, en cambio, esta en Europe/Berlin: si se deja
// que el driver los interprete como hora local, salen 6 horas corridas.
// Por eso se pide el valor crudo y se convierte a mano.
pg.types.setTypeParser(1114, (v) => v)

function caracasAUtc(texto) {
  if (!texto) return null
  const [dia, hora] = String(texto).split(' ')
  const tentativa = new Date(`${dia}T${hora ?? '00:00:00'}Z`)
  if (Number.isNaN(tentativa.getTime())) return null
  // Se deduce el desfase real de Caracas para esa fecha en vez de fijar -4, por
  // si el pais vuelve a moverlo como en 2007 y 2016.
  const enCaracas = new Date(tentativa.toLocaleString('en-US', { timeZone: 'America/Caracas' }))
  const enUtc = new Date(tentativa.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(tentativa.getTime() + (enUtc.getTime() - enCaracas.getTime()))
}

// Solo entran las noticias marcadas 'verificado'. Se probo dejando tambien los
// desmentidos ('falso', 'enganoso', 'parcialmente_verdadero') y en pantalla no
// convencio: una tarjeta con titular falso se lee mal en una app de tasas,
// aunque lleve su etiqueta roja. Filtrar aqui no afecta a verificavenezuela.org,
// que sigue publicando todo.
export const VEREDICTOS = {
  verificado: { texto: 'Verificado', tono: 'ok' },
}

const SQL = `
  SELECT
    n.id,
    n.title,
    n.slug,
    n.status,
    n.published_at,
    n.is_pinned,
    LEFT(regexp_replace(COALESCE(n.body, ''), '<[^>]*>', ' ', 'g'), 400) AS resumen,
    c.name  AS categoria,
    m.id    AS media_id,
    m.file_name,
    m.generated_conversions
  FROM news n
  LEFT JOIN categories c ON c.id = n.category_id
  LEFT JOIN LATERAL (
    SELECT id, file_name, generated_conversions
      FROM media
     WHERE model_id = n.id AND model_type LIKE '%News%' AND collection_name = 'cover'
     ORDER BY id ASC
     LIMIT 1
  ) m ON TRUE
  WHERE n.status = 'verificado'
    AND n.published_at IS NOT NULL
    AND n.published_at <= (NOW() AT TIME ZONE 'America/Caracas')
  ORDER BY n.published_at DESC
  LIMIT $1
`

// Spatie MediaLibrary guarda las conversiones junto al original.
// Se prefiere la miniatura webp (unos 13 KB) sobre el original (unos 270 KB).
function urlPortada(fila) {
  if (!fila.media_id || !fila.file_name) return null
  const base = `${BASE}/storage/media/${fila.media_id}`
  const sinExt = String(fila.file_name).replace(/\.[^.]+$/, '')
  const conv = fila.generated_conversions || {}
  if (conv.thumb) return `${base}/conversions/${sinExt}-thumb.webp`
  if (conv.medium) return `${base}/conversions/${sinExt}-medium.webp`
  return `${base}/${fila.file_name}`
}

const limpiar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim()

function recortar(texto, largo = 155) {
  const t = limpiar(texto)
  if (t.length <= largo) return t
  const corte = t.slice(0, largo)
  const espacio = corte.lastIndexOf(' ')
  return (espacio > 60 ? corte.slice(0, espacio) : corte) + '…'
}

export async function fetchNoticias(limite = 60) {
  const cliente = new pg.Client({
    host: config.vv.host,
    port: config.vv.port,
    database: config.vv.database,
    user: config.vv.user,
    password: config.vv.password,
    connectionTimeoutMillis: 8000,
    query_timeout: 15000,
  })

  await cliente.connect()
  try {
    const { rows } = await cliente.query(SQL, [limite])
    return rows.map((f) => ({
      id: Number(f.id),
      titulo: limpiar(f.title),
      resumen: recortar(f.resumen),
      veredicto: f.status,
      categoria: f.categoria ? limpiar(f.categoria) : null,
      imagen: urlPortada(f),
      url: `${BASE}/noticia/${f.slug}`,
      publicado: caracasAUtc(f.published_at),
      destacada: Boolean(f.is_pinned),
    }))
  } finally {
    await cliente.end()
  }
}

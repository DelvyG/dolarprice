/* ═══ DolarPrice · logica de la app ═══
   Sin framework a proposito: todo el bundle son unos 12 KB, arranca al instante
   en una red movil lenta y no hay build que mantener. */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const CLAVE_CACHE = 'dolarprice.rates.v2'
const CLAVE_TEMA = 'dolarprice.tema'

const NOMBRES = {
  USD: ['Dólar', 'Estados Unidos'],
  EUR: ['Euro', 'Zona euro'],
  CNY: ['Yuan', 'China'],
  TRY: ['Lira', 'Turquía'],
  RUB: ['Rublo', 'Rusia'],
}

const fmt = (n, dec = 2) =>
  new Intl.NumberFormat('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)

const estado = {
  datos: null,
  fuente: 'BCV',        // que tasa usa el conversor
  fila: 'a',            // fila activa del conversor: a = divisa, b = bolivares
  crudo: '',            // lo que el usuario lleva tecleado
  histCode: 'USD',
  histDias: 30,
}

/* ─── utilidades ─── */

const vibrar = (ms = 8) => { try { navigator.vibrate?.(ms) } catch {} }

let toastTimer
function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

function haceCuanto(iso) {
  if (!iso) return 'sin datos'
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seg < 90) return 'hace un momento'
  const min = Math.round(seg / 60)
  if (min < 60) return `hace ${min} min`
  const hor = Math.round(min / 60)
  if (hor < 24) return `hace ${hor} h`
  const dias = Math.round(hor / 24)
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

function fechaLarga(ymd) {
  if (!ymd) return ''
  const [a, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-VE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/* ─── tema ─── */

function aplicarTema(tema) {
  if (tema === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', tema)
  const oscuro = tema === 'dark' || (tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  $('meta[name="theme-color"][media*="dark"]')?.setAttribute('content', oscuro ? '#0B1210' : '#F4F7F5')
}

aplicarTema(localStorage.getItem(CLAVE_TEMA) || 'auto')

$('#btn-theme').addEventListener('click', () => {
  const actual = localStorage.getItem(CLAVE_TEMA) || 'auto'
  const siguiente = actual === 'auto' ? 'light' : actual === 'light' ? 'dark' : 'auto'
  localStorage.setItem(CLAVE_TEMA, siguiente)
  aplicarTema(siguiente)
  vibrar()
  toast(siguiente === 'auto' ? 'Tema del sistema' : siguiente === 'light' ? 'Tema claro' : 'Tema oscuro')
})

/* ─── datos ─── */

function tasaActiva() {
  const d = estado.datos
  if (!d) return null
  return estado.fuente === 'BCV' ? (d.bcv?.monedas?.USD ?? null) : (d.binance?.promedio ?? null)
}

async function cargar({ forzar = false } = {}) {
  const btn = $('#btn-refresh')
  if (forzar) btn.classList.add('spin')

  try {
    const url = forzar ? `/api/v1/rates?t=${Date.now()}` : '/api/v1/rates'
    const res = await fetch(url, { cache: forzar ? 'no-store' : 'default' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const datos = await res.json()
    estado.datos = datos
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ datos, guardado: Date.now() }))
    pintar()
    if (forzar) toast('Tasas actualizadas')
  } catch (err) {
    if (!estado.datos) {
      const guardado = localStorage.getItem(CLAVE_CACHE)
      if (guardado) {
        estado.datos = JSON.parse(guardado).datos
        pintar()
      }
    }
    aviso(
      navigator.onLine
        ? 'No se pudo contactar el servidor. Se muestran los últimos datos guardados.'
        : 'Sin conexión. Se muestran los últimos datos guardados.'
    )
  } finally {
    btn.classList.remove('spin')
  }
}

function aviso(texto, tipo = '') {
  const el = $('#banner')
  if (!texto) { el.hidden = true; return }
  el.textContent = texto
  el.className = 'banner ' + tipo
  el.hidden = false
}

/* ─── pintado ─── */

function pintar() {
  const d = estado.datos
  if (!d) return

  $('#card-bcv').classList.remove('skel')
  $('#card-bin').classList.remove('skel')
  $('#card-gap').classList.remove('skel')

  // Tarjeta BCV
  const usd = d.bcv?.monedas?.USD
  $('#bcv-usd').textContent = usd ? fmt(usd) : 'sin dato'
  $('#bcv-fecha').textContent = d.bcv?.fechaValor ? fechaLarga(d.bcv.fechaValor) : ''
  $('#bcv-sub').textContent = usd ? 'por 1 dólar · tasa oficial' : 'la fuente no respondió'

  // Binance
  const bin = d.binance
  $('#bin-usd').textContent = bin?.promedio ? fmt(bin.promedio) : 'sin dato'
  $('#bin-sub').textContent = bin?.promedio
    ? `compra ${fmt(bin.compra, 0)} · venta ${fmt(bin.venta, 0)}`
    : 'la fuente no respondió'

  // Brecha
  if (d.brecha) {
    $('#gap-pct').textContent = fmt(d.brecha.porcentaje) + '%'
    $('#gap-sub').textContent = `+${fmt(d.brecha.absoluta)} Bs sobre el oficial`
  } else {
    $('#gap-pct').textContent = '—'
    $('#gap-sub').textContent = 'faltan datos'
  }

  // Aviso de antigüedad. Nunca se inventa un número: si el dato es viejo, se dice.
  if (d.desactualizado) {
    aviso(`Los datos no se actualizan desde ${haceCuanto(d.bcv?.consultado || d.binance?.consultado)}.`, 'warn')
  } else {
    aviso(null)
  }

  $('#stamp').textContent = `Actualizado ${haceCuanto(d.bcv?.consultado || d.binance?.consultado)} · fuentes: BCV y Binance P2P`

  pintarMonedas()
  calcular()
}

function pintarMonedas() {
  const d = estado.datos
  const cont = $('#lista-monedas')
  const monedas = d?.bcv?.monedas ?? {}
  $('#mon-fecha').textContent = d?.bcv?.fechaValor
    ? `Fecha valor: ${fechaLarga(d.bcv.fechaValor)}`
    : 'Tasas informativas del sistema bancario'

  const filas = Object.entries(NOMBRES)
    .filter(([code]) => monedas[code])
    .map(([code, [nombre, pais]]) => `
      <div class="item">
        <div class="item-code">${code}</div>
        <div class="item-body">
          <div class="item-name">${nombre}</div>
          <div class="item-note">${pais}</div>
        </div>
        <div class="item-val">${fmt(monedas[code])}<small>bolívares</small></div>
      </div>`)

  if (d?.binance?.promedio) {
    filas.push(`
      <div class="item">
        <div class="item-code" style="color:var(--binance)">P2P</div>
        <div class="item-body">
          <div class="item-name">Binance</div>
          <div class="item-note">Promedio recortado del P2P</div>
        </div>
        <div class="item-val">${fmt(d.binance.promedio)}<small>bolívares</small></div>
      </div>`)
  }

  cont.innerHTML = filas.join('') || '<p class="note">Todavía no hay tasas cargadas.</p>'
}

/* ─── conversor ─── */

function calcular() {
  const tasa = tasaActiva()
  const crudo = estado.crudo
  const valor = Number(crudo.replace(/\./g, '').replace(',', '.')) || 0

  // El campo que se está tecleando muestra el texto tal cual lo escribe el
  // usuario; el otro muestra el resultado ya formateado.
  const escrito = crudo === '' ? '0' : formatearMientrasEscribe(crudo)
  const convertido = tasa ? (estado.fila === 'a' ? valor * tasa : valor / tasa) : 0

  if (estado.fila === 'a') {
    $('#val-a').textContent = escrito
    $('#val-b').textContent = tasa ? fmt(convertido) : '—'
  } else {
    $('#val-b').textContent = escrito
    $('#val-a').textContent = tasa ? fmt(convertido, 2) : '—'
  }

  $('#row-a').classList.toggle('on', estado.fila === 'a')
  $('#row-b').classList.toggle('on', estado.fila === 'b')

  const etiqueta = estado.fuente === 'BCV' ? 'Dólares' : 'USDT'
  const simbolo = estado.fuente === 'BCV' ? '$' : 'USDT'
  $('#lbl-a').textContent = etiqueta
  $('#sym-a').textContent = simbolo
}

// Agrupa los miles conforme se teclea, sin tocar los decimales a medio escribir.
function formatearMientrasEscribe(crudo) {
  const [ent, dec] = crudo.split(',')
  const entero = ent === '' ? '0' : new Intl.NumberFormat('es-VE').format(Number(ent.replace(/\./g, '')) || 0)
  return dec === undefined ? entero : `${entero},${dec}`
}

function teclear(k) {
  vibrar(6)
  let c = estado.crudo

  if (k === 'del') {
    c = c.slice(0, -1)
  } else if (k === ',') {
    if (c.includes(',')) return
    c = (c === '' ? '0' : c) + ','
  } else {
    const [, dec] = c.split(',')
    if (dec !== undefined && dec.length >= 2) return       // máximo 2 decimales
    if (c.replace(/[.,]/g, '').length >= 12) return        // tope de longitud
    c = c === '0' ? k : c + k
  }

  estado.crudo = c
  calcular()
}

$$('#pad .key').forEach((b) => b.addEventListener('click', () => teclear(b.dataset.k)))

// El teclado físico también funciona, útil en escritorio.
addEventListener('keydown', (e) => {
  if ($('.tabpane[data-pane="inicio"]').hidden) return
  if (/^[0-9]$/.test(e.key)) teclear(e.key)
  else if (e.key === ',' || e.key === '.') teclear(',')
  else if (e.key === 'Backspace') teclear('del')
  else if (e.key === 'Escape') limpiar()
})

const limpiar = () => { estado.crudo = ''; calcular() }

$('#btn-clear').addEventListener('click', () => { vibrar(); limpiar() })

$('#row-a').addEventListener('click', () => { if (estado.fila !== 'a') cambiarFila('a') })
$('#row-b').addEventListener('click', () => { if (estado.fila !== 'b') cambiarFila('b') })

function cambiarFila(fila) {
  vibrar()
  // Se conserva el valor visible al saltar de campo, que es lo que espera
  // cualquiera que use una calculadora de cambio.
  const tasa = tasaActiva()
  const valor = Number(estado.crudo.replace(/\./g, '').replace(',', '.')) || 0
  if (tasa && valor) {
    const nuevo = estado.fila === 'a' ? valor * tasa : valor / tasa
    estado.crudo = nuevo.toFixed(2).replace('.', ',')
  }
  estado.fila = fila
  calcular()
}

$('#btn-swap').addEventListener('click', () => cambiarFila(estado.fila === 'a' ? 'b' : 'a'))

$$('#seg .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#seg .seg-btn').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    estado.fuente = b.dataset.src
    vibrar()
    calcular()
  })
)

$('#btn-share').addEventListener('click', async () => {
  const tasa = tasaActiva()
  if (!tasa) return toast('Todavía no hay tasa que compartir')

  const nombre = estado.fuente === 'BCV' ? 'dólar BCV' : 'Binance P2P'
  const a = $('#val-a').textContent
  const b = $('#val-b').textContent
  const simbolo = estado.fuente === 'BCV' ? '$' : 'USDT'
  const texto = `${a} ${simbolo} = ${b} Bs\nTasa ${nombre}: ${fmt(tasa)} Bs\n\nvía dolarprice.com`

  try {
    if (navigator.share) {
      await navigator.share({ title: 'DolarPrice', text: texto })
    } else {
      await navigator.clipboard.writeText(texto)
      toast('Copiado al portapapeles')
    }
  } catch {
    /* el usuario canceló el diálogo de compartir */
  }
})

/* ─── pestañas ─── */

function irA(nombre) {
  $$('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== nombre })
  $$('.tab').forEach((t) => {
    const activa = t.dataset.tab === nombre
    t.classList.toggle('active', activa)
    t.setAttribute('aria-selected', String(activa))
  })
  $('#scroll').scrollTo?.({ top: 0 })
  scrollTo({ top: 0, behavior: 'smooth' })
  if (nombre === 'historial') cargarHistorial()
}

$$('.tab').forEach((t) => t.addEventListener('click', () => { vibrar(); irA(t.dataset.tab) }))

const tabInicial = new URLSearchParams(location.search).get('tab')
if (tabInicial && ['inicio', 'monedas', 'historial'].includes(tabInicial)) irA(tabInicial)

/* ─── histórico ─── */

$$('#seg-hist .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#seg-hist .seg-btn').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    estado.histCode = b.dataset.code
    vibrar()
    cargarHistorial()
  })
)

$$('#chips-dias .chip').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#chips-dias .chip').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    estado.histDias = Number(b.dataset.d)
    vibrar()
    cargarHistorial()
  })
)

async function cargarHistorial() {
  try {
    const res = await fetch(`/api/v1/history?code=${estado.histCode}&days=${estado.histDias}`)
    const { puntos } = await res.json()
    dibujarGrafico(puntos)
    pintarListaHistorial(puntos)
  } catch {
    dibujarGrafico([])
    $('#lista-hist').innerHTML = '<p class="note">No se pudo cargar el histórico.</p>'
  }
}

function dibujarGrafico(puntos) {
  const svg = $('#chart')
  const leyenda = $('#chart-legend')

  if (puntos.length < 2) {
    svg.innerHTML = '<text x="160" y="78" text-anchor="middle" fill="currentColor" opacity=".45" font-size="11">Aún no hay suficiente histórico</text>'
    leyenda.textContent = ''
    return
  }

  const W = 320, H = 150, P = 6
  const vals = puntos.map((p) => p.valor)
  const min = Math.min(...vals), max = Math.max(...vals)
  const rango = max - min || 1

  const x = (i) => P + (i * (W - P * 2)) / (puntos.length - 1)
  const y = (v) => H - P - ((v - min) / rango) * (H - P * 2)

  const linea = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
  const area = `${linea} L${x(puntos.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`
  const color = estado.histCode === 'USDT' ? 'var(--binance)' : 'var(--brand-2)'

  svg.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".32"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#g)"/>
    <path d="${linea}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(puntos.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3.5" fill="${color}"/>`

  const primero = vals[0], ultimo = vals[vals.length - 1]
  const variacion = ((ultimo / primero - 1) * 100).toFixed(2)
  leyenda.innerHTML = `<span>mín ${fmt(min)}</span><span>${variacion >= 0 ? '▲' : '▼'} ${fmt(Math.abs(variacion))}% en ${estado.histDias} días</span><span>máx ${fmt(max)}</span>`
}

function pintarListaHistorial(puntos) {
  const ultimos = [...puntos].reverse().slice(0, 12)
  $('#lista-hist').innerHTML = ultimos
    .map((p, i) => {
      const previo = ultimos[i + 1]
      const dif = previo ? p.valor - previo.valor : 0
      const signo = dif > 0 ? '▲' : dif < 0 ? '▼' : '·'
      const color = dif > 0 ? 'var(--brand-2)' : dif < 0 ? 'var(--danger)' : 'var(--muted)'
      return `
        <div class="item">
          <div class="item-body">
            <div class="item-name">${fechaLarga(p.fecha)}</div>
            <div class="item-note" style="color:${color}">${previo ? `${signo} ${fmt(Math.abs(dif))} Bs` : 'primer registro'}</div>
          </div>
          <div class="item-val">${fmt(p.valor)}</div>
        </div>`
    })
    .join('')
}

/* ─── tirar para recargar ─── */

let tocoY = 0, tirando = false
const pull = $('#pull')

addEventListener('touchstart', (e) => {
  if (scrollY <= 0) { tocoY = e.touches[0].clientY; tirando = true }
}, { passive: true })

addEventListener('touchmove', (e) => {
  if (!tirando) return
  const dy = e.touches[0].clientY - tocoY
  if (dy <= 0) return
  const avance = Math.min(dy / 2.2, 76)
  pull.style.transform = `translate(-50%, ${avance - 46}px) rotate(${avance * 5}deg)`
  pull.style.opacity = String(Math.min(avance / 50, 1))
}, { passive: true })

addEventListener('touchend', () => {
  if (!tirando) return
  const disparo = parseFloat(pull.style.opacity || '0') >= 1
  tirando = false
  if (disparo) {
    pull.classList.add('go')
    vibrar(14)
    cargar({ forzar: true }).finally(() => {
      pull.classList.remove('go')
      pull.style.transform = ''
      pull.style.opacity = '0'
    })
  } else {
    pull.style.transform = ''
    pull.style.opacity = '0'
  }
})

/* ─── varios ─── */

$('#btn-refresh').addEventListener('click', () => { vibrar(); cargar({ forzar: true }) })

addEventListener('scroll', () => $('.top').classList.toggle('scrolled', scrollY > 4), { passive: true })

addEventListener('online', () => { aviso(null); cargar({ forzar: true }) })
addEventListener('offline', () => aviso('Sin conexión. Se muestran los últimos datos guardados.'))

// Al volver a la app tras un rato, refrescar en silencio.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.datos) {
    const edad = Date.now() - new Date(estado.datos.servidor).getTime()
    if (edad > 120000) cargar()
  }
})

/* ─── arranque ─── */

// Pintado inmediato con lo último guardado: la app nunca arranca en blanco.
try {
  const guardado = localStorage.getItem(CLAVE_CACHE)
  if (guardado) { estado.datos = JSON.parse(guardado).datos; pintar() }
} catch {}

cargar()
setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 300000)

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

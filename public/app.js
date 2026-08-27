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

/* ─── panel del teclado ─── */

const hoja = $('#sheet')
const velo = $('#scrim')

function abrirTeclado() {
  if (hoja.classList.contains('open')) return
  velo.hidden = false
  requestAnimationFrame(() => velo.classList.add('show'))
  hoja.classList.add('open')
  hoja.setAttribute('aria-hidden', 'false')
  $('#scroll').classList.add('sheet-abierto')

  // Deja los dos montos justo encima del panel, sin que los tape.
  requestAnimationFrame(() => {
    const techo = innerHeight - hoja.offsetHeight
    const fondo = $('#row-b').getBoundingClientRect().bottom
    const sobra = fondo - (techo - 14)
    if (sobra > 0) scrollBy({ top: sobra, behavior: 'smooth' })
  })
}

function cerrarTeclado() {
  if (!hoja.classList.contains('open')) return
  hoja.classList.remove('open')
  hoja.setAttribute('aria-hidden', 'true')
  velo.classList.remove('show')
  setTimeout(() => { velo.hidden = true }, 300)
  $('#scroll').classList.remove('sheet-abierto')
}

$('#btn-done').addEventListener('click', () => { vibrar(); cerrarTeclado() })
velo.addEventListener('click', cerrarTeclado)
addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarTeclado() })

// Arrastrar el panel hacia abajo tambien lo cierra.
let arrastreY = null
hoja.addEventListener('touchstart', (e) => {
  if (e.target.closest('.key')) return
  arrastreY = e.touches[0].clientY
}, { passive: true })

hoja.addEventListener('touchmove', (e) => {
  if (arrastreY === null) return
  const dy = e.touches[0].clientY - arrastreY
  if (dy > 0) hoja.style.transform = `translateY(${dy}px)`
}, { passive: true })

hoja.addEventListener('touchend', (e) => {
  if (arrastreY === null) return
  const dy = e.changedTouches[0].clientY - arrastreY
  arrastreY = null
  hoja.style.transform = ''
  if (dy > 70) { vibrar(); cerrarTeclado() }
})

// El teclado físico también funciona, útil en escritorio.
addEventListener('keydown', (e) => {
  if ($('.tabpane[data-pane="inicio"]').hidden) return
  if (/^[0-9]$/.test(e.key)) teclear(e.key)
  else if (e.key === ',' || e.key === '.') teclear(',')
  else if (e.key === 'Backspace') teclear('del')
  // Escape lo maneja el panel del teclado, no limpia el monto.
})

const limpiar = () => { estado.crudo = ''; calcular() }

$('#btn-clear').addEventListener('click', () => { vibrar(); limpiar() })

$('#row-a').addEventListener('click', () => { if (estado.fila !== 'a') cambiarFila('a'); abrirTeclado() })
$('#row-b').addEventListener('click', () => { if (estado.fila !== 'b') cambiarFila('b'); abrirTeclado() })

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
  cerrarTeclado()
  $$('.tabpane').forEach((p) => { p.hidden = p.dataset.pane !== nombre })
  $$('.tab').forEach((t) => {
    const activa = t.dataset.tab === nombre
    t.classList.toggle('active', activa)
    t.setAttribute('aria-selected', String(activa))
  })
  $('#scroll').scrollTo?.({ top: 0 })
  scrollTo({ top: 0, behavior: 'smooth' })
  if (nombre === 'historial') cargarHistorial()
  if (nombre === 'noticias') cargarNoticias()
  // Definida más abajo, en el apartado de medición: es una declaración de
  // función, así que ya existe aunque se lea después en el archivo.
  marcar('tab', { t: nombre })
}

$$('.tab').forEach((t) => t.addEventListener('click', () => { vibrar(); irA(t.dataset.tab) }))

// La pestaña inicial se abre al final del archivo: irA() puede disparar la
// carga de noticias o del histórico, y sus variables se declaran más abajo.

/* ─── invitación a instalar ─── */

// Solo tiene sentido ofrecerla a quien entra por el navegador desde Android.
// Quien ya abrió la app instalada -PWA o la TWA de Android- no la ve nunca.
const CLAVE_INSTALL = 'dolarprice.install.oculto'

function corriendoComoApp() {
  return (
    ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
    navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  )
}

let promptInstalar = null

function evaluarInvitacion() {
  const esAndroid = /Android/i.test(navigator.userAgent)
  const oculto = localStorage.getItem(CLAVE_INSTALL) === '1'
  $('#get-app').hidden = !(esAndroid && !corriendoComoApp() && !oculto)
}

// Chrome avisa cuando la web cumple los requisitos para instalarse. Instalar la
// PWA es mejor que el APK: no pide permitir origenes desconocidos, no descarga
// 1 MB y se actualiza sola con el sitio. El APK queda como alternativa.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  promptInstalar = e
  $('#btn-install').hidden = false
})

$('#btn-install').addEventListener('click', async () => {
  if (!promptInstalar) return
  vibrar()
  promptInstalar.prompt()
  const { outcome } = await promptInstalar.userChoice
  promptInstalar = null
  $('#btn-install').hidden = true
  if (outcome === 'accepted') $('#get-app').hidden = true
})

$('#get-close').addEventListener('click', () => {
  vibrar()
  localStorage.setItem(CLAVE_INSTALL, '1')
  $('#get-app').hidden = true
})

$('#btn-apk').addEventListener('click', () => toast('Descargando… ábrelo cuando termine'))

addEventListener('appinstalled', () => {
  $('#get-app').hidden = true
  toast('Listo, ya la tienes instalada')
})

evaluarInvitacion()

/* ─── noticias ─── */

// Las publica verificavenezuela.org; aqui solo se listan y se abren alla.
const VEREDICTOS = {
  verificado: ['Verificado', 'ok'],
}

let noticiasCargadas = false

const escapar = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function fechaCorta(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  return d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
}

async function cargarNoticias() {
  const cont = $('#lista-noticias')
  if (noticiasCargadas) return

  try {
    const res = await fetch('/api/v1/news?limit=40')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const { noticias, sincronizado } = await res.json()

    if (!noticias.length) {
      cont.innerHTML = '<p class="note">Todavía no hay noticias sincronizadas.</p>'
      return
    }

    cont.innerHTML = noticias
      .map((n) => {
        const [etiqueta, tono] = VEREDICTOS[n.veredicto] ?? ['', 'neutro']
        const portada = n.imagen
          ? `<img class="new-img" src="${escapar(n.imagen)}" alt="" loading="lazy" decoding="async" width="92" height="92">`
          : '<div class="new-img vacia">📰</div>'
        return `
          <a class="new-item" href="${escapar(n.url)}" target="_blank" rel="noopener noreferrer">
            ${portada}
            <div class="new-body">
              <div class="new-top">
                ${etiqueta ? `<span class="vd vd-${tono}">${etiqueta}</span>` : ''}
                ${n.categoria ? `<span class="new-cat">${escapar(n.categoria)}</span>` : ''}
              </div>
              <div class="new-titulo">${escapar(n.titulo)}</div>
              <div class="new-pie">${fechaCorta(n.publicado)}</div>
            </div>
          </a>`
      })
      .join('')

    // Alguna portada puede faltar en disco aunque la base diga que existe.
    // Sin esto queda el icono de imagen rota del navegador.
    cont.querySelectorAll('.new-img').forEach((img) => {
      img.addEventListener('error', () => {
        const hueco = document.createElement('div')
        hueco.className = 'new-img vacia'
        hueco.textContent = '📰'
        img.replaceWith(hueco)
      }, { once: true })
    })

    $('#news-sub').textContent = `Verificadas por verificavenezuela.org · ${noticias.length} publicadas`
    noticiasCargadas = true
    if (sincronizado) console.log('noticias sincronizadas', sincronizado)
  } catch {
    cont.innerHTML = '<p class="note">No se pudieron cargar las noticias. Revisa tu conexión e inténtalo de nuevo.</p>'
  }
}

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
  // Con el teclado abierto manda el arrastre del panel, no el de recargar.
  if (hoja.classList.contains('open')) return
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

/* ═══ medición ═══════════════════════════════════════════════════════════════
   Alimenta el panel de /admin. Los datos no salen del servidor de DolarPrice:
   no hay Google Analytics ni ningún tercero, y por eso tampoco hay banner de
   cookies que pedir — esto no usa cookies, solo un identificador anónimo en el
   almacenamiento del propio navegador.

   Se mide desde aquí y no desde el servidor porque el service worker sirve la
   cáscara desde la caché: una visita repetida no llega a tocar el servidor, y
   contar allá perdería justo a los usuarios de la PWA y del APK.            */

const CLAVE_VISITANTE = 'dolarprice.vid'
const CLAVE_SESION = 'dolarprice.sid'
const CLAVE_MODO = 'dolarprice.modo'
const SESION_MS = 1800000     // media hora de inactividad y empieza otra sesión

const idNuevo = () => {
  // crypto.randomUUID no está en Safari viejo ni en WebView antiguos.
  try {
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').slice(0, 32)
  }
}

// Todo lo que toca el almacenamiento va envuelto: en modo incógnito de algunos
// navegadores localStorage existe pero lanza al escribir.
const guardar = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
const leer = (k) => { try { return localStorage.getItem(k) } catch { return null } }

function identidad() {
  let vid = leer(CLAVE_VISITANTE)
  if (!/^[a-f0-9]{32}$/.test(vid || '')) { vid = idNuevo(); guardar(CLAVE_VISITANTE, vid) }

  let sid = null
  try {
    const crudo = JSON.parse(sessionStorage.getItem(CLAVE_SESION) || 'null')
    if (crudo && Date.now() - crudo.visto < SESION_MS) sid = crudo.id
  } catch {}
  if (!/^[a-f0-9]{32}$/.test(sid || '')) sid = idNuevo()
  try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ id: sid, visto: Date.now() })) } catch {}

  return { vid, sid }
}

/* ─── de dónde se está abriendo la app ───────────────────────────────────────
   El APK es una TWA, o sea Chrome de verdad corriendo a pantalla completa. Lo
   que lo delata es el referente: al lanzarla, Android pone document.referrer en
   android-app://com.dolarprice.twa. Solo aparece en la primera navegación de la
   sesión, así que en cuanto se ve una vez se guarda y ya no se pierde.

   Sin ese sello, si la app corre en modo standalone es la PWA instalada; si no,
   es el navegador normal. Los tres casos se distinguen sin ambigüedad. */
function detectarModo() {
  const guardado = leer(CLAVE_MODO)
  if (guardado === 'apk') return 'apk'     // el sello del APK no caduca

  if (document.referrer.startsWith('android-app://com.dolarprice.twa')) {
    guardar(CLAVE_MODO, 'apk')
    return 'apk'
  }

  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true          // así lo dice Safari en iOS

  const modo = standalone ? 'pwa' : 'navegador'
  guardar(CLAVE_MODO, modo)
  return modo
}

const MODO = detectarModo()

/* ─── ¿ya tiene el APK instalado? ────────────────────────────────────────────
   getInstalledRelatedApps solo responde en Chrome sobre Android y únicamente si
   Digital Asset Links valida — que es justo lo que arregló assetlinks.json. En
   todo lo demás queda en null, que significa "no se sabe", no "no lo tiene". */
let apkInstalado = null
try {
  navigator.getInstalledRelatedApps?.().then((apps) => {
    apkInstalado = apps.some((a) => a.id === 'com.dolarprice.twa')
  }).catch(() => {})
} catch {}

/* ─── envío ─── */

const YO = identidad()
const ARRANQUE = Date.now()

// Ruta corta a propósito: los bloqueadores de anuncios cazan por nombre y
// "analytics", "track" y "collect" están en todas las listas. No es por
// esconderse — los datos no salen de nuestro servidor — sino porque si no, la
// mitad del tráfico no se contaría.
const RUTA_MEDICION = '/api/v1/e'

function marcar(event, extra = {}) {
  const cuerpo = JSON.stringify({
    v: YO.vid,
    s: YO.sid,
    event,
    p: location.pathname,
    r: document.referrer || null,
    m: MODO,
    k: apkInstalado,
    w: screen.width,
    h: screen.height,
    l: navigator.language,
    // Con quien codigo llego esta persona. El servidor decide que hacer con
    // el; aqui solo se transporta.
    ref: refGuardado(),
    ...extra,
  })

  try {
    // sendBeacon es lo único que sigue saliendo cuando la pestaña se está
    // cerrando; fetch se cancela a medio camino. Manda text/plain, que es lo
    // que el servidor espera en esta ruta.
    if (navigator.sendBeacon?.(RUTA_MEDICION, new Blob([cuerpo], { type: 'text/plain' }))) return
  } catch {}

  // keepalive hace lo mismo que sendBeacon donde este no exista.
  fetch(RUTA_MEDICION, {
    method: 'POST',
    body: cuerpo,
    headers: { 'Content-Type': 'text/plain' },
    keepalive: true,
  }).catch(() => {})
}

// La primera marca espera un momento: así getInstalledRelatedApps ya respondió
// y la visita entra con ese dato en vez de con un null.
setTimeout(() => marcar('view', { t: pestanaActual() }), 900)

function pestanaActual() {
  const activa = document.querySelector('.tab.active')
  return activa?.dataset.tab || 'inicio'
}

// Cuánto tiempo estuvo. pagehide y no unload: en iOS unload no llega nunca, y
// en Android tampoco es fiable con la app en segundo plano.
let despedido = false
addEventListener('pagehide', () => {
  if (despedido) return
  despedido = true
  marcar('fin', { d: Date.now() - ARRANQUE })
})

// Si el usuario vuelve, la visita sigue viva y habrá otra despedida.
addEventListener('pageshow', () => { despedido = false })

// Instalación de la PWA. El APK no dispara esto: se instala desde el sistema.
addEventListener('appinstalled', () => marcar('instalar'))

/* ─── arranque ─── */

// Pintado inmediato con lo último guardado: la app nunca arranca en blanco.
try {
  const guardado = localStorage.getItem(CLAVE_CACHE)
  if (guardado) { estado.datos = JSON.parse(guardado).datos; pintar() }
} catch {}

cargar()
setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 300000)

// Permite entrar directo a una pestaña con ?tab=noticias, que es lo que usan
// los accesos directos del manifiesto.
const tabInicial = new URLSearchParams(location.search).get('tab')
if (tabInicial && ['inicio', 'monedas', 'noticias', 'historial'].includes(tabInicial)) irA(tabInicial)

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

/* ═══ comparte y gana ════════════════════════════════════════════════════════
   Programa de referidos. Toda la lógica de dinero vive en el servidor: aquí
   solo se pinta lo que él responde y se mandan las acciones. Nada de lo que se
   guarde en este navegador decide cuánto cobra nadie.

   Se esconde entero si el programa está apagado desde /admin.              */

const CLAVE_REF = 'dolarprice.ref'      // código con el que llegó este visitante

const gana = { reglas: null, yo: null, vista: 'entrar' }

/* ─── el código de quien lo invitó ────────────────────────────────────────────
   Llega por ?ref=CODIGO y se guarda para siempre en este aparato. Es lo que
   hace que la atribución sobreviva a la instalación del APK: como la app es una
   TWA —Chrome de verdad, no un WebView— comparte localStorage con el navegador,
   así que el código puesto al abrir el enlace sigue ahí dentro de la app. */
;(function guardarRef() {
  const v = new URLSearchParams(location.search).get('ref')
  if (!v) return
  const codigo = v.toUpperCase().slice(0, 12)
  if (!/^[A-Z2-9]{5,12}$/.test(codigo)) return
  // No se pisa uno anterior: el primero que trajo a esta persona es el que vale.
  try { if (!localStorage.getItem(CLAVE_REF)) localStorage.setItem(CLAVE_REF, codigo) } catch {}
})()

const refGuardado = () => { try { return localStorage.getItem(CLAVE_REF) } catch { return null } }

/* ─── llamadas ─── */

async function apiGana(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  })
  const datos = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(datos.error || 'Algo salió mal, intenta de nuevo')
  return datos
}

const dinero = (v) => '$' + Number(v || 0).toFixed(2)

/* ─── la tarjeta de Inicio ─── */

async function cargarGana() {
  try {
    gana.reglas = await apiGana('/api/v1/ref/reglas')
    if (!gana.reglas.activo) { $('#gana').hidden = true; return }

    gana.yo = await apiGana('/api/v1/cuenta/yo')
    $('#gana').hidden = false
    pintarGana()
  } catch {
    $('#gana').hidden = true   // si falla, la app sigue como si nada
  }
}

function pintarGana() {
  const r = gana.reglas
  const y = gana.yo

  if (!y?.dentro) {
    $('#gana-tit').textContent = 'Comparte y gana'
    $('#gana-sub').textContent =
      'Gana ' + dinero(r.recompensa) + ' por cada amigo que use la app.'
    $('#gana-cuerpo').innerHTML =
      '<p class="gana-pista">Cada amigo que entre con tu enlace y use DolarPrice ' +
      '<b>' + r.diasActivos + ' días</b> te deja <b>' + dinero(r.recompensa) + '</b>. ' +
      'Cobras por Binance a partir de ' + dinero(r.minimoRetiro) + '.</p>' +
      '<div class="gana-acts">' +
        '<button class="btn ghost" id="gana-entrar">Ya tengo cuenta</button>' +
        '<button class="btn solid" id="gana-crear">Crear cuenta</button>' +
      '</div>'
    $('#gana-crear').addEventListener('click', () => abrirCuenta('registro'))
    $('#gana-entrar').addEventListener('click', () => abrirCuenta('entrar'))
    return
  }

  $('#gana-tit').textContent = 'Tus referidos'
  $('#gana-sub').textContent = y.bloqueado
    ? 'Tu cuenta está en revisión.'
    : dinero(r.recompensa) + ' por cada amigo que use la app ' + r.diasActivos + ' días.'

  const falta = Math.max(0, r.minimoRetiro - y.saldoLibre)
  const pct = r.minimoRetiro > 0 ? Math.min(100, (y.saldoLibre / r.minimoRetiro) * 100) : 100

  $('#gana-cuerpo').innerHTML =
    '<div class="gana-nums">' +
      '<div class="gana-num"><b>' + y.validos + '</b><span>válidos</span></div>' +
      '<div class="gana-num"><b>' + dinero(y.saldoLibre) + '</b><span>por cobrar</span></div>' +
      '<div class="gana-num"><b>' + dinero(y.saldoEspera) + '</b><span>en camino</span></div>' +
    '</div>' +
    '<div class="gana-codigo"><b>' + y.codigo + '</b>' +
      '<button id="gana-copiar">Copiar</button></div>' +
    '<div class="gana-barra"><i style="width:' + pct.toFixed(0) + '%"></i></div>' +
    '<p class="gana-pista">' +
      (!y.verificado
        ? 'Confirma tu correo para poder cobrar. Te mandamos un enlace a <b>' + y.email + '</b>.'
        : falta > 0
          ? 'Te faltan <b>' + dinero(falta) + '</b> para poder retirar.'
          : '¡Ya puedes retirar <b>' + dinero(y.saldoLibre) + '</b>!') +
      (y.saldoEspera > 0
        ? ' Lo que está "en camino" pasa a cobrable a los ' + r.diasCuarentena + ' días.'
        : '') +
    '</p>' +
    '<div class="gana-acts">' +
      '<button class="btn ghost" id="gana-detalle">Mi cuenta</button>' +
      '<button class="btn solid" id="gana-compartir">Compartir</button>' +
    '</div>'

  $('#gana-copiar').addEventListener('click', () => copiarEnlace(y.enlace))
  $('#gana-compartir').addEventListener('click', () => compartirEnlace(y))
  $('#gana-detalle').addEventListener('click', () => abrirCuenta('panel'))
}

async function copiarEnlace(enlace) {
  vibrar()
  try {
    await navigator.clipboard.writeText(enlace)
    toast('Enlace copiado')
  } catch {
    toast('No se pudo copiar')
  }
}

async function compartirEnlace(y) {
  vibrar()
  const texto = 'Mira el precio del dólar en Venezuela al instante con DolarPrice. ' +
    'Entra con mi enlace: ' + y.enlace
  try {
    if (navigator.share) await navigator.share({ title: 'DolarPrice', text: texto, url: y.enlace })
    else { await navigator.clipboard.writeText(texto); toast('Mensaje copiado') }
  } catch { /* el usuario canceló */ }
}

/* ─── la hoja de la cuenta ─── */

function abrirCuenta(vista) {
  vibrar()
  gana.vista = vista
  $('#hoja-cuenta').classList.add('on')
  pintarCuenta()
}

function cerrarCuenta() {
  $('#hoja-cuenta').classList.remove('on')
}

const campo = (id, etiqueta, tipo, extra = '') =>
  '<div class="campo"><label for="' + id + '">' + etiqueta + '</label>' +
  '<input type="' + tipo + '" id="' + id + '" ' + extra + '></div>'

function pintarCuenta() {
  const c = $('#hc-cuerpo')
  const r = gana.reglas
  const y = gana.yo

  if (gana.vista === 'registro') {
    c.innerHTML =
      '<h3>Crear tu cuenta</h3>' +
      '<p class="hc-sub">Para guardar lo que ganes y poder cobrarlo. Entrar a ver el dólar no necesita cuenta.</p>' +
      campo('r-email', 'Correo', 'email', 'autocomplete="email" required') +
      campo('r-pass', 'Contraseña', 'password', 'autocomplete="new-password" minlength="10" required') +
      campo('r-pass2', 'Repite la contraseña', 'password', 'autocomplete="new-password" minlength="10" required') +
      '<button class="btn solid" id="hc-enviar" style="width:100%;margin-top:18px">Crear cuenta</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>' +
      '<div class="pie-links"><button class="enlace" id="hc-ir-entrar">Ya tengo cuenta</button></div>'
    $('#hc-enviar').addEventListener('click', hacerRegistro)
    $('#hc-ir-entrar').addEventListener('click', () => { gana.vista = 'entrar'; pintarCuenta() })

  } else if (gana.vista === 'entrar') {
    c.innerHTML =
      '<h3>Entrar</h3>' +
      '<p class="hc-sub">Tus ganancias te siguen: entra desde el teléfono o desde la computadora.</p>' +
      campo('e-email', 'Correo', 'email', 'autocomplete="email" required') +
      campo('e-pass', 'Contraseña', 'password', 'autocomplete="current-password" required') +
      '<button class="btn solid" id="hc-enviar" style="width:100%;margin-top:18px">Entrar</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>' +
      '<div class="pie-links">' +
        '<button class="enlace" id="hc-ir-registro">Crear una cuenta</button>' +
        '<button class="enlace" id="hc-olvide">Olvidé mi contraseña</button>' +
      '</div>'
    $('#hc-enviar').addEventListener('click', hacerEntrar)
    $('#hc-ir-registro').addEventListener('click', () => { gana.vista = 'registro'; pintarCuenta() })
    $('#hc-olvide').addEventListener('click', () => { gana.vista = 'olvide'; pintarCuenta() })

  } else if (gana.vista === 'olvide') {
    c.innerHTML =
      '<h3>Recuperar tu contraseña</h3>' +
      '<p class="hc-sub">Te mandamos un enlace al correo con el que te registraste.</p>' +
      campo('o-email', 'Correo', 'email', 'autocomplete="email" required') +
      '<button class="btn solid" id="hc-enviar" style="width:100%;margin-top:18px">Mandar el enlace</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>' +
      '<div class="pie-links"><button class="enlace" id="hc-ir-entrar">Volver</button></div>'
    $('#hc-enviar').addEventListener('click', hacerOlvide)
    $('#hc-ir-entrar').addEventListener('click', () => { gana.vista = 'entrar'; pintarCuenta() })

  } else if (gana.vista === 'reset') {
    c.innerHTML =
      '<h3>Contraseña nueva</h3>' +
      '<p class="hc-sub">Escribe la nueva. Al guardarla se cierran las sesiones abiertas.</p>' +
      campo('n-pass', 'Contraseña nueva', 'password', 'autocomplete="new-password" minlength="10" required') +
      campo('n-pass2', 'Repítela', 'password', 'autocomplete="new-password" minlength="10" required') +
      '<button class="btn solid" id="hc-enviar" style="width:100%;margin-top:18px">Guardar</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>'
    $('#hc-enviar').addEventListener('click', hacerReset)

  } else if (gana.vista === 'retiro') {
    c.innerHTML =
      '<h3>Retirar ' + dinero(y.saldoLibre) + '</h3>' +
      '<p class="hc-sub">Te lo mandamos por Binance. Escribe el correo de tu cuenta de Binance, ' +
      'revisa bien que esté correcto.</p>' +
      campo('w-email', 'Correo de tu Binance', 'email',
            'autocomplete="email" value="' + (y.binanceEmail || y.email || '') + '" required') +
      '<button class="btn solid" id="hc-enviar" style="width:100%;margin-top:18px">Pedir el retiro</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>' +
      '<p class="gana-pista">Los pagos se revisan a mano, así que pueden tardar unos días.</p>' +
      '<div class="pie-links"><button class="enlace" id="hc-ir-panel">Volver</button></div>'
    $('#hc-enviar').addEventListener('click', hacerRetiro)
    $('#hc-ir-panel').addEventListener('click', () => { gana.vista = 'panel'; pintarCuenta() })

  } else {
    // panel del usuario
    const puede = y.verificado && y.saldoLibre >= r.minimoRetiro && !y.bloqueado
    c.innerHTML =
      '<h3>Mi cuenta</h3>' +
      '<p class="hc-sub">' + y.email +
        (y.verificado ? '' : ' · <b style="color:var(--danger)">sin confirmar</b>') + '</p>' +
      '<div class="gana-nums">' +
        '<div class="gana-num"><b>' + y.total + '</b><span>invitados</span></div>' +
        '<div class="gana-num"><b>' + y.validos + '</b><span>válidos</span></div>' +
        '<div class="gana-num"><b>' + dinero(y.saldoPagado) + '</b><span>cobrado</span></div>' +
      '</div>' +
      '<div class="gana-codigo"><b>' + y.codigo + '</b><button id="hc-copiar">Copiar</button></div>' +
      (y.verificado ? '' :
        '<button class="btn ghost" id="hc-reenviar" style="width:100%;margin-top:12px">Reenviar el correo de confirmación</button>') +
      '<button class="btn solid" id="hc-retirar" style="width:100%;margin-top:12px"' +
        (puede ? '' : ' disabled') + '>' +
        (puede ? 'Retirar ' + dinero(y.saldoLibre)
               : !y.verificado ? 'Confirma tu correo para cobrar'
               : 'Mínimo ' + dinero(r.minimoRetiro) + ' para cobrar') +
      '</button>' +
      '<div class="gana-aviso" id="hc-aviso"></div>' +
      (y.referidos.length
        ? '<p class="gana-pista" style="margin-top:18px"><b>Tus invitados</b></p>' +
          y.referidos.slice(0, 12).map((x) =>
            '<p class="gana-pista" style="margin-top:6px">' +
            (x.pagable ? '✅ ' : x.validado ? '⏳ ' : '👀 ') +
            (x.validado ? (x.pagable ? 'Listo, ya cuenta' : 'Contando cuarentena')
                        : 'Lleva ' + x.dias + ' de ' + r.diasActivos + ' días') + '</p>').join('')
        : '<p class="gana-pista" style="margin-top:18px">Todavía no ha entrado nadie con tu enlace.</p>') +
      (y.retiros.length
        ? '<p class="gana-pista" style="margin-top:18px"><b>Tus retiros</b></p>' +
          y.retiros.map((x) =>
            '<p class="gana-pista" style="margin-top:6px">' + dinero(x.monto) + ' · ' +
            (x.estado === 'pagado' ? '✅ pagado' : x.estado === 'rechazado' ? '❌ rechazado' : '⏳ en revisión') +
            '</p>').join('')
        : '') +
      '<div class="pie-links"><button class="enlace" id="hc-salir">Cerrar sesión</button></div>'

    $('#hc-copiar').addEventListener('click', () => copiarEnlace(y.enlace))
    $('#hc-salir').addEventListener('click', hacerSalir)
    if (puede) $('#hc-retirar').addEventListener('click', () => { gana.vista = 'retiro'; pintarCuenta() })
    $('#hc-reenviar')?.addEventListener('click', hacerReenviar)
  }
}

/* ─── acciones ─── */

function avisar(texto, bien) {
  const el = $('#hc-aviso')
  if (!el) return
  el.className = 'gana-aviso ' + (bien ? 'bien' : 'mal')
  el.textContent = texto
  if (!bien) vibrar(40)
}

async function conBoton(fn) {
  const b = $('#hc-enviar')
  const antes = b?.textContent
  if (b) { b.disabled = true; b.textContent = 'Un momento…' }
  try { await fn() } finally { if (b) { b.disabled = false; b.textContent = antes } }
}

const hacerRegistro = () => conBoton(async () => {
  try {
    const d = await apiGana('/api/v1/cuenta/registro', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#r-email').value.trim(),
        pass: $('#r-pass').value,
        confirmar: $('#r-pass2').value,
        v: YO.vid,
      }),
    })
    gana.yo = await apiGana('/api/v1/cuenta/yo')
    pintarGana()
    gana.vista = 'panel'
    pintarCuenta()
    toast(d.correoEnviado ? 'Cuenta creada, revisa tu correo' : 'Cuenta creada')
  } catch (e) { avisar(e.message) }
})

const hacerEntrar = () => conBoton(async () => {
  try {
    await apiGana('/api/v1/cuenta/entrar', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#e-email').value.trim(),
        pass: $('#e-pass').value,
        v: YO.vid,
      }),
    })
    gana.yo = await apiGana('/api/v1/cuenta/yo')
    pintarGana()
    gana.vista = 'panel'
    pintarCuenta()
    toast('¡Hola de nuevo!')
  } catch (e) { avisar(e.message) }
})

const hacerOlvide = () => conBoton(async () => {
  try {
    await apiGana('/api/v1/cuenta/olvide', {
      method: 'POST', body: JSON.stringify({ email: $('#o-email').value.trim() }),
    })
    // Siempre el mismo mensaje, exista o no la cuenta: si no, este formulario
    // serviría para averiguar qué correos están registrados.
    avisar('Si ese correo tiene cuenta, ya salió el enlace. Revisa tu bandeja.', true)
  } catch (e) { avisar(e.message) }
})

const hacerReset = () => conBoton(async () => {
  try {
    await apiGana('/api/v1/cuenta/reset', {
      method: 'POST',
      body: JSON.stringify({
        token: gana.tokenReset,
        nueva: $('#n-pass').value,
        confirmar: $('#n-pass2').value,
      }),
    })
    avisar('Contraseña cambiada. Ya puedes entrar.', true)
    setTimeout(() => { gana.vista = 'entrar'; pintarCuenta() }, 1400)
  } catch (e) { avisar(e.message) }
})

const hacerRetiro = () => conBoton(async () => {
  try {
    const d = await apiGana('/api/v1/ref/retiro', {
      method: 'POST', body: JSON.stringify({ email: $('#w-email').value.trim() }),
    })
    gana.yo = await apiGana('/api/v1/cuenta/yo')
    pintarGana()
    gana.vista = 'panel'
    pintarCuenta()
    toast('Retiro de ' + dinero(d.monto) + ' pedido')
  } catch (e) { avisar(e.message) }
})

async function hacerReenviar() {
  try {
    await apiGana('/api/v1/cuenta/reenviar', { method: 'POST' })
    avisar('Correo reenviado, revisa tu bandeja.', true)
  } catch (e) { avisar(e.message) }
}

async function hacerSalir() {
  try { await apiGana('/api/v1/cuenta/salir', { method: 'POST' }) } catch {}
  gana.yo = { dentro: false }
  pintarGana()
  cerrarCuenta()
  toast('Sesión cerrada')
}

/* ─── enlaces que llegan por correo ───────────────────────────────────────────
   Apuntan a /cuenta?verificar=... y /cuenta?reset=... . Se procesan aquí y se
   limpia la URL después, para que el token no se quede en la barra ni acabe en
   el historial ni en un enlace compartido. */
;(async function enlacesDeCorreo() {
  const q = new URLSearchParams(location.search)
  const verificar = q.get('verificar')
  const reset = q.get('reset')
  if (!verificar && !reset) return

  history.replaceState(null, '', location.pathname === '/cuenta' ? '/' : location.pathname)

  if (verificar) {
    try {
      await apiGana('/api/v1/cuenta/verificar', { method: 'POST', body: JSON.stringify({ token: verificar }) })
      toast('¡Correo confirmado!')
      gana.yo = await apiGana('/api/v1/cuenta/yo').catch(() => null)
      pintarGana()
    } catch (e) { toast(e.message) }
    return
  }

  gana.tokenReset = reset
  gana.reglas = gana.reglas || await apiGana('/api/v1/ref/reglas').catch(() => null)
  abrirCuenta('reset')
})()

$('#hoja-cuenta').addEventListener('click', (e) => {
  if (e.target === $('#hoja-cuenta')) cerrarCuenta()
})
addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarCuenta() })

cargarGana()

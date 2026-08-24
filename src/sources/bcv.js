import { request } from '../http.js'

const URL_TASAS = 'https://www.bcv.org.ve/tasas-informativas-sistema-bancario'

// El BCV identifica cada moneda por el id del div que la contiene.
const MONEDAS = { dolar: 'USD', euro: 'EUR', yuan: 'CNY', lira: 'TRY', rublo: 'RUB' }

// Del div de la moneda hasta su primer <strong>, que es donde va el monto.
const RE_TASA = /id="(dolar|euro|yuan|lira|rublo)"[\s\S]{0,1200}?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/g
const RE_FECHA = /Fecha Valor[\s\S]{0,240}?(\d{1,2})\s*(?:de\s*)?([A-Za-zÁÉÍÓÚáéíóúñ]+)\s*(?:de\s*)?(\d{4})/i

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

const sinAcentos = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// "784,66330000" -> 784.6633   (punto = miles, coma = decimales)
function parseMonto(texto) {
  const n = Number(texto.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

// "Fecha Valor: Lunes, 24 Agosto 2026" -> "2026-08-24"
function parseFechaValor(html) {
  const m = html.match(RE_FECHA)
  if (!m) return null
  const mes = MESES[sinAcentos(m[2])]
  if (!mes) return null
  const pad = (n) => String(Number(n)).padStart(2, '0')
  return `${m[3]}-${pad(mes)}-${pad(m[1])}`
}

export async function fetchBCV() {
  const html = await request(URL_TASAS)

  const rates = {}
  for (const m of html.matchAll(RE_TASA)) {
    const valor = parseMonto(m[2])
    if (valor !== null) rates[MONEDAS[m[1]]] = valor
  }

  if (!rates.USD) {
    throw new Error('El BCV respondio pero no se hallo la tasa del dolar; probablemente cambio el HTML')
  }

  return { rates, fechaValor: parseFechaValor(html), fuente: 'BCV' }
}

import { request } from '../http.js'
import { config } from '../config.js'

const URL_P2P = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search'

/**
 * Promedio recortado: ordena, descarta un porcentaje en cada extremo y promedia
 * el resto. Es el promedio de los ultimos N anuncios, solo que un par de avisos
 * atipicos -que en el P2P venezolano son constantes: precios de 980 cuando el
 * mercado esta en 918- no arrastran el resultado.
 */
export function promedioRecortado(valores, trimPct) {
  if (!valores.length) return null
  const orden = [...valores].sort((a, b) => a - b)
  const recorte = Math.floor((orden.length * trimPct) / 100)
  const centro = recorte > 0 && orden.length - recorte * 2 >= 3 ? orden.slice(recorte, orden.length - recorte) : orden
  return {
    valor: centro.reduce((a, b) => a + b, 0) / centro.length,
    usados: centro.length,
    totales: orden.length,
    descartados: orden.length - centro.length,
    min: orden[0],
    max: orden[orden.length - 1],
  }
}

// tradeType BUY  = anuncios de venta (lo que pagas por comprar USDT)
// tradeType SELL = anuncios de compra (lo que te pagan por vender USDT)
async function fetchLado(tradeType, rows) {
  const body = JSON.stringify({
    asset: 'USDT',
    fiat: 'VES',
    merchantCheck: false,
    page: 1,
    rows,
    payTypes: [],
    publisherType: null,
    tradeType,
  })

  const texto = await request(URL_P2P, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  })

  const data = JSON.parse(texto)
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    throw new Error(`Binance no devolvio anuncios para ${tradeType}`)
  }

  return data.data
    .map((o) => Number(o?.adv?.price))
    .filter((p) => Number.isFinite(p) && p > 0)
}

export async function fetchBinanceP2P() {
  const { rows, trimPct } = config.binance

  const [preciosCompra, preciosVenta] = await Promise.all([
    fetchLado('BUY', rows),
    fetchLado('SELL', rows),
  ])

  const compra = promedioRecortado(preciosCompra, trimPct)
  const venta = promedioRecortado(preciosVenta, trimPct)

  if (!compra && !venta) throw new Error('Binance no devolvio precios utilizables')

  // El "paralelo" que se muestra es el punto medio entre ambos lados.
  const promedio = compra && venta ? (compra.valor + venta.valor) / 2 : (compra ?? venta).valor

  return {
    promedio,
    compra: compra?.valor ?? null,
    venta: venta?.valor ?? null,
    detalle: { compra, venta, trimPct, rows },
    fuente: 'Binance P2P',
  }
}

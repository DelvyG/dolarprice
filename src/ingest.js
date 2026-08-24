import { fetchBCV } from './sources/bcv.js'
import { fetchBinanceP2P } from './sources/binance.js'
import { guardarTasa, registrarCorrida, closePool } from './db.js'

const DRY = process.argv.includes('--dry-run')

const log = (...args) => console.log(new Date().toISOString(), ...args)

async function correrFuente(nombre, fn) {
  const inicio = Date.now()
  try {
    const resultado = await fn()
    const ms = Date.now() - inicio
    if (!DRY) await registrarCorrida(nombre, true, null, ms)
    log(`[${nombre}] ok en ${ms}ms`)
    return resultado
  } catch (err) {
    const ms = Date.now() - inicio
    log(`[${nombre}] FALLO: ${err.message}`)
    // Un fallo no borra ni invalida el dato anterior: la API lo seguira
    // sirviendo y marcara su antiguedad. Nunca se inventan tasas.
    if (!DRY) await registrarCorrida(nombre, false, err.message, ms).catch(() => {})
    return null
  }
}

async function main() {
  let cambios = 0

  const bcv = await correrFuente('BCV', fetchBCV)
  if (bcv) {
    for (const [code, rate] of Object.entries(bcv.rates)) {
      log(`  BCV ${code} = ${rate}`)
      if (!DRY && (await guardarTasa({ code, source: 'BCV', rate, valueDate: bcv.fechaValor }))) cambios++
    }
    log(`  BCV fecha valor: ${bcv.fechaValor ?? 'no publicada'}`)
  }

  const bin = await correrFuente('BINANCE', fetchBinanceP2P)
  if (bin) {
    log(`  BINANCE USDT = ${bin.promedio.toFixed(4)} (compra ${bin.compra?.toFixed(4)} / venta ${bin.venta?.toFixed(4)})`)
    log(`  descartados por recorte: compra ${bin.detalle.compra?.descartados ?? 0}, venta ${bin.detalle.venta?.descartados ?? 0}`)
    if (!DRY && (await guardarTasa({
      code: 'USDT',
      source: 'BINANCE',
      rate: bin.promedio,
      buy: bin.compra,
      sell: bin.venta,
      meta: bin.detalle,
    }))) cambios++
  }

  if (!bcv && !bin) {
    log('Ninguna fuente respondio. Se conservan los ultimos valores conocidos.')
    process.exitCode = 1
  } else {
    log(`Fin. ${cambios} valor(es) cambiaron.`)
  }

  if (!DRY) await closePool()
}

main().catch(async (err) => {
  log('Error fatal:', err.message)
  process.exitCode = 1
  if (!DRY) await closePool().catch(() => {})
})

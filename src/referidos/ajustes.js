// Reglas del programa de referidos.
//
// Viven en la tabla `admin_config` y se editan desde /admin, no desde el .env:
// el monto que se paga es justo lo que hay que poder subir o bajar en caliente
// segun como responda la gente, y no tiene sentido desplegar para eso.
//
// Los valores por defecto son deliberadamente conservadores. Aqui sale dinero
// real de un bolsillo y DolarPrice todavia no ingresa nada, asi que esto es
// presupuesto de publicidad: mas vale empezar corto y subir.

import { numero, valor, guardarValor } from '../admin/ajustes.js'

export const POR_DEFECTO = {
  activo: 0,               // el programa arranca APAGADO: se enciende cuando el
                           // dueno haya fijado montos y tope a conciencia
  recompensa: 0.20,        // USD por referido validado
  minimoRetiro: 5,         // USD; por debajo de esto no se puede pedir retiro
  diasActivos: 3,          // dias DISTINTOS que el referido debe abrir la app
  diasCuarentena: 7,       // dias que el saldo espera antes de poder retirarse
  topeMensual: 100,        // USD/mes en recompensas; al llegar, deja de validar
  topeDiarioPorUsuario: 20,// validaciones por referidor y dia antes de marcar
  maxPorIp: 3,             // referidos distintos aceptados desde una misma IP
}

const CLAVE = (k) => 'ref_' + k

/** Todos los ajustes de una vez, ya con sus valores por defecto aplicados. */
export async function ajustesReferidos() {
  const [activo, recompensa, minimoRetiro, diasActivos, diasCuarentena,
         topeMensual, topeDiarioPorUsuario, maxPorIp] = await Promise.all([
    numero(CLAVE('activo'), POR_DEFECTO.activo),
    numero(CLAVE('recompensa'), POR_DEFECTO.recompensa),
    numero(CLAVE('minimoRetiro'), POR_DEFECTO.minimoRetiro),
    numero(CLAVE('diasActivos'), POR_DEFECTO.diasActivos),
    numero(CLAVE('diasCuarentena'), POR_DEFECTO.diasCuarentena),
    numero(CLAVE('topeMensual'), POR_DEFECTO.topeMensual),
    numero(CLAVE('topeDiarioPorUsuario'), POR_DEFECTO.topeDiarioPorUsuario),
    numero(CLAVE('maxPorIp'), POR_DEFECTO.maxPorIp),
  ])

  return {
    activo: Boolean(activo),
    recompensa,
    minimoRetiro,
    diasActivos,
    diasCuarentena,
    topeMensual,
    topeDiarioPorUsuario,
    maxPorIp,
    // Texto del mensaje que se ensena en la app cuando el programa esta apagado.
    aviso: (await valor(CLAVE('aviso'), '')) || '',
  }
}

// Limites de cada ajuste. No son paranoia: un cero de mas en la recompensa
// escrito con prisa desde el telefono vacia el presupuesto de un mes en una
// tarde, y el panel es lo unico que hay entre ese dedo y la base de datos.
const LIMITES = {
  activo:               { min: 0,    max: 1 },
  recompensa:           { min: 0,    max: 5 },
  minimoRetiro:         { min: 0.5,  max: 500 },
  diasActivos:          { min: 1,    max: 30, entero: true },
  diasCuarentena:       { min: 0,    max: 90, entero: true },
  topeMensual:          { min: 0,    max: 100000 },
  topeDiarioPorUsuario: { min: 1,    max: 1000, entero: true },
  maxPorIp:             { min: 1,    max: 50, entero: true },
}

/**
 * Guarda los ajustes que vengan en el objeto, ignorando los que no conoce.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export async function guardarAjustes(nuevos = {}) {
  const cambios = []

  for (const [clave, lim] of Object.entries(LIMITES)) {
    if (nuevos[clave] === undefined || nuevos[clave] === null || nuevos[clave] === '') continue
    let n = Number(nuevos[clave])
    if (!Number.isFinite(n)) return { ok: false, error: `"${clave}" no es un numero` }
    if (lim.entero) n = Math.trunc(n)
    if (n < lim.min || n > lim.max) {
      return { ok: false, error: `"${clave}" debe estar entre ${lim.min} y ${lim.max}` }
    }
    cambios.push([clave, n])
  }

  if (typeof nuevos.aviso === 'string') cambios.push(['aviso', nuevos.aviso.slice(0, 200)])

  for (const [clave, v] of cambios) await guardarValor(CLAVE(clave), v)
  return { ok: true, guardados: cambios.length }
}

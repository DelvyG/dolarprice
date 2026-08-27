// Programa de referidos: atribucion, validacion, saldos y retiros.
//
// ── Por que un referido no cuenta al instalar ────────────────────────────────
// Porque pagar por instalacion se farmea, y aqui sale dinero real. Un referido
// solo cuenta cuando abre la app en N dias DISTINTOS (3 por defecto). Levantar
// mil instalaciones falsas es barato; mantenerlas abriendo la app tres dias
// distintos, no. Y despues de validarse, el saldo pasa una cuarentena antes de
// poder retirarse: es la ventana para cazar el fraude antes de pagarlo.
//
// ── Como se atribuye una instalacion del APK ─────────────────────────────────
// El APK es una TWA, o sea Chrome de verdad y no un WebView, y por eso comparte
// cookies y localStorage con el navegador para dolarprice.com. Si alguien abre
// dolarprice.com/app?ref=CODIGO en Chrome y luego instala y abre el APK, el
// codigo sigue en localStorage y el beacon lo manda igual. No hace falta ningun
// sistema de atribucion de instalaciones.  << CONFIRMAR EN UN TELEFONO REAL >>
//
// ── Nada de esto se fia del cliente ──────────────────────────────────────────
// El cliente manda el codigo; todo lo demas -- quien es el referidor, si ya
// estaba referido, cuantos dias lleva, cuanto se paga -- lo decide el servidor.
// El saldo no se toca nunca desde una peticion del usuario.

import { query, ahora } from '../db.js'
import { ajustesReferidos } from './ajustes.js'
import { CODIGO, cuentaDelDispositivo } from './cuentas.js'

export { CODIGO }

const ID = /^[a-f0-9]{32}$/
const dec = (v) => Math.round(Number(v || 0) * 10000) / 10000

/* ─── atribucion ────────────────────────────────────────────────────────────
   Se llama desde el beacon cuando llega un visitante con un codigo pegado.
   Silenciosa a proposito: si algo no cuadra no se avisa al cliente, solo no se
   crea la relacion. Decirle "ese codigo no vale" solo le sirve a quien esta
   probando codigos a ver cual existe. */
export async function atribuir({ visitorId, codigo, ip, countryCode, modo, userAgent }, log) {
  try {
    if (!ID.test(visitorId || '') || !CODIGO.test(codigo || '')) return

    const cfg = await ajustesReferidos()
    if (!cfg.activo) return

    // Un aparato se refiere una sola vez en la vida. La PK de `referrals` ya lo
    // impone; comprobarlo aqui ahorra un INSERT fallido en cada visita.
    const [ya] = await query('SELECT `visitor_id` FROM `referrals` WHERE `visitor_id` = ?', [visitorId])
    if (ya) return

    const [dueno] = await query(
      'SELECT `id`,`bloqueado` FROM `ref_users` WHERE `code` = ?', [codigo]
    )
    if (!dueno || dueno.bloqueado) return

    // Autorreferido. Si este aparato ya esta enlazado a una cuenta y es la
    // misma, no cuenta -- es lo primero que prueba todo el mundo.
    const suya = await cuentaDelDispositivo(visitorId)
    if (suya && Number(suya) === Number(dueno.id)) return

    // Demasiados desde la misma IP. No se descarta -- una familia comparte wifi
    // y seria injusto -- pero se marca para que no se pague sin mirarlo.
    let sospechoso = null
    if (ip) {
      const [{ n }] = await query('SELECT COUNT(*) AS n FROM `referrals` WHERE `ip` = ?', [ip])
      if (n >= cfg.maxPorIp) sospechoso = `${n + 1} referidos desde la misma IP`
    }

    await query(
      'INSERT IGNORE INTO `referrals` ' +
      '(`visitor_id`,`code`,`user_id`,`ip`,`country_code`,`modo`,`sospechoso`,`user_agent`,`creado`) ' +
      'VALUES (?,?,?,?,?,?,?,?,?)',
      [visitorId, codigo, dueno.id, ip, countryCode, modo, sospechoso,
       (userAgent || '').slice(0, 400), ahora()]
    )
    await query('UPDATE `ref_users` SET `total` = `total` + 1 WHERE `id` = ?', [dueno.id])
  } catch (e) {
    log?.warn(`referidos: no se pudo atribuir (${e.message})`)
  }
}

/* ─── dias de actividad ─────────────────────────────────────────────────────
   Se llama en cada visita. `ultimo_dia` es lo que impide que alguien sume tres
   dias abriendo la app tres veces en la misma tarde. */
export async function marcarDia({ visitorId, modo }, log) {
  try {
    if (!ID.test(visitorId || '')) return
    const r = await query(
      'UPDATE `referrals` SET `dias_activos` = `dias_activos` + 1, `ultimo_dia` = CURDATE(), ' +
      '  `modo` = COALESCE(?, `modo`) ' +
      'WHERE `visitor_id` = ? AND `validado` = 0 AND (`ultimo_dia` IS NULL OR `ultimo_dia` < CURDATE())',
      [modo || null, visitorId]
    )
    if (r.affectedRows) await intentarValidar(visitorId, log)
  } catch (e) {
    log?.warn(`referidos: no se pudo marcar el dia (${e.message})`)
  }
}

/* ─── validacion ─── */

/** Recompensas concedidas este mes, para el tope mensual. */
async function gastadoEsteMes() {
  const [f] = await query(
    'SELECT COALESCE(SUM(`recompensa`),0) AS s FROM `referrals` ' +
    'WHERE `validado` = 1 AND `validado_at` >= DATE_FORMAT(NOW(), "%Y-%m-01")'
  )
  return Number(f?.s || 0)
}

async function intentarValidar(visitorId, log) {
  const cfg = await ajustesReferidos()
  if (!cfg.activo) return

  const [r] = await query('SELECT * FROM `referrals` WHERE `visitor_id` = ?', [visitorId])
  if (!r || r.validado || r.dias_activos < cfg.diasActivos) return

  // Marcado: se deja listo pero sin pagar. Lo decide el panel.
  if (r.sospechoso) {
    log?.info(`referidos: ${visitorId} llego al umbral pero esta marcado (${r.sospechoso})`)
    return
  }

  // Tope mensual. Se deja de VALIDAR, no de contar: al subir el tope o al
  // entrar el mes siguiente, estos referidos siguen ahi y se validan entonces.
  if (cfg.topeMensual > 0 && (await gastadoEsteMes()) + cfg.recompensa > cfg.topeMensual) {
    log?.warn('referidos: tope mensual alcanzado, no se valida nada mas por ahora')
    return
  }

  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM `referrals` ' +
    'WHERE `user_id` = ? AND `validado` = 1 AND DATE(`validado_at`) = CURDATE()',
    [r.user_id]
  )
  if (n >= cfg.topeDiarioPorUsuario) {
    await query('UPDATE `referrals` SET `sospechoso` = ? WHERE `visitor_id` = ?',
      [`${n + 1} validados en un solo dia`, visitorId])
    return
  }

  const [dueno] = await query('SELECT `bloqueado` FROM `ref_users` WHERE `id` = ?', [r.user_id])
  if (!dueno || dueno.bloqueado) return

  await query(
    'UPDATE `referrals` SET `validado` = 1, `validado_at` = ?, `recompensa` = ? ' +
    'WHERE `visitor_id` = ? AND `validado` = 0',
    [ahora(), cfg.recompensa, visitorId]
  )
  await query(
    'UPDATE `ref_users` SET `validos` = `validos` + 1, `saldo_espera` = `saldo_espera` + ? WHERE `id` = ?',
    [cfg.recompensa, r.user_id]
  )
  log?.info(`referidos: validado ${visitorId} para la cuenta ${r.user_id} (+${cfg.recompensa})`)
}

/* ─── cuarentena ────────────────────────────────────────────────────────────
   Pasa a retirable lo que ya cumplio los dias de espera. Corre cada pocas horas
   desde el propio proceso, junto con la purga de la analitica. */
export async function madurarSaldos(log) {
  const cfg = await ajustesReferidos()

  const listos = await query(
    'SELECT `user_id`, COALESCE(SUM(`recompensa`),0) AS monto, COUNT(*) AS n FROM `referrals` ' +
    'WHERE `validado` = 1 AND `madurado` = 0 AND `sospechoso` IS NULL AND `recompensa` > 0 ' +
    '  AND `validado_at` < (NOW() - INTERVAL ? DAY) ' +
    'GROUP BY `user_id`',
    [cfg.diasCuarentena]
  )

  let total = 0
  for (const f of listos) {
    // Se marcan PRIMERO y se mueve el saldo con lo que de verdad se marco: al
    // reves, un fallo entre las dos sentencias abonaria el dinero dos veces.
    const marcadas = await query(
      'UPDATE `referrals` SET `madurado` = 1 ' +
      'WHERE `user_id` = ? AND `validado` = 1 AND `madurado` = 0 AND `sospechoso` IS NULL ' +
      '  AND `validado_at` < (NOW() - INTERVAL ? DAY)',
      [f.user_id, cfg.diasCuarentena]
    )
    if (!marcadas.affectedRows) continue

    await query(
      'UPDATE `ref_users` SET `saldo_espera` = GREATEST(0, `saldo_espera` - ?), ' +
      '  `saldo_libre` = `saldo_libre` + ? WHERE `id` = ?',
      [f.monto, f.monto, f.user_id]
    )
    total += marcadas.affectedRows
  }

  if (total) log?.info(`referidos: ${total} recompensas salieron de cuarentena`)
  return total
}

/* ─── lo que ve el usuario ─── */

export async function panelUsuario(userId) {
  const cfg = await ajustesReferidos()
  const [u] = await query('SELECT * FROM `ref_users` WHERE `id` = ?', [userId])
  if (!u) return null

  const [referidos, retiros, dispositivos] = await Promise.all([
    query(
      'SELECT `dias_activos`,`validado`,`madurado`,`modo`,`country_code`,`creado` FROM `referrals` ' +
      'WHERE `user_id` = ? ORDER BY `creado` DESC LIMIT 50',
      [userId]
    ),
    query(
      'SELECT `monto`,`estado`,`email`,`pedido_at`,`resuelto_at` FROM `payouts` ' +
      'WHERE `user_id` = ? ORDER BY `id` DESC LIMIT 10',
      [userId]
    ),
    query('SELECT COUNT(*) AS n FROM `ref_devices` WHERE `user_id` = ?', [userId]),
  ])

  return {
    activo: cfg.activo,
    aviso: cfg.aviso,
    email: u.email,
    verificado: Boolean(u.verificado),
    codigo: u.code,
    enlace: `${process.env.SITIO_URL || 'https://dolarprice.com'}/app?ref=${u.code}`,
    bloqueado: Boolean(u.bloqueado),
    binanceEmail: u.binance_email,
    aparatos: Number(dispositivos[0]?.n || 0),
    saldoEspera: dec(u.saldo_espera),
    saldoLibre: dec(u.saldo_libre),
    saldoPagado: dec(u.saldo_pagado),
    total: Number(u.total),
    validos: Number(u.validos),
    reglas: {
      recompensa: cfg.recompensa,
      minimoRetiro: cfg.minimoRetiro,
      diasActivos: cfg.diasActivos,
      diasCuarentena: cfg.diasCuarentena,
    },
    // Solo el progreso, nada que identifique a nadie: quien refirio no tiene
    // por que saber que aparatos concretos entraron con su codigo.
    referidos: referidos.map((p) => ({
      dias: Number(p.dias_activos),
      validado: Boolean(p.validado),
      pagable: Boolean(p.madurado),
      modo: p.modo,
      pais: p.country_code,
      fecha: p.creado,
    })),
    retiros: retiros.map((r) => ({
      monto: dec(r.monto),
      estado: r.estado,
      email: r.email,
      pedido: r.pedido_at,
      resuelto: r.resuelto_at,
    })),
  }
}

/* ─── retiros ─── */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Pide un retiro. El descuento del saldo va en la MISMA sentencia que comprueba
 * que alcanza (`WHERE saldo_libre >= ?`): leer primero y restar despues dejaria
 * que dos peticiones simultaneas cobraran dos veces el mismo saldo.
 */
export async function pedirRetiro({ userId, email, ip }) {
  const cfg = await ajustesReferidos()
  if (!cfg.activo) return { ok: false, error: 'El programa esta pausado ahora mismo' }

  const correo = String(email || '').trim().toLowerCase()
  if (!EMAIL.test(correo) || correo.length > 160) {
    return { ok: false, error: 'Escribe el correo de tu cuenta de Binance' }
  }

  const [u] = await query('SELECT * FROM `ref_users` WHERE `id` = ?', [userId])
  if (!u) return { ok: false, error: 'Cuenta no encontrada' }
  if (u.bloqueado) return { ok: false, error: 'Esta cuenta esta en revision' }
  if (!u.verificado) return { ok: false, error: 'Confirma tu correo antes de retirar' }

  const [{ n }] = await query(
    "SELECT COUNT(*) AS n FROM `payouts` WHERE `user_id` = ? AND `estado` = 'pendiente'", [userId]
  )
  if (n > 0) return { ok: false, error: 'Ya tienes un retiro pendiente de pago' }

  const monto = dec(u.saldo_libre)
  if (monto < cfg.minimoRetiro) {
    return { ok: false, error: `El minimo para retirar es $${cfg.minimoRetiro.toFixed(2)}` }
  }

  const r = await query(
    'UPDATE `ref_users` SET `saldo_libre` = `saldo_libre` - ?, `binance_email` = ? ' +
    'WHERE `id` = ? AND `saldo_libre` >= ?',
    [monto, correo, userId, monto]
  )
  if (!r.affectedRows) return { ok: false, error: 'El saldo cambio, vuelve a intentarlo' }

  await query(
    'INSERT INTO `payouts` (`user_id`,`code`,`email`,`monto`,`ip`,`pedido_at`) VALUES (?,?,?,?,?,?)',
    [userId, u.code, correo, monto, ip, ahora()]
  )
  return { ok: true, monto }
}

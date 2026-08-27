// Lo que ve el dueno en /admin, pestana Referidos.
//
// Aqui se decide sobre dinero, asi que todo lo que mueve saldo es explicito y
// deja rastro: aprobar un referido marcado, marcar un pago como hecho, bloquear
// a alguien. Nada de esto pasa solo.

import { query, ahora } from '../db.js'
import { enviar, correoPagado } from '../correo.js'

const dec = (v) => Math.round(Number(v || 0) * 10000) / 10000
const n = (v) => Number(v || 0)

/* ─── resumen ─── */

export async function resumenReferidos() {
  const [[tot], [refs], [dinero], [pagos], top, marcados, ultimos] = await Promise.all([
    query('SELECT COUNT(*) AS usuarios, SUM(`bloqueado`) AS bloqueados, ' +
          '  SUM(`verificado`) AS verificados FROM `ref_users`'),
    query('SELECT COUNT(*) AS total, ' +
          '  SUM(`validado`) AS validados, ' +
          '  SUM(CASE WHEN `sospechoso` IS NOT NULL THEN 1 ELSE 0 END) AS marcados ' +
          'FROM `referrals`'),
    query('SELECT COALESCE(SUM(`saldo_espera`),0) AS espera, ' +
          '  COALESCE(SUM(`saldo_libre`),0) AS libre, ' +
          '  COALESCE(SUM(`saldo_pagado`),0) AS pagado FROM `ref_users`'),
    query("SELECT COUNT(*) AS pendientes, COALESCE(SUM(`monto`),0) AS monto " +
          "FROM `payouts` WHERE `estado` = 'pendiente'"),

    // Quien mas ha traido. Es la lista que de verdad se mira: si alguien
    // aparece con numeros raros, es por donde empieza el fraude.
    query(
      'SELECT `id`,`email`,`code`,`verificado`,`bloqueado`,`total`,`validos`,' +
      '  `saldo_espera`,`saldo_libre`,`saldo_pagado`,`creado`,`ultimo_acceso` ' +
      'FROM `ref_users` ORDER BY `validos` DESC, `total` DESC LIMIT 40'
    ),

    // Los marcados por sospecha: llegaron al umbral pero NO se pagan solos.
    query(
      'SELECT r.`visitor_id`,r.`code`,r.`sospechoso`,r.`dias_activos`,r.`ip`,' +
      '  r.`country_code`,r.`modo`,r.`creado`, u.`email` ' +
      'FROM `referrals` r JOIN `ref_users` u ON u.`id` = r.`user_id` ' +
      'WHERE r.`sospechoso` IS NOT NULL AND r.`validado` = 0 ' +
      'ORDER BY r.`creado` DESC LIMIT 40'
    ),

    query(
      'SELECT r.`code`,r.`dias_activos`,r.`validado`,r.`madurado`,r.`modo`,' +
      '  r.`country_code`,r.`creado`, u.`email` ' +
      'FROM `referrals` r JOIN `ref_users` u ON u.`id` = r.`user_id` ' +
      'ORDER BY r.`creado` DESC LIMIT 30'
    ),
  ])

  // Lo comprometido este mes, para saber cuanto queda del tope.
  const [mes] = await query(
    'SELECT COALESCE(SUM(`recompensa`),0) AS s FROM `referrals` ' +
    'WHERE `validado` = 1 AND `validado_at` >= DATE_FORMAT(NOW(), "%Y-%m-01")'
  )

  return {
    usuarios: n(tot?.usuarios),
    verificados: n(tot?.verificados),
    bloqueados: n(tot?.bloqueados),
    referidos: n(refs?.total),
    validados: n(refs?.validados),
    marcados: n(refs?.marcados),
    saldoEspera: dec(dinero?.espera),
    saldoLibre: dec(dinero?.libre),
    saldoPagado: dec(dinero?.pagado),
    pagosPendientes: n(pagos?.pendientes),
    montoPendiente: dec(pagos?.monto),
    gastadoEsteMes: dec(mes?.s),
    top: top.map((u) => ({
      id: n(u.id), email: u.email, codigo: u.code,
      verificado: Boolean(u.verificado), bloqueado: Boolean(u.bloqueado),
      total: n(u.total), validos: n(u.validos),
      espera: dec(u.saldo_espera), libre: dec(u.saldo_libre), pagado: dec(u.saldo_pagado),
      creado: u.creado, ultimo: u.ultimo_acceso,
    })),
    marcadosLista: marcados.map((r) => ({
      visitorId: r.visitor_id, codigo: r.code, email: r.email,
      motivo: r.sospechoso, dias: n(r.dias_activos), ip: r.ip,
      pais: r.country_code, modo: r.modo, creado: r.creado,
    })),
    ultimos: ultimos.map((r) => ({
      codigo: r.code, email: r.email, dias: n(r.dias_activos),
      validado: Boolean(r.validado), pagable: Boolean(r.madurado),
      modo: r.modo, pais: r.country_code, creado: r.creado,
    })),
  }
}

/* ─── retiros ─── */

export const listaPagos = (estado = 'pendiente') => query(
  'SELECT p.`id`,p.`code`,p.`email`,p.`monto`,p.`estado`,p.`nota`,p.`ip`,' +
  '  p.`pedido_at`,p.`resuelto_at`, u.`email` AS cuenta, u.`validos`, u.`saldo_pagado` ' +
  'FROM `payouts` p JOIN `ref_users` u ON u.`id` = p.`user_id` ' +
  'WHERE p.`estado` = ? ORDER BY p.`id` DESC LIMIT 60',
  [['pendiente', 'pagado', 'rechazado'].includes(estado) ? estado : 'pendiente']
)

/**
 * Marca un retiro como pagado o rechazado.
 *
 * Al rechazar se DEVUELVE el saldo a la cuenta: cuando se pidio el retiro se
 * descontó, asi que no devolverlo seria quedarse con el dinero del usuario.
 */
export async function resolverPago({ id, accion, nota }, log) {
  const [p] = await query("SELECT * FROM `payouts` WHERE `id` = ? AND `estado` = 'pendiente'", [id])
  if (!p) return { ok: false, error: 'Ese retiro ya no esta pendiente' }

  const t = ahora()

  if (accion === 'pagar') {
    await query(
      "UPDATE `payouts` SET `estado` = 'pagado', `resuelto_at` = ?, `nota` = ? WHERE `id` = ? AND `estado` = 'pendiente'",
      [t, (nota || '').slice(0, 300) || null, id]
    )
    await query('UPDATE `ref_users` SET `saldo_pagado` = `saldo_pagado` + ? WHERE `id` = ?',
      [p.monto, p.user_id])
    // Aviso al usuario. Si el correo falla, el pago sigue marcado igual.
    enviar({ para: p.email, ...correoPagado(p.monto, p.email) }, log).catch(() => {})
    return { ok: true, estado: 'pagado' }
  }

  if (accion === 'rechazar') {
    await query(
      "UPDATE `payouts` SET `estado` = 'rechazado', `resuelto_at` = ?, `nota` = ? WHERE `id` = ? AND `estado` = 'pendiente'",
      [t, (nota || '').slice(0, 300) || null, id]
    )
    await query('UPDATE `ref_users` SET `saldo_libre` = `saldo_libre` + ? WHERE `id` = ?',
      [p.monto, p.user_id])
    return { ok: true, estado: 'rechazado', devuelto: dec(p.monto) }
  }

  return { ok: false, error: 'Accion no valida' }
}

/* ─── moderacion ─── */

export async function bloquearUsuario({ id, bloqueado, nota }) {
  const r = await query(
    'UPDATE `ref_users` SET `bloqueado` = ?, `nota` = ? WHERE `id` = ?',
    [bloqueado ? 1 : 0, (nota || '').slice(0, 300) || null, id]
  )
  if (!r.affectedRows) return { ok: false, error: 'Cuenta no encontrada' }
  // Bloquear echa fuera: dejarle la sesion abierta no bloquea gran cosa.
  if (bloqueado) await query('DELETE FROM `ref_sessions` WHERE `user_id` = ?', [id])
  return { ok: true }
}

/**
 * Decide sobre un referido marcado como sospechoso.
 *  - aprobar:  se le quita la marca y se abona la recompensa
 *  - descartar: se queda sin marca pero con recompensa 0, y no se paga
 */
export async function resolverMarcado({ visitorId, accion, recompensa }) {
  const [r] = await query(
    'SELECT * FROM `referrals` WHERE `visitor_id` = ? AND `sospechoso` IS NOT NULL', [visitorId]
  )
  if (!r) return { ok: false, error: 'Ese referido ya no esta marcado' }

  if (accion === 'aprobar') {
    const monto = Math.max(0, Math.min(Number(recompensa) || 0, 5))
    await query(
      'UPDATE `referrals` SET `sospechoso` = NULL, `validado` = 1, `validado_at` = ?, `recompensa` = ? ' +
      'WHERE `visitor_id` = ? AND `validado` = 0',
      [ahora(), monto, visitorId]
    )
    await query(
      'UPDATE `ref_users` SET `validos` = `validos` + 1, `saldo_espera` = `saldo_espera` + ? WHERE `id` = ?',
      [monto, r.user_id]
    )
    return { ok: true, abonado: monto }
  }

  if (accion === 'descartar') {
    // Se cierra como validado con recompensa 0 y ya madurado. Parece raro, pero
    // es lo que lo saca de la lista de pendientes sin pagar nada: si solo se
    // cambiara el texto de `sospechoso`, seguiria saliendo como pendiente para
    // siempre y habria que decidir sobre el una y otra vez.
    await query(
      "UPDATE `referrals` SET `sospechoso` = 'descartado a mano', `recompensa` = 0, " +
      "  `validado` = 1, `madurado` = 1, `validado_at` = ? WHERE `visitor_id` = ?",
      [ahora(), visitorId]
    )
    return { ok: true }
  }

  return { ok: false, error: 'Accion no valida' }
}

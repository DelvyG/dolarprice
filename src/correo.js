// Envio de correos: verificar la cuenta y restablecer la contrasena.
//
// Soporta Resend y Brevo por su API HTTP, y SMTP corriente. Se elige solo segun
// que variables haya en el .env, asi no hace falta decidir el proveedor ahora ni
// tocar codigo si se cambia mas adelante:
//
//   RESEND_API_KEY=re_...                         -> Resend
//   BREVO_API_KEY=xkeysib-...                     -> Brevo
//   SMTP_HOST=... SMTP_USER=... SMTP_PASS=...     -> SMTP
//
// Las dos primeras van por fetch y no necesitan ninguna dependencia. La de SMTP
// usa nodemailer, que solo se carga si de verdad se va a usar -- un import
// dinamico, para que quien despliegue con Resend no pague por tenerlo.
//
// Si no hay ninguna configurada, enviar() no revienta: registra el aviso y
// devuelve false. Quien llama decide que hacer, y en el caso del registro lo
// que hace es dejar entrar igual y avisar de que el correo no salio. Que no se
// pueda mandar un correo no puede impedir que alguien se registre.

import { config } from './config.js'

const DE = process.env.CORREO_DESDE || 'DolarPrice <noreply@dolarprice.com>'

// A donde van las respuestas. El remitente es un noreply --lo normal y lo que
// espera la gente-- pero aqui se mueve dinero: si alguien contesta porque su
// pago no llego, ese correo no puede caer en un buzon que nadie lee. Con
// Reply-To sale del noreply y aterriza en una direccion de verdad.
const RESPONDER_A = process.env.CORREO_RESPONDER_A || ''

export const hayCorreo = () =>
  Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_HOST)

export function proveedorCorreo() {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.BREVO_API_KEY) return 'brevo'
  if (process.env.SMTP_HOST) return 'smtp'
  return null
}

/** Extrae "algo@dominio" de un "Nombre <algo@dominio>". */
const soloDireccion = (v) => {
  const m = String(v).match(/<([^>]+)>/)
  return m ? m[1] : String(v).trim()
}

async function porResend({ para, asunto, html, texto }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DE, to: [para], subject: asunto, html, text: texto,
      ...(RESPONDER_A ? { reply_to: [RESPONDER_A] } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Resend respondio ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function porBrevo({ para, asunto, html, texto }) {
  const dir = soloDireccion(DE)
  const nombre = String(DE).replace(/<[^>]*>/, '').trim() || 'DolarPrice'
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: dir, name: nombre },
      to: [{ email: para }],
      subject: asunto,
      htmlContent: html,
      textContent: texto,
      ...(RESPONDER_A ? { replyTo: { email: RESPONDER_A } } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Brevo respondio ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

let transporte = null

async function porSmtp({ para, asunto, html, texto }) {
  if (!transporte) {
    const { default: nodemailer } = await import('nodemailer')
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      // 465 es TLS directo; 587 y 25 empiezan en claro y suben con STARTTLS.
      secure: String(process.env.SMTP_SEGURO || '') === '1' || Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  }
  await transporte.sendMail({
    from: DE, to: para, subject: asunto, html, text: texto,
    ...(RESPONDER_A ? { replyTo: RESPONDER_A } : {}),
  })
}

/**
 * @returns {Promise<boolean>} false si no se pudo enviar. Nunca lanza.
 */
export async function enviar({ para, asunto, html, texto }, log) {
  const proveedor = proveedorCorreo()
  if (!proveedor) {
    log?.warn(`correo: no hay proveedor configurado, no se envio "${asunto}" a ${para}`)
    return false
  }
  try {
    if (proveedor === 'resend') await porResend({ para, asunto, html, texto })
    else if (proveedor === 'brevo') await porBrevo({ para, asunto, html, texto })
    else await porSmtp({ para, asunto, html, texto })
    log?.info(`correo: enviado "${asunto}" a ${para} por ${proveedor}`)
    return true
  } catch (e) {
    log?.error(`correo: fallo al enviar a ${para} por ${proveedor} (${e.message})`)
    return false
  }
}

/* ─── plantillas ───────────────────────────────────────────────────────────
   HTML a mano y sin imagenes: pesa poco, entra en cualquier cliente de correo
   y no da pie a que lo marquen como promocion. */

const BASE = process.env.SITIO_URL || 'https://dolarprice.com'

const envoltorio = (titulo, cuerpo, boton) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f2f6f3;padding:28px 16px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px">
    <div style="font-size:22px;font-weight:800;color:#16A34A;margin-bottom:4px">DolarPrice</div>
    <h1 style="font-size:18px;color:#0C1D15;margin:14px 0 10px">${titulo}</h1>
    <div style="font-size:15px;line-height:1.6;color:#3d4f47">${cuerpo}</div>
    ${boton ? `<a href="${boton.url}" style="display:inline-block;margin-top:22px;background:#16A34A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${boton.texto}</a>
    <p style="font-size:12px;color:#7a8b83;margin-top:18px;line-height:1.5">Si el boton no funciona, copia este enlace:<br><span style="color:#16A34A;word-break:break-all">${boton.url}</span></p>` : ''}
    <p style="font-size:12px;color:#7a8b83;margin-top:26px;border-top:1px solid #e6ece8;padding-top:16px">
      Si no fuiste tu, ignora este mensaje: sin abrir el enlace no pasa nada.
    </p>
  </div>
</div>`

export const correoVerificar = (token) => ({
  asunto: 'Confirma tu cuenta de DolarPrice',
  html: envoltorio(
    'Confirma tu correo',
    'Ya casi. Toca el boton para confirmar tu cuenta y empezar a ganar con tus referidos.',
    { url: `${BASE}/cuenta?verificar=${token}`, texto: 'Confirmar mi cuenta' }
  ),
  texto: `Confirma tu cuenta de DolarPrice: ${BASE}/cuenta?verificar=${token}`,
})

export const correoReset = (token) => ({
  asunto: 'Restablece tu contrasena de DolarPrice',
  html: envoltorio(
    'Restablece tu contrasena',
    'Pediste cambiar tu contrasena. El enlace vale una sola vez y caduca en una hora.',
    { url: `${BASE}/cuenta?reset=${token}`, texto: 'Poner una contrasena nueva' }
  ),
  texto: `Restablece tu contrasena de DolarPrice: ${BASE}/cuenta?reset=${token} (caduca en 1 hora)`,
})

export const correoPagado = (monto, email) => ({
  asunto: 'Te pagamos tus referidos de DolarPrice',
  html: envoltorio(
    `Se te pagaron $${Number(monto).toFixed(2)}`,
    `Ya salio el pago a tu cuenta de Binance <b>${email}</b>. Si en unas horas no lo ves, respondenos a este correo.`,
    null
  ),
  texto: `Se te pagaron $${Number(monto).toFixed(2)} a tu Binance ${email}.`,
})

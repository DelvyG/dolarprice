// Lectura del User-Agent: navegador, sistema, tipo de aparato y deteccion de bots.
//
// A mano y no con ua-parser-js porque aqui solo hacen falta las familias que de
// verdad aparecen en el trafico venezolano, y esa libreria pesa mas que toda la
// app junta. Si algun dia hace falta precision de verdad, se cambia por ella sin
// tocar nada mas: la firma de leerUA() es la unica superficie.
//
// El orden de las comprobaciones importa: casi todos los navegadores mienten
// diciendo que son Chrome y Safari a la vez. Se prueba primero el mas especifico.

const BOTS = /bot\b|crawler|spider|crawl|slurp|curl\/|wget|python-requests|axios\/|go-http|java\/|httpclient|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|pingdom|uptimerobot|semrush|ahrefs|mj12|dotbot|petalbot|bingpreview|facebookexternalhit|whatsapp|telegrambot|twitterbot|discordbot|linkedinbot|embedly|preview|monitor|scan/i

// Se prueban en este orden. El primero que casa, gana.
const NAVEGADORES = [
  ['Edge',            /\bEdg(?:e|A|iOS)?\/([\d.]+)/],
  ['Opera',           /\bOPR\/([\d.]+)|\bOpera\/([\d.]+)/],
  ['Samsung Internet',/\bSamsungBrowser\/([\d.]+)/],
  ['Vivaldi',         /\bVivaldi\/([\d.]+)/],
  ['Brave',           /\bBrave\/([\d.]+)/],
  ['Yandex',          /\bYaBrowser\/([\d.]+)/],
  ['UC Browser',      /\bUCBrowser\/([\d.]+)/],
  ['Firefox',         /\bFxiOS\/([\d.]+)|\bFirefox\/([\d.]+)/],
  ['Chrome',          /\bCriOS\/([\d.]+)|\bChrome\/([\d.]+)/],
  ['Safari',          /\bVersion\/([\d.]+).*\bSafari\//],
  ['Safari',          /\bSafari\/([\d.]+)/],
]

const SISTEMAS = [
  ['Android',   /\bAndroid[ /]([\d.]+)/],
  ['iPadOS',    /\biPad.*?\bOS ([\d_]+)/],
  ['iOS',       /\b(?:iPhone |CPU )OS ([\d_]+)/],
  ['Windows',   /\bWindows NT ([\d.]+)/],
  ['macOS',     /\bMac OS X ([\d_.]+)/],
  ['Chrome OS', /\bCrOS\b \S+ ([\d.]+)/],
  ['Linux',     /\b(Linux)\b/],
]

// Windows NT no dice "11": el numero de version se quedo en 10.0 y hay que
// mirar otras pistas. No se puede distinguir 10 de 11 desde el UA a secas, asi
// que se muestra "10/11" en vez de mentir.
const WINDOWS = {
  '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP',
}

const corta = (v, n) => (v ? String(v).slice(0, n) : null)
const mayor = (v) => (v ? String(v).replace(/_/g, '.').split('.').slice(0, 2).join('.') : null)

export function esBot(ua) {
  if (!ua || ua.length < 10) return true   // un navegador real siempre manda algo
  return BOTS.test(ua)
}

/**
 * @param {string} ua cabecera User-Agent cruda
 * @returns {{browser, browserVer, os, osVer, device, bot}}
 */
export function leerUA(ua = '') {
  const bot = esBot(ua)

  let browser = null
  let browserVer = null
  for (const [nombre, re] of NAVEGADORES) {
    const m = ua.match(re)
    if (m) { browser = nombre; browserVer = mayor(m[1] || m[2]); break }
  }

  let os = null
  let osVer = null
  for (const [nombre, re] of SISTEMAS) {
    const m = ua.match(re)
    if (m) {
      os = nombre
      osVer = nombre === 'Linux' ? null : mayor(m[1])
      if (nombre === 'Windows') osVer = WINDOWS[osVer] ?? osVer
      break
    }
  }

  // iPadOS 13+ se presenta como Macintosh. La pista que lo delata es que tiene
  // pantalla tactil, y eso solo se sabe desde el cliente; aqui se mira el UA de
  // Safari en iPad, que si conserva la palabra.
  let device = 'escritorio'
  if (/\biPad\b/i.test(ua) || (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua)) || /\bTablet\b/i.test(ua)) {
    device = 'tablet'
  } else if (/\bMobi|\biPhone\b|\biPod\b|\bAndroid\b|\bWindows Phone\b/i.test(ua)) {
    device = 'movil'
  }

  return {
    browser: corta(browser, 40),
    browserVer: corta(browserVer, 20),
    os: corta(os, 40),
    osVer: corta(osVer, 20),
    device,
    bot,
  }
}

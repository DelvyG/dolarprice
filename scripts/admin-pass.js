// Genera las dos lineas que hay que pegar en el .env del servidor para que el
// panel de /admin deje entrar.
//
//   npm run admin:pass
//
// Pide la contrasena sin mostrarla y sin que quede en el historial del shell.
// La contrasena en si no se guarda en ningun lado: solo su hash scrypt.

import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { hashear } from '../src/admin/auth.js'

function preguntar(texto) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })

    // Se intercepta la escritura para que no se vea lo que se teclea. El salto
    // de linea si tiene que pasar, o el cursor se queda pegado al prompt.
    let mudo = false
    const escribir = rl.output.write.bind(rl.output)
    rl.output.write = (trozo, ...resto) => {
      if (mudo && !String(trozo).includes('\n')) return true
      return escribir(trozo, ...resto)
    }

    rl.question(texto, (valor) => {
      rl.output.write = escribir
      rl.close()
      resolve(valor)
    })
    rl.on('SIGINT', () => { rl.close(); reject(new Error('cancelado')) })
    mudo = true
  })
}

const pass = (await preguntar('Contrasena nueva para el panel: ')).trim()
console.log()

if (pass.length < 10) {
  console.error('Muy corta. Minimo 10 caracteres: el panel esta expuesto en internet.')
  process.exit(1)
}

const repetir = (await preguntar('Reptela para confirmar:         ')).trim()
console.log()

if (pass !== repetir) {
  console.error('No coinciden. No se cambio nada.')
  process.exit(1)
}

const hash = await hashear(pass)
const secret = randomBytes(32).toString('hex')

console.log('Pega estas lineas en /var/www/dolarprice/.env y reinicia el servicio:')
console.log()
console.log(`ADMIN_PASS_HASH=${hash}`)
console.log(`ADMIN_SESSION_SECRET=${secret}`)
console.log()
console.log('  systemctl restart dolarprice')
console.log()
console.log('Si ya habia un ADMIN_SESSION_SECRET, cambiarlo cierra las sesiones abiertas.')
console.log('Para cambiar solo la contrasena, deja el secret que ya tenias.')

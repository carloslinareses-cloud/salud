/* Abre la pagina de verdad en Chrome, entra como administrador, crea un
   usuario desde el panel y comprueba que la persona nueva puede entrar sin
   haberse registrado. Al terminar lo borra.

   Esta es la unica prueba que necesita instalar algo, porque maneja un
   navegador de verdad:

       npm install puppeteer-core
       set FARMACIA_ADMIN_CLAVE=...        (Windows)
       export FARMACIA_ADMIN_CLAVE=...     (Git Bash)
       node pruebas/pantalla-usuarios.mjs

   Usa el Chrome que ya esta instalado; si esta en otro sitio, se le dice
   con la variable CHROME. */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('Falta el controlador del navegador. Instalalo con:  npm install puppeteer-core')
  process.exit(2)
}

// la raiz del sitio: la carpeta que contiene a pruebas/
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
// puerto libre que elija el sistema, para no chocar con nada
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ADMIN = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const CLAVE_ADMIN = process.env.FARMACIA_ADMIN_CLAVE
if (!CLAVE_ADMIN) {
  console.error('Falta la variable FARMACIA_ADMIN_CLAVE con la contrasena del administrador.')
  process.exit(2)
}

const MARCA = 'zzzui' + Math.floor(Date.now() / 1000).toString(36)
const CORREO = `${MARCA}@prueba.local`
const NOMBRE = 'Pedro Prueba Pantalla'

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }

const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  const f = path.join(RAIZ, p)
  if (!f.startsWith(path.resolve(RAIZ)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  res.end(fs.readFileSync(f))
})
await new Promise(r => servidor.listen(0, r))
const PUERTO = servidor.address().port
console.log(`servidor local en http://localhost:${PUERTO}`)

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + d) }
}

const navegador = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${process.cwd()}/perfil-chrome`],
})
const pag = await navegador.newPage()
await pag.setViewport({ width: 1280, height: 900 })

const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })

try {
  console.log('\n--- Entrar como administrador ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#formAcceso', { timeout: 15000 })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 20000 })

  const hayRegistro = await pag.$('#btnRegistro')
  prueba('ya NO existe el boton "Registrate aqui"', hayRegistro === null)
  const textoAviso = await pag.$eval('.registrarse', e => e.textContent.replace(/\s+/g, ' ').trim())
  prueba('avisa que las cuentas las crea el administrador',
    /administrador/i.test(textoAviso) && /no hay registro/i.test(textoAviso), textoAviso)

  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE_ADMIN)
  await Promise.all([pag.click('#btnEntrar'), pag.waitForSelector('#vistaPanel:not([hidden])', { timeout: 25000 })])
  const titulo = await pag.$eval('#tituloPanel', e => e.textContent)
  prueba('entra al panel del administrador', /administrador/i.test(titulo), titulo)

  console.log('\n--- Crear el usuario desde el panel ---')
  await pag.waitForSelector('[data-p="usuarios"]', { timeout: 15000 })
  await pag.click('[data-p="usuarios"]')
  await pag.waitForSelector('#uGuardar', { timeout: 20000 })

  const campos = await pag.evaluate(() => ({
    nombre: !!document.getElementById('uNombre'),
    correo: !!document.getElementById('uCorreo'),
    rol: !!document.getElementById('uRol'),
    clave: !!document.getElementById('uClave'),
    claveSugerida: (document.getElementById('uClave') || {}).value || '',
    opciones: [...document.querySelectorAll('#uRol option')].map(o => o.value),
  }))
  prueba('el formulario pide nombre, correo, puesto y contrasena',
    campos.nombre && campos.correo && campos.rol && campos.clave, JSON.stringify(campos))
  prueba('trae una contrasena sugerida', campos.claveSugerida.length >= 8, campos.claveSugerida)
  prueba('ofrece los tres puestos',
    JSON.stringify(campos.opciones) === JSON.stringify(['despacho', 'inventario', 'admin']),
    JSON.stringify(campos.opciones))

  const CLAVE_NUEVA = campos.claveSugerida
  await pag.type('#uNombre', NOMBRE)
  await pag.type('#uCorreo', CORREO)
  await pag.select('#uRol', 'inventario')
  await pag.click('#uGuardar')

  await pag.waitForFunction(
    () => /ya puede entrar|no se pudo|error/i.test((document.getElementById('avisoAdm') || {}).textContent || ''),
    { timeout: 30000 })
  const mensaje = await pag.$eval('#avisoAdm', e => e.textContent.trim())
  prueba('el panel dice que ya puede entrar', /ya puede entrar/i.test(mensaje), mensaje)

  await pag.waitForFunction(() => /Datos para entregarle/i.test(
    (document.getElementById('uResultado') || {}).textContent || ''), { timeout: 15000 })
  const credencial = await pag.$eval('#uResultado .credencial', e => e.innerText.trim())
  prueba('muestra el correo y la contrasena para entregarlos',
    credencial.includes(CORREO) && credencial.includes(CLAVE_NUEVA), credencial)

  const enLista = await pag.evaluate(n => document.body.innerText.includes(n), NOMBRE)
  prueba('aparece en la lista de quien puede entrar', enLista)

  console.log('\n--- La persona nueva entra sin haberse registrado ---')
  // en ventana aislada: si no, hereda la sesion del administrador y entra sola
  const aparte = await navegador.createBrowserContext()
  const pag2 = await aparte.newPage()
  await pag2.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag2.waitForSelector('#formAcceso', { timeout: 15000 })
  await pag2.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 20000 })
  await pag2.type('#correo', CORREO)
  await pag2.type('#clave', CLAVE_NUEVA)
  await pag2.click('#btnEntrar')
  // se espera a que pase ALGO: que entre, o que muestre el error. Asi la
  // prueba dice cual fue el problema en vez de solo agotar el tiempo.
  await pag2.waitForFunction(() => {
    const c = document.getElementById('vistaClave'), p = document.getElementById('vistaPanel')
    const e = document.getElementById('errorAcceso')
    return (c && !c.hidden) || (p && !p.hidden) || (e && !e.hidden)
  }, { timeout: 30000 })
  const estado2 = await pag2.evaluate(() => ({
    pideCambio: !document.getElementById('vistaClave').hidden,
    entroDirecto: !document.getElementById('vistaPanel').hidden,
    error: document.getElementById('errorAcceso').hidden ? '' : document.getElementById('errorAcceso').textContent.trim(),
  }))
  prueba('entra y le pide cambiar la contrasena', estado2.pideCambio,
    estado2.error || (estado2.entroDirecto ? 'entro sin pedirle cambiarla' : ''))
  await pag2.close(); await aparte.close()

  console.log('\n--- Limpieza: borrarlo desde el panel ---')
  pag.on('dialog', async d => { await d.accept() })
  await pag.click('[data-p="tablero"]')
  await pag.click('[data-p="usuarios"]')
  await pag.waitForSelector(`[data-borrar="${CORREO}"]`, { timeout: 20000 })
  await pag.click(`[data-borrar="${CORREO}"]`)
  await pag.waitForFunction(
    () => /ya no puede entrar|no se pudo/i.test((document.getElementById('avisoAdm') || {}).textContent || ''),
    { timeout: 25000 })
  const msgBorrar = await pag.$eval('#avisoAdm', e => e.textContent.trim())
  prueba('lo borra desde el panel', /ya no puede entrar/i.test(msgBorrar), msgBorrar)

  console.log('\n--- Errores de JavaScript en la pagina ---')
  const graves = errores.filter(e => !/favicon|404|net::ERR_/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.join(' | '))

} catch (e) {
  mal++
  fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: 'fallo.png' }); console.log('  captura en fallo.png') } catch {}
} finally {
  await navegador.close()
  servidor.close()
}

console.log('\n' + '='.repeat(60))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas de pantalla.`)

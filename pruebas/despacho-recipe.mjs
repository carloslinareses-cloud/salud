/* ENTREGAR → REGISTRAR POR RÉCIPE: ahora se pide la edad, no la fecha
   de nacimiento.

   Comprueba, manejando el navegador de verdad:
     · Que el formulario de "Por récipe" pide "Edad", no "Fecha de
       nacimiento".
     · Que la edad escrita a mano se guarda tal cual.
     · Que esa persona, ya en Personas, muestra esa edad -el dato no
       se pierde por no tener fecha de nacimiento-.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/despacho-recipe.mjs
*/
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

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ADMIN = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const CLAVE = process.env.FARMACIA_ADMIN_CLAVE
const TOKEN = process.env.SUPABASE_TOKEN
if (!CLAVE) { console.error('Falta FARMACIA_ADMIN_CLAVE.'); process.exit(2) }
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN (hace falta para limpiar al final).'); process.exit(2) }

const REF = 'tfbzghjjfcaqmkzsxrrs'
const MARCA = Math.floor(Date.now() / 1000).toString(36).toUpperCase()
const PAC = 'ZZZ RECIPE EDAD ' + MARCA
const CEDULA = String(9400000 + (Date.now() % 599999)).slice(0, 8)

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + d) }
}

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { error: t } }
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
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
await new Promise((r) => servidor.listen(0, r))
const PUERTO = servidor.address().port

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-recipe-edad`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
pag.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
pag.on('dialog', (d) => d.accept())

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  console.log('='.repeat(64))
  console.log('ENTREGAR → POR RÉCIPE: AHORA SE PIDE LA EDAD')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir Entregar → Por récipe ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="despacho"]')
  await espera(500)
  await pag.waitForSelector('[data-via="recipe"]', { timeout: 20000 })
  await pag.click('[data-via="recipe"]')
  await pag.waitForSelector('#guardarPac', { timeout: 20000 })

  const rotulo = await pag.$eval('label[for="nEdad"]', (e) => e.textContent)
  prueba('el formulario pide "Edad"', /edad/i.test(rotulo), rotulo)
  prueba('ya no pide "Fecha de nacimiento"', !(await pag.$('#nFecha')), '')

  console.log('\n--- 2. Registrar con la edad escrita a mano ---')
  await pag.type('#nCedula', CEDULA)
  await pag.type('#nNombre', PAC)
  await pag.click('#nSexo [data-s="F"]')
  await pag.type('#nEdad', '2 años, 8 meses')
  await pag.click('#guardarPac')
  await pag.waitForFunction(
    (n) => ((document.getElementById('formDestino') || {}).innerText || '').includes(n) ||
           ((document.getElementById('zonaDestino') || {}).innerText || '').includes(n),
    { timeout: 25000 }, PAC)
  const huboError = await pag.$eval('#errPac', (e) => !e.hidden).catch(() => false)
  prueba('se registra sin error', !huboError, '')

  const enBase = await sql(`select edad_texto, fecha_nac from farmacia.pacientes where nombre = '${PAC}';`)
  prueba('la edad quedó guardada tal cual', enBase[0]?.edad_texto === '2 años, 8 meses', JSON.stringify(enBase[0]))
  prueba('y no se inventó una fecha de nacimiento', enBase[0]?.fecha_nac == null, JSON.stringify(enBase[0]))

  console.log('\n--- 3. Esa edad se ve en Personas, aunque no haya fecha de nacimiento ---')
  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.click('#zona-inventario [data-p="personas"]')
  await pag.waitForSelector('#peBusca', { timeout: 25000 })
  await pag.type('#peBusca', PAC)
  await pag.waitForFunction(
    (n) => (document.getElementById('peRes') || {}).innerText.includes(n),
    { timeout: 20000 }, PAC)
  const enLista = await pag.$eval('#peRes .ficha', (e) => e.innerText)
  prueba('en la lista se ve su edad', enLista.includes('2 años, 8 meses'), enLista)

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-despacho-recipe.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-recipe-edad', { recursive: true, force: true })
}

console.log('\n--- Limpieza ---')
await sql(`delete from farmacia.pacientes where nombre = '${PAC}';`)
const quedan = await sql(`select count(*) n from farmacia.pacientes where nombre like 'ZZZ RECIPE EDAD%';`)
prueba('no deja nada suyo en la base', Number(quedan[0]?.n) === 0, JSON.stringify(quedan[0]))

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas.`)
}

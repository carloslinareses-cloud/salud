/* EL DASHBOARD: las cifras de toda la farmacia.

   Comprueba, manejando el navegador de verdad:

     · Que está en Mercancía, como su propia pestaña.
     · Que las cuatro secciones -Personas, Jornadas, Centros, Lo
       entregado- cargan con números de verdad, no en blanco.
     · Que el selector Día / Semana / Mes de verdad cambia el tamaño
       de la tabla de tendencia (14, 8 y 6 renglones).
     · Que se puede descargar en Excel y en PDF.

   No registra ni borra nada -es de solo lectura-, así que no hace
   falta limpieza al final.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       node pruebas/dashboard.mjs
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
if (!CLAVE) { console.error('Falta FARMACIA_ADMIN_CLAVE.'); process.exit(2) }

const BAJADAS = path.join(RAIZ, 'bajadas-dashboard')

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + d) }
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

fs.rmSync(BAJADAS, { recursive: true, force: true })
fs.mkdirSync(BAJADAS, { recursive: true })

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-dashboard`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
pag.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()) })

const cdp = await pag.createCDPSession()
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAJADAS })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const esperaArchivo = async (re, ms = 30000) => {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    const f = fs.readdirSync(BAJADAS).filter((x) => re.test(x) && !x.endsWith('.crdownload'))
    if (f.length) { await espera(800); return f[0] }
    await espera(400)
  }
  return null
}
const sinCargando = () => pag.waitForFunction(
  () => !/Contando personas/i.test((document.getElementById('daZona') || {}).innerText || ''),
  { timeout: 30000 })

try {
  console.log('='.repeat(64))
  console.log('DASHBOARD: LAS CIFRAS DE TODA LA FARMACIA')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir el Dashboard, dentro de Mercancía ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })

  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.waitForSelector('#zona-inventario [data-p="dashboard"]', { timeout: 20000 })
  prueba('la pestaña Dashboard existe en Mercancía', true)

  await pag.click('#zona-inventario [data-p="dashboard"]')
  await pag.waitForSelector('#daVista', { timeout: 20000 })
  await sinCargando()
  prueba('carga las cuatro secciones', true)

  const texto = await pag.$eval('#daZona', (e) => e.innerText)
  prueba('sale la sección de Personas', /Personas registradas/i.test(texto), texto.slice(0, 80))
  prueba('sale la sección de Jornadas', /Jornadas y ruta materna/i.test(texto), '')
  prueba('sale la sección de Centros', /Centros de salud/i.test(texto), '')
  prueba('sale la sección de Lo entregado', /Lo entregado/i.test(texto), '')

  console.log('\n--- 2. Los números son de verdad, no ceros en blanco ---')
  const cifras = await pag.$$eval('#daZona .cifras .cifra b', (bs) => bs.map((b) => b.textContent.trim()))
  prueba('hay varias cifras pintadas', cifras.length >= 15, 'cifras: ' + cifras.length)
  const totalPersonas = await pag.$eval('#daZona .cifras .cifra b', (b) => Number(b.textContent.replace(/\D/g, '')))
  prueba('el total de personas registradas es un número real, mayor que cero', totalPersonas > 0, String(totalPersonas))

  console.log('\n--- 3. El selector Día / Semana / Mes cambia el tamaño de la tendencia ---')
  await pag.waitForFunction(
    () => document.querySelectorAll('#daZona .tabla-caja table tbody tr').length > 0,
    { timeout: 20000 })
  const conteosPorVista = {}
  for (const v of ['dia', 'semana', 'mes']) {
    await pag.click(`#daVista [data-v="${v}"]`)
    await sinCargando()
    await espera(200)
    // La tabla de tendencia de Personas es la primera tabla que aparece.
    conteosPorVista[v] = await pag.$eval('#daZona .tabla-caja table tbody', (tb) => tb.querySelectorAll('tr').length)
  }
  prueba('por día trae 14 renglones', conteosPorVista.dia === 14, JSON.stringify(conteosPorVista))
  prueba('por semana trae 8 renglones', conteosPorVista.semana === 8, JSON.stringify(conteosPorVista))
  prueba('por mes trae 6 renglones', conteosPorVista.mes === 6, JSON.stringify(conteosPorVista))

  console.log('\n--- 4. Se descarga en Excel y en PDF ---')
  await pag.click('#daExcel')
  const xls = await esperaArchivo(/\.xlsx$/i)
  prueba('el Excel se descarga', !!xls, String(xls))
  if (xls) {
    const tam = fs.statSync(path.join(BAJADAS, xls)).size
    prueba('y no viene vacío', tam > 6000, tam + ' bytes')
  }

  await pag.click('#daPdf')
  const pdf = await esperaArchivo(/\.pdf$/i)
  prueba('el PDF se descarga', !!pdf, String(pdf))
  if (pdf) {
    const cab = fs.readFileSync(path.join(BAJADAS, pdf)).subarray(0, 5).toString('latin1')
    prueba('y es un PDF de verdad', cab === '%PDF-', cab)
  }

  console.log('\n--- 5. En una pantalla de teléfono ---')
  await pag.setViewport({ width: 375, height: 780 })
  await espera(600)
  const ancho = await pag.evaluate(() => ({
    doc: document.documentElement.scrollWidth, vista: window.innerWidth
  }))
  prueba('no hay que arrastrar de lado', ancho.doc <= ancho.vista + 1, JSON.stringify(ancho))
  await pag.setViewport({ width: 1280, height: 950 })

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-dashboard.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-dashboard', { recursive: true, force: true })
}

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas del dashboard.`)
}

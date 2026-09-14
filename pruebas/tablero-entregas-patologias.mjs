/* Prueba de extremo a extremo del dashboard "Por patología" dentro
   de Lo entregado (Farmacia). Necesita Chrome real y la clave del admin.

       export FARMACIA_ADMIN_CLAVE=...
       node pruebas/tablero-entregas-patologias.mjs
*/
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ADMIN = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const CLAVE = process.env.FARMACIA_ADMIN_CLAVE
if (!CLAVE) { console.error('Falta FARMACIA_ADMIN_CLAVE.'); process.exit(2) }

const BAJADAS = path.join(RAIZ, 'bajadas-patologias')

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
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-patologias`],
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

try {
  console.log('='.repeat(64))
  console.log('LO ENTREGADO: DASHBOARD POR PATOLOGÍA')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir Lo entregado, con todo el histórico ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.click('#zona-inventario [data-p="entregas"]')
  await pag.waitForSelector('.chips button[data-per]', { timeout: 25000 })
  // Un rango bien amplio para que aparezca algo con patología, sea lo que sea que haya en la base.
  await pag.click('.chips button[data-per="rango"]')
  await pag.waitForSelector('input[type="date"]', { timeout: 10000 })
  const inputs = await pag.$$('input[type="date"]')
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type('2020-01-01')
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type('2026-12-31')
  await pag.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Ver el período/.test(b.textContent)).click()
  })
  await pag.waitForFunction(() => !document.querySelector('.cargando'), { timeout: 30000 })

  const textoTablero = await pag.$eval('body', (e) => e.innerText)
  prueba('cargó el tablero de entregas sin quedarse en "Contando…"', !/Contando las entregas/.test(textoTablero))

  console.log('\n--- 2. El dashboard "Por patología" aparece cuando hay datos ---')
  await pag.waitForFunction(() => {
    var b = document.body.innerText;
    return /Por patología, niños y adultos/.test(b) || /No hubo entregas/.test(b);
  }, { timeout: 15000 })
  const hayPatologia = /Por patología, niños y adultos/.test(await pag.$eval('body', e => e.innerText))
  prueba('la sección "Por patología, niños y adultos" está en la pantalla', hayPatologia)
  if (hayPatologia) {
    const textoPat = await pag.$eval('body', e => e.innerText)
    prueba('trae también "Qué se entregó, por patología"', /Qué se entregó, por patología/.test(textoPat))
    prueba('las columnas de Niños y Adultos están separadas', /Niños, unidades/i.test(textoPat) && /Adultos, unidades/i.test(textoPat))
  }

  console.log('\n--- 3. El Excel trae las hojas nuevas ---')
  await pag.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Descargar en Excel/.test(b.textContent)).click()
  })
  const xls = await esperaArchivo(/\.xlsx$/i)
  prueba('el Excel se descarga', !!xls, String(xls))

  console.log('\n--- 4. El PDF se genera sin reventar ---')
  fs.readdirSync(BAJADAS).forEach(f => fs.rmSync(path.join(BAJADAS, f)))
  await pag.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Descargar en PDF/.test(b.textContent)).click()
  })
  const pdf = await esperaArchivo(/\.pdf$/i)
  prueba('el PDF se descarga', !!pdf, String(pdf))

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 5).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-patologias.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-patologias', { recursive: true, force: true })
  fs.rmSync(BAJADAS, { recursive: true, force: true })
}

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas.`)
}

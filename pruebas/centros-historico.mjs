/* LO QUE YA PASÓ, DEL CUADERNO VIEJO: cada insumo, uno por uno.

   Es de solo lectura -no crea ni borra nada-: comprueba que las
   entregas históricas migradas de "REGISTRO DE ENTREGAS C.D.S" se ven
   en la ficha del centro real, con cada insumo separado, pero SIN una
   cantidad inventada por insumo -el cuaderno solo daba un total para
   el renglón entero-.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       node pruebas/centros-historico.mjs
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

const CENTRO = 'CDI MAMA PANCHA'   // el que más entregas del cuaderno tiene, real
const BAJADAS = path.join(RAIZ, 'bajadas-centros-historico')

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
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-centros-historico`],
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
  console.log('CENTROS: LO HISTÓRICO DEL CUADERNO, INSUMO POR INSUMO')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir la ficha real de ' + CENTRO + ' ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.click('#zona-inventario [data-p="centros"]')
  await pag.waitForSelector('#ceBusca', { timeout: 25000 })
  await pag.type('#ceBusca', CENTRO)
  /* Sin esperar a que el filtro de verdad haya corrido, "CDI MAMA
     PANCHA" ya aparece en la lista completa sin filtrar -que trae
     todos los centros- y se toca el primero, que es otro. */
  await pag.waitForFunction(
    (n) => {
      var f = document.querySelectorAll('#ceRes .ficha')
      return f.length === 1 && f[0].innerText.includes(n)
    },
    { timeout: 20000 }, CENTRO)
  await pag.click('#ceRes .ficha')
  await pag.waitForSelector('#ceIrEntregar', { timeout: 20000 })
  await pag.waitForFunction(
    () => /Del cuaderno/i.test((document.getElementById('ceZona') || {}).innerText || ''),
    { timeout: 20000 })

  const ficha = await pag.$eval('#ceZona', (e) => e.innerText)
  prueba('aparece la sección de lo histórico del cuaderno', /Del cuaderno/i.test(ficha), '')
  prueba('trae al menos un insumo real separado (ej: JERINGA)', /JERINGA/i.test(ficha), '')
  prueba('dice explícito que la cantidad no se repartió por insumo',
    /sin desglose por unidad|sin cantidad|repartida entre/i.test(ficha), '')
  prueba('trae una fecha de enero -las que antes no se veían en ningún lado-', /29\/01/.test(ficha), '')

  console.log('\n--- 2. También sale en el Excel ---')
  await pag.click('#ceExcel')
  const xls = await esperaArchivo(/\.xlsx$/i)
  prueba('el Excel se descarga', !!xls, String(xls))

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-centros-historico.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-centros-historico', { recursive: true, force: true })
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

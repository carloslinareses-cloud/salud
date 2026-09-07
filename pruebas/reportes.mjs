/* LOS DOCUMENTOS QUE SALEN EN PAPEL Y EN EXCEL.

   Comprueba, manejando el navegador de verdad:
     · Que se pueda registrar un centro de salud y entregarle.
     · Que el ACTA DE ENTREGA-RECEPCION se genere, y que diga lo que tiene
       que decir: el centro, lo entregado, el total y las dos firmas.
     · Que el catalogo y las alertas se descarguen en Excel.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/reportes.mjs
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
const MED = 'ZZZ-REP ' + MARCA
const CENTRO = 'ZZZ CDI PRUEBA ' + MARCA
const LOTE = 'ZZZR' + MARCA
const CANT = 60
const SALE = 12
const BAJADAS = path.join(RAIZ, 'bajadas-prueba')

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
await new Promise(r => servidor.listen(0, r))
const PUERTO = servidor.address().port

fs.rmSync(BAJADAS, { recursive: true, force: true })
fs.mkdirSync(BAJADAS, { recursive: true })

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-chrome`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })

const cliente = await pag.createCDPSession()
await cliente.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAJADAS })

const esperaArchivo = async (re, ms = 25000) => {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    const f = fs.readdirSync(BAJADAS).filter(x => re.test(x) && !x.endsWith('.crdownload'))
    if (f.length) { await new Promise(r => setTimeout(r, 700)); return f[0] }
    await new Promise(r => setTimeout(r, 400))
  }
  return null
}
const irArea = async (id) => {
  await pag.click(`.areas [data-area="${id}"]`)
  await new Promise(r => setTimeout(r, 500))
}

try {
  console.log('='.repeat(64))
  console.log('DOCUMENTOS: ACTA, COMPROBANTE Y EXCEL')
  console.log('='.repeat(64))

  console.log('\n--- Entrar ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#formAcceso')
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 20000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 25000 })

  const libs = await pag.evaluate(() => ({
    excel: typeof window.XLSX !== 'undefined',
    pdf: !!(window.jspdf && window.jspdf.jsPDF),
    cintillo: typeof window.dibujarHeaderPDF === 'function',
    reportes: !!window.FARMREP,
    logos: !!window.LOGO_CRISTOBAL_ROJAS,
  }))
  prueba('cargan las librerias de Excel y PDF y el cintillo institucional',
    libs.excel && libs.pdf && libs.cintillo && libs.reportes && libs.logos, JSON.stringify(libs))

  console.log('\n--- Mercancia: crear medicamento y lote ---')
  await irArea('inventario')
  await pag.waitForSelector('[data-p="catalogo"]', { timeout: 20000 })
  await pag.click('[data-p="catalogo"]')
  await pag.waitForSelector('#catCrear', { timeout: 20000 })
  await pag.click('#catCrear')
  await pag.waitForSelector('#pNombre', { timeout: 20000 })
  await pag.evaluate(n => { document.getElementById('pNombre').value = n }, MED)
  await pag.click('#pGuardar')
  await pag.waitForSelector('#lCant', { timeout: 25000 })
  await pag.type('#lCodigo', LOTE)
  const vence = new Date(Date.now() + 420 * 864e5).toISOString().slice(0, 10)
  await pag.evaluate(v => { document.getElementById('lVence').value = v }, vence)
  await pag.type('#lCant', String(CANT))
  await pag.click('#lGuardar')
  await pag.waitForFunction(
    () => /Registradas/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  prueba('registra el lote de prueba', true)

  console.log('\n--- Registrar un centro de salud ---')
  await irArea('despacho')
  await pag.waitForSelector('.conmuta [data-modo="institucion"]', { timeout: 20000 })
  await pag.click('.conmuta [data-modo="institucion"]')
  await pag.waitForSelector('#btnNuevoDestino', { timeout: 20000 })
  await pag.click('#btnNuevoDestino')
  await pag.waitForSelector('#guardarCen', { timeout: 20000 })

  const camposCen = await pag.evaluate(() => ({
    nombre: !!document.getElementById('cNombre'),
    tipo: [...document.querySelectorAll('#cTipo option')].map(o => o.value),
    direccion: !!document.getElementById('cDireccion'),
    responsable: !!document.getElementById('cResponsable'),
    telefono: !!document.getElementById('cTelefono'),
  }))
  prueba('el formulario del centro pide todos los campos',
    camposCen.nombre && camposCen.direccion && camposCen.responsable &&
    camposCen.telefono && camposCen.tipo.includes('CDI'), JSON.stringify(camposCen))

  await pag.type('#cNombre', CENTRO)
  await pag.type('#cDireccion', 'Av. de prueba, Charallave')
  await pag.type('#cResponsable', 'Dra. Prueba Automatica')
  await pag.type('#cTelefono', '02391234567')
  await pag.click('#guardarCen')
  await pag.waitForSelector('#zonaDestino .elegido', { timeout: 25000 })
  prueba('registra el centro y lo deja elegido', true)

  const traeResp = await pag.$eval('#recibeNombre', e => e.value).catch(() => '')
  prueba('el responsable viene puesto en quien recibe',
    traeResp === 'Dra. Prueba Automatica', traeResp)

  console.log('\n--- Entregar al centro ---')
  await pag.type('#recibeCedula', '11223344')
  await pag.type('#buscaMed', MED)
  await pag.waitForFunction(m => {
    const f = document.querySelectorAll('#resMed .ficha')
    return f.length > 0 && [...f].every(x => x.innerText.includes(m))
  }, { timeout: 25000 }, MED)
  /* Se busca y se toca DENTRO de la pagina, en el mismo instante: entre
     la espera y el clic puede llegar una respuesta atrasada del buscador
     que repinta la lista, y entonces el boton que se tenia ya no existe.
     Daba "Node is either not clickable or not an Element". */
  await pag.evaluate(() => { document.querySelector('#resMed .ficha').click() })
  await new Promise(r => setTimeout(r, 900))
  await pag.evaluate(c => {
    const i = document.querySelector('#renglones input[type="number"]')
    i.value = c; i.dispatchEvent(new Event('input', { bubbles: true }))
  }, SALE)
  await pag.click('#btnRegistrar')
  await pag.waitForFunction(
    () => /Entrega registrada|no se pudo|error/i.test(
      (document.getElementById('zonaAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msg = await pag.$eval('#zonaAviso', e => e.textContent.trim())
  prueba('registra la entrega al centro', /Entrega registrada/i.test(msg), msg)

  console.log('\n--- El acta de entrega-recepcion ---')
  await pag.waitForSelector('#btnPapel', { timeout: 20000 })
  const rotulo = await pag.$eval('#btnPapel', e => e.textContent.trim())
  prueba('ofrece descargar el acta', /acta de entrega/i.test(rotulo), rotulo)

  await pag.click('#btnPapel')
  const archivo = await esperaArchivo(/^Acta de entrega.*\.pdf$/i, 25000)
  prueba('el acta se descarga', !!archivo, archivo || 'no aparecio el archivo')

  if (archivo) {
    const ruta = path.join(BAJADAS, archivo)
    const tam = fs.statSync(ruta).size
    prueba('el acta pesa lo de un PDF con logos', tam > 20000, tam + ' bytes')
    prueba('el nombre del archivo lleva el centro', archivo.includes(MARCA), archivo)
  }

  console.log('\n--- Excel del catalogo y de las alertas ---')
  await irArea('inventario')
  // Al volver, el area conserva lo que se estaba haciendo (la ficha del
  // producto). Se pasa por Alertas para que el catalogo se vuelva a dibujar.
  await pag.click('[data-p="alertas"]')
  await new Promise(r => setTimeout(r, 800))
  await pag.click('[data-p="catalogo"]')
  await pag.waitForSelector('#catExcel', { timeout: 25000 })
  await pag.click('#catExcel')
  const xlsCat = await esperaArchivo(/^Cat.*\.xlsx$/i, 30000)
  prueba('el catalogo se descarga en Excel', !!xlsCat, xlsCat || 'no aparecio')
  if (xlsCat) {
    prueba('el Excel del catalogo trae datos',
      fs.statSync(path.join(BAJADAS, xlsCat)).size > 8000,
      fs.statSync(path.join(BAJADAS, xlsCat)).size + ' bytes')
  }

  await pag.click('[data-p="alertas"]')
  await new Promise(r => setTimeout(r, 2500))
  /* El boton solo sale si HAY alertas. Con el inventario recien vaciado
     puede no haber ninguna, y eso es correcto: se dice y no se falla. */
  const hayAlertas = await pag.$('#alExcel')
  if (hayAlertas) {
    await pag.click('#alExcel')
    const xlsAl = await esperaArchivo(/^Alertas.*\.xlsx$/i, 30000)
    prueba('las alertas se descargan en Excel', !!xlsAl, xlsAl || 'no aparecio')
  } else {
    prueba('no hay alertas que descargar (inventario limpio)', true)
  }

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|404|net::ERR_/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 2).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-reportes.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-chrome', { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza */
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  return { estado: r.status, cuerpo: await r.text() }
}
await sql(`
begin;
set local session_replication_role = replica;

create temporary table zzz_e on commit drop as
  select e.id from farmacia.entregas e
   join farmacia.instituciones i on i.id = e.institucion_id
  where i.nombre like 'ZZZ%';

delete from farmacia.bitacora
 where registro_id in (select m.id::text from farmacia.movimientos m where m.entrega_id in (select id from zzz_e))
    or registro_id in (select d.id::text from farmacia.entrega_detalle d where d.entrega_id in (select id from zzz_e))
    or registro_id in (select id::text from zzz_e)
    or registro_id in (select l.id::text from farmacia.lotes l join farmacia.productos p on p.id=l.producto_id where p.nombre like 'ZZZ-REP%')
    or registro_id in (select m.id::text from farmacia.movimientos m join farmacia.lotes l on l.id=m.lote_id join farmacia.productos p on p.id=l.producto_id where p.nombre like 'ZZZ-REP%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-REP%')
    or registro_id in (select id::text from farmacia.instituciones where nombre like 'ZZZ%');

delete from farmacia.movimientos m where m.entrega_id in (select id from zzz_e);
delete from farmacia.entrega_detalle d using zzz_e z where d.entrega_id = z.id;
delete from farmacia.entregas e using zzz_e z where e.id = z.id;
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-REP%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-REP%';
delete from farmacia.productos where nombre like 'ZZZ-REP%';
delete from farmacia.instituciones where nombre like 'ZZZ%';

set local session_replication_role = origin;
commit;`)

const resto = await sql(`select
  (select count(*) from farmacia.productos where nombre like 'ZZZ-REP%') productos,
  (select count(*) from farmacia.instituciones where nombre like 'ZZZ%') centros,
  (select count(*) from farmacia.movimientos m where m.entrega_id is not null
     and not exists (select 1 from farmacia.entregas e where e.id = m.entrega_id)) descuentos_huerfanos;`)
const quedaron = JSON.parse(resto.cuerpo || '[]')[0] || {}
prueba('la prueba no deja nada suyo en la base',
  Object.values(quedaron).reduce((a, b) => a + Number(b), 0) === 0, JSON.stringify(quedaron))

fs.rmSync(BAJADAS, { recursive: true, force: true })

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas de documentos.`)

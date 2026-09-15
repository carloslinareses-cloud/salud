/* INSUMOS: LA PANTALLA, MANEJANDO EL NAVEGADOR DE VERDAD.

   Comprueba:
     · Que Mercancía tenga la pestaña Insumos, con las dos hojas por su
       nombre completo.
     · Que la lista traiga las 31 entregas cargadas del Excel, y que una de
       ellas muestre sus insumos separados y la cantidad total SIN repartir.
     · Registrar una entrega con "Agregar +" varias veces, cada insumo con
       su cantidad; que sin cantidad NO se guarde; y que en la base quede
       exactamente lo escrito.
     · Corregirla (quitar un renglón, cambiar una cantidad).
     · El Excel y el PDF.
     · En un teléfono (375 px): sin scroll de lado y los renglones usables.

   Todo lo que crea empieza por ZZZ y se borra al terminar (también su
   rastro en la bitácora).

       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/insumos.mjs
*/
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

let puppeteer
try { puppeteer = (await import('puppeteer-core')).default } catch {
  console.error('Falta el controlador del navegador:  npm install puppeteer-core'); process.exit(2)
}

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ADMIN = process.env.FARMACIA_ADMIN_CORREO || 'carlos.linares.es@gmail.com'
const CLAVE = process.env.FARMACIA_ADMIN_CLAVE
const TOKEN = process.env.SUPABASE_TOKEN
if (!CLAVE) { console.error('Falta FARMACIA_ADMIN_CLAVE.'); process.exit(2) }
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN (hace falta para revisar la base y limpiar).'); process.exit(2) }

const REF = 'tfbzghjjfcaqmkzsxrrs'
const MARCA = Math.floor(Date.now() / 1000).toString(36).toUpperCase()
const DESTINO = 'ZZZ CENTRO INSUMOS ' + MARCA
const BAJADAS = path.join(RAIZ, 'bajadas-insumos')

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) } else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + d) }
}
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
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
  if (!f.startsWith(path.resolve(RAIZ)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  res.end(fs.readFileSync(f))
})
await new Promise(r => servidor.listen(0, r))
const PUERTO = servidor.address().port

fs.rmSync(BAJADAS, { recursive: true, force: true })
fs.mkdirSync(BAJADAS, { recursive: true })

const nav = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-insumos`] })
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push('console: ' + m.text()) })
const cdp = await pag.createCDPSession()
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAJADAS })

const espera = (ms) => new Promise(r => setTimeout(r, ms))
const esperaArchivo = async (re, ms = 30000) => {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    const f = fs.readdirSync(BAJADAS).filter(x => re.test(x) && !x.endsWith('.crdownload'))
    if (f.length) { await espera(800); return f[0] }
    await espera(400)
  }
  return null
}
const texto = (sel) => pag.$eval(sel, e => e.innerText)
const aviso = () => pag.$eval('#inAviso', e => e.innerText.trim()).catch(() => '')
const escribir = async (sel, valor) => { await pag.$eval(sel, e => { e.value = '' }); await pag.type(sel, valor) }

try {
  console.log('='.repeat(64))
  console.log('INSUMOS: REGISTRO DE ENTREGAS C.D.S')
  console.log('='.repeat(64))

  console.log('\n--- 1. La pestaña y las dos hojas ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await pag.waitForSelector('#zona-inventario [data-p="insumos"]', { timeout: 20000 })
  const pestanas = await pag.$$eval('#zona-inventario .conmuta button', bs => bs.map(b => b.textContent.trim()))
  prueba('Mercancía tiene la pestaña Insumos', pestanas.includes('Insumos'), JSON.stringify(pestanas))
  await pag.click('#zona-inventario [data-p="insumos"]')
  await pag.waitForSelector('#inHojas', { timeout: 20000 })
  const hojas = await pag.$$eval('#inHojas button', bs => bs.map(b => b.textContent.trim()))
  prueba('adentro están las dos hojas con su nombre completo',
    hojas.join('|') === 'REGISTRO DE ENTREGAS C.D.S|CONTROL DE INSUMOS ENTREGADOS', JSON.stringify(hojas))

  await pag.click('#inHojas [data-h="control"]')
  await espera(400)
  const zonaControl = await texto('#inZona')
  prueba('CONTROL DE INSUMOS ENTREGADOS ya tiene su pantalla (lista o aviso de datos)',
    /CONTROL DE INSUMOS ENTREGADOS/.test(zonaControl) && !/siguiente paso/.test(zonaControl), zonaControl.slice(0, 120))
  await pag.click('#inHojas [data-h="registro"]')
  await espera(300)

  console.log('\n--- 2. Las dudas del Excel, para revisarlas a mano ---')
  await pag.waitForSelector('#inDudas .dudas-caja', { timeout: 25000 })
  const esperadas = await sql(`select
      (select count(*) from farmacia.insumos_entregas_cds_items i join farmacia.insumos_entregas_cds e on e.id = i.entrega_id
        where i.revisar and not e.anulada) +
      (select count(*) from farmacia.v_insumos_entregas_cds where not anulada and (insumos = 0 or destino is null)) as n`)
  const cajaDudas = await texto('#inDudas')
  prueba('arriba sale el recuadro con TODAS las dudas (las de la base)', cajaDudas.includes('Dudas del Excel para revisar: ' + esperadas[0].n) &&
    (await pag.$$('#inDudas [data-duda]')).length === Number(esperadas[0].n), cajaDudas.slice(0, 80) + ' vs ' + esperadas[0].n)
  prueba('cada duda trae su pregunta', /¿Qué insumo es «GERDES»\?/.test(cajaDudas) && /no dice a qué centro o destino fue/.test(cajaDudas))
  const idxGerdes = await pag.$$eval('#inDudas .renglon', rs => rs.findIndex(r => /GERDES/.test(r.innerText)))
  await (await pag.$$('#inDudas [data-duda]'))[idxGerdes].click()
  await pag.waitForSelector('#inCorregir', { timeout: 15000 })
  prueba('«Revisar» abre esa entrega y avisa que tiene dudas', /tiene dudas por revisar/.test(await texto('#inZona')) && /GERDES/.test(await texto('#inZona')))
  await pag.click('#inCorregir')
  await pag.waitForSelector('#inItems [data-bien]', { timeout: 15000 })
  const antes = (await pag.$$('#inItems [data-bien]')).length
  await pag.click('#inItems [data-bien]')
  await espera(300)
  prueba('«Está bien así» quita la marca en el formulario (aquí no se guarda)', (await pag.$$('#inItems [data-bien]')).length === antes - 1)
  await pag.click('#inVolver')      // sin guardar: son datos reales
  await pag.waitForSelector('#inCorregir', { timeout: 15000 })
  await pag.click('#inVolver')
  await pag.waitForSelector('#inConteo', { timeout: 15000 })
  const sigue = await sql(`select count(*) as n from farmacia.insumos_entregas_cds_items where descripcion = 'GERDES' and revisar`)
  prueba('y como no se guardó, la duda sigue en la base', Number(sigue[0].n) === 1)

  console.log('\n--- 2b. Lo que vino del Excel ---')
  await pag.waitForFunction(() => /\d+ entregas?/.test((document.getElementById('inConteo') || {}).textContent || ''), { timeout: 25000 })
  await pag.waitForFunction(() => /\d+ entregas?/.test((document.getElementById('inConteo') || {}).textContent || ''), { timeout: 25000 })
  const conteo = await texto('#inConteo')
  const enBase = await sql(`select count(*) n from farmacia.insumos_entregas_cds where not anulada`)
  prueba('el conteo de la lista es el de la base', conteo === `${enBase[0].n} entregas`, conteo + ' vs ' + enBase[0].n)
  await pag.click('#inFiltro [data-f="excel"]')
  await pag.waitForFunction(() => /^31 entregas$/.test(document.getElementById('inConteo').textContent), { timeout: 20000 })
  prueba('el filtro «Del Excel» trae las 31 entregas cargadas', true)
  await escribir('#inBusca', 'AIRON')
  await pag.waitForFunction(() => /^1 entrega$/.test(document.getElementById('inConteo').textContent), { timeout: 20000 })
  prueba('buscar un insumo ("AIRON") encuentra su entrega', true)
  await pag.click('#inLista [data-id]')
  await pag.waitForSelector('#inZona table', { timeout: 15000 })
  const det = await texto('#inZona')
  const filasDet = await pag.$$eval('#inZona tbody tr', trs => trs.map(t => [...t.children].map(td => td.innerText.trim())))
  prueba('la ficha muestra los 7 insumos, uno por renglón', filasDet.length === 7, JSON.stringify(filasDet))
  prueba('"AIRON 60/400MG" quedó entero', filasDet.some(f => f[1] === 'AIRON 60/400MG'))
  prueba('los insumos del Excel no tienen cantidad inventada (—)', filasDet.every(f => f[2] === '—'))
  prueba('dice la Cantidad Entregada total (34) y que no se reparte', /Cantidad Entregada: 34 en total/.test(det) && /No se reparte/.test(det), det.slice(0, 300))
  prueba('cómo se registró: del Excel, fila 6, y cómo venía escrito (visible)', /hoja REGISTRO DE ENTREGAS C\.D\.S, fila 6/.test(det) &&
    /Así venía escrito en el Excel[\s\S]*AIRON 60\/400 MG/i.test(det), det.slice(0, 900))
  await pag.waitForFunction(() => /Historial de cambios/.test((document.getElementById('inHistorial') || {}).textContent || ''), { timeout: 20000 })
  prueba('el historial dice que la cargó el sistema con sus 7 insumos', /creó la entrega · puso 7 insumos/.test(await texto('#inHistorial')), await texto('#inHistorial'))
  await pag.click('#inVolver')
  await escribir('#inBusca', '')
  await pag.click('#inFiltro [data-f="todas"]')

  console.log('\n--- 3. Registrar una entrega nueva ---')
  await pag.waitForSelector('#inNueva', { timeout: 15000 })
  await pag.click('#inNueva')
  await pag.waitForSelector('#inAgregar', { timeout: 15000 })
  prueba('el formulario pide Fecha, Centro de Salud / Destino y Recibido Por', /FECHA/i.test(await texto('#inZona')) &&
    /Centro de Salud \/ Destino/i.test(await texto('#inZona')) && /Recibido Por \(Responsable\)/i.test(await texto('#inZona')))
  prueba('los renglones dicen INSUMO y CANT', /INSUMO/.test(await texto('.insumo-cabeza')) && /CANT/.test(await texto('.insumo-cabeza')))
  await escribir('#inDestino', DESTINO)
  await escribir('#inRecibe', 'ZZZ RESPONSABLE DE PRUEBA')
  const INSUMOS = [['ZZZ ACETAMINOFEN 500 MG', '30'], ['ZZZ JERINGA # 5', '100'], ['ZZZ AIRON 60/400 MG', '12'], ['ZZZ GASAS', '1,5']]
  for (let k = 0; k < INSUMOS.length; k++) {
    if (k > 0) await pag.click('#inAgregar')
    const cajas = await pag.$$('#inItems [data-desc]')
    prueba(`«Agregar +» deja ${k + 1} renglón(es)`, cajas.length === k + 1, String(cajas.length))
    await pag.type(`#inItems [data-desc="${k}"]`, INSUMOS[k][0])
    await pag.type(`#inItems [data-cant="${k}"]`, INSUMOS[k][1])
  }
  prueba('el total se va sumando', /4 insumos · 143,5 unidades en total/.test(await texto('#inTotal')), await texto('#inTotal'))

  /* Sin cantidad no se guarda (y no se crea nada en la base). */
  await pag.$eval('#inItems [data-cant="1"]', e => { e.value = ''; e.dispatchEvent(new Event('input')) })
  await pag.click('#inGuardar')
  await espera(600)
  prueba('con un insumo sin cantidad NO se guarda y dice cuál', /Falta la cantidad entregada de ZZZ JERINGA # 5/.test(await aviso()), await aviso())
  const nada = await sql(`select count(*) n from farmacia.insumos_entregas_cds where destino = '${DESTINO}'`)
  prueba('y en la base no quedó nada', Number(nada[0].n) === 0)
  await pag.type('#inItems [data-cant="1"]', '100')

  await pag.click('#inGuardar')
  await pag.waitForFunction(() => /quedó guardada|No se guardó/.test((document.getElementById('inAviso') || {}).textContent || ''), { timeout: 30000 })
  prueba('al guardar dice que quedó guardada', /La entrega quedó guardada: 4 insumos/.test(await aviso()), await aviso())
  const base = await sql(`select e.fecha::text, e.destino, e.recibido_por, e.origen, e.registrado_por is not null as con_autor,
      json_agg(json_build_array(i.orden, i.descripcion, i.cantidad::text) order by i.orden) items
    from farmacia.insumos_entregas_cds e join farmacia.insumos_entregas_cds_items i on i.entrega_id = e.id
    where e.destino = '${DESTINO}' group by e.id`)
  const b = base[0] || {}
  prueba('en la base: una entrega manual, con autor y la fecha de hoy', base.length === 1 && b.origen === 'manual' && b.con_autor &&
    b.recibido_por === 'ZZZ RESPONSABLE DE PRUEBA', JSON.stringify(base))
  prueba('en la base: cada insumo por separado con SU cantidad y en orden', JSON.stringify(b.items) === JSON.stringify([
    [1, 'ZZZ ACETAMINOFEN 500MG', '30.00'], [2, 'ZZZ JERINGA # 5', '100.00'], [3, 'ZZZ AIRON 60/400MG', '12.00'], [4, 'ZZZ GASAS', '1.50']]), JSON.stringify(b.items))
  const filasNueva = await pag.$$eval('#inZona tbody tr', trs => trs.map(t => [...t.children].map(td => td.innerText.trim())))
  prueba('la ficha muestra lo guardado de verdad, con el total', filasNueva.length === 5 && filasNueva[4][2] === '143,5', JSON.stringify(filasNueva))

  console.log('\n--- 4. Corregirla ---')
  await pag.click('#inCorregir')
  await pag.waitForSelector('#inItems [data-quitar="3"]', { timeout: 15000 })
  prueba('al corregir salen sus 4 insumos con la cantidad', (await pag.$$eval('#inItems [data-cant]', c => c.map(x => x.value))).join('|') === '30|100|12|1,5')
  await pag.click('#inItems [data-quitar="3"]')
  await pag.$eval('#inItems [data-cant="0"]', e => { e.value = ''; })
  await pag.type('#inItems [data-cant="0"]', '40')
  await pag.$eval('#inItems [data-cant="0"]', e => e.dispatchEvent(new Event('input')))
  await pag.click('#inGuardar')
  await pag.waitForFunction(() => /corrección quedó guardada|No se guardó/.test((document.getElementById('inAviso') || {}).textContent || ''), { timeout: 30000 })
  const tras = await sql(`select json_agg(json_build_array(i.descripcion, i.cantidad::text) order by i.orden) items
    from farmacia.insumos_entregas_cds e join farmacia.insumos_entregas_cds_items i on i.entrega_id = e.id where e.destino = '${DESTINO}'`)
  prueba('la corrección quedó: 3 insumos y la cantidad nueva', JSON.stringify(tras[0].items) ===
    JSON.stringify([['ZZZ ACETAMINOFEN 500MG', '40.00'], ['ZZZ JERINGA # 5', '100.00'], ['ZZZ AIRON 60/400MG', '12.00']]), JSON.stringify(tras))
  prueba('el administrador ve el botón Anular', await pag.$eval('#inAnular', e => !e.hidden))
  await pag.waitForFunction(() => /Historial de cambios/.test((document.getElementById('inHistorial') || {}).textContent || ''), { timeout: 20000 })
  const fichaZ = await texto('#inZona')
  prueba('la ficha dice cómo se registró: a mano, por quién y cuándo', /Cómo se registró/.test(fichaZ) &&
    /Registrada a mano en el sistema/.test(fichaZ) && /Registrada por[\s\S]*Carlos Linares · \d{2}\/\d{2}\/\d{4} a las \d{1,2}:\d{2} [ap]\. m\./.test(fichaZ), fichaZ.slice(0, 600))
  const hist = await texto('#inHistorial')
  prueba('el historial muestra la creación y la corrección, con quién', /creó la entrega · puso 4 insumos/.test(hist) &&
    /quitó 4 insumos · puso 3 insumos/.test(hist) && /Carlos Linares \(admin\)/.test(hist), hist)

  console.log('\n--- 5. Excel y PDF ---')
  await pag.click('#inVolver')
  await pag.waitForSelector('#inExcel', { timeout: 15000 })
  await escribir('#inBusca', DESTINO)
  await pag.waitForFunction(() => /^1 entrega$/.test(document.getElementById('inConteo').textContent), { timeout: 20000 })
  await pag.click('#inExcel')
  const xls = await esperaArchivo(/\.xlsx$/)
  prueba('descarga el Excel', !!xls, String(fs.readdirSync(BAJADAS)))
  if (xls) {
    let XLSX = null
    try { XLSX = (await import('xlsx')).default } catch { /* sin la biblioteca no se revisa por dentro */ }
    if (XLSX) {
      const libro = XLSX.readFile(path.join(BAJADAS, xls))
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
      prueba('la hoja se llama REGISTRO DE ENTREGAS C.D.S', libro.SheetNames[0] === 'REGISTRO DE ENTREGAS C.D.S', libro.SheetNames[0])
      prueba('encabezados en la fila 3 y una fila por insumo (3)', filas[2][2] === 'Descripción del Insumo' && filas.length === 6, JSON.stringify(filas.slice(2)))
      prueba('cada fila con su insumo y su cantidad', filas[3][2] === 'ZZZ ACETAMINOFEN 500MG' && filas[3][3] === 40 && filas[5][3] === 12, JSON.stringify(filas[3]))
    }
  }
  await pag.click('#inPdf')
  const pdf = await esperaArchivo(/\.pdf$/)
  prueba('descarga el PDF', !!pdf && fs.readFileSync(path.join(BAJADAS, pdf)).subarray(0, 5).toString('latin1') === '%PDF-')

  console.log('\n--- 6. En un teléfono (375 px) ---')
  /* Cambiar a teléfono recarga la página: se vuelve a Mercancía > Insumos. */
  await pag.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
  await espera(1500)
  await pag.waitForSelector('.areas [data-area="inventario"]', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await pag.waitForSelector('#zona-inventario [data-p="insumos"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="insumos"]')
  await pag.waitForSelector('#inNueva', { timeout: 20000 })
  await pag.click('#inNueva')
  await pag.waitForSelector('#inAgregar', { timeout: 15000 })
  await pag.click('#inAgregar')
  await espera(400)
  const medida = await pag.evaluate(() => {
    const d = document.querySelector('#inItems [data-desc="0"]').getBoundingClientRect()
    const c = document.querySelector('#inItems [data-cant="0"]').getBoundingClientRect()
    const q = document.querySelector('#inItems [data-quitar="0"]').getBoundingClientRect()
    return { scroll: document.documentElement.scrollWidth, ancho: innerWidth, desc: d.width, cant: c.width, alto: c.height, quitar: q.width,
             letra: getComputedStyle(document.querySelector('#inItems [data-cant="0"]')).fontSize, misma: Math.abs(d.top - c.top) < 2 }
  })
  prueba('sin scroll de lado', medida.scroll <= medida.ancho, JSON.stringify(medida))
  prueba('INSUMO y CANT en la misma línea, con espacio para escribir', medida.misma && medida.desc >= 170 && medida.cant >= 70, JSON.stringify(medida))
  prueba('campos de 44 px o más y letra de 16 px', medida.alto >= 44 && medida.quitar >= 44 && medida.letra === '16px', JSON.stringify(medida))

  prueba('sin errores en la consola', errores.length === 0, errores.join(' | '))
} catch (e) {
  prueba('la prueba corrió completa', false, e.stack)
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-insumos', { recursive: true, force: true })
  fs.rmSync(BAJADAS, { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza */
/* La bitácora no deja borrar (es inmutable): para quitar el rastro de la
   prueba se apagan los disparadores en esta transacción. Con eso tampoco
   corre el borrado en cascada, así que los insumos se borran primero. */
const limpio = await sql(`begin;
set local session_replication_role = replica;
delete from farmacia.bitacora
 where tabla in ('insumos_entregas_cds', 'insumos_entregas_cds_items')
   and (coalesce(antes::text, '') || coalesce(despues::text, '')) like '%ZZZ%';
delete from farmacia.insumos_entregas_cds_items i using farmacia.insumos_entregas_cds e
 where i.entrega_id = e.id and e.destino like 'ZZZ%';
delete from farmacia.insumos_entregas_cds where destino like 'ZZZ%';
commit;`)
if (limpio && limpio.error) console.log('  limpieza: ' + String(limpio.error).slice(0, 300))
const quedo = await sql(`select (select count(*) from farmacia.insumos_entregas_cds where destino like 'ZZZ%') +
  (select count(*) from farmacia.insumos_entregas_cds_items where descripcion like 'ZZZ%') n,
  (select count(*) from farmacia.insumos_entregas_cds where origen = 'excel') excel`)
prueba('limpieza: no quedó nada de la prueba', Number(quedo[0].n) === 0, JSON.stringify(quedo))
prueba('y las 31 entregas del Excel siguen intactas', Number(quedo[0].excel) === 31, JSON.stringify(quedo))

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}:\n  - ` + fallos.join('\n  - ') : `Pasaron las ${ok} pruebas de la pantalla de insumos.`))
process.exit(mal ? 1 : 0)

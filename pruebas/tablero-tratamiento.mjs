/* LO QUE SE ENTREGÓ, LO QUE NECESITA CADA PACIENTE, Y EL MODO CLARO.

   Tres cosas nuevas, comprobadas manejando el navegador de verdad:

     1. El TABLERO DE ENTREGAS en Mercancía y en Administración: que cuente
        bien lo del día, la semana y el mes, que un rango de fechas
        funcione, y que el Excel y el PDF salgan.
     2. El TRATAMIENTO del paciente: anotarle medicinas al registrarlo,
        verlas cuando se le va a entregar, agregarle una después y
        quitársela.
     3. El botón de MODO CLARO: que cambie y que se acuerde.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/tablero-tratamiento.mjs
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
const MED = 'ZZZ-TABLERO ' + MARCA
const A_MANO = 'ZZZ JARABE QUE NO ESTA ' + MARCA
const PAC = 'ZZZ PACIENTE TABLERO ' + MARCA
const CEDULA = String(9100000 + (Date.now() % 899999)).slice(0, 8)
const LOTE = 'ZZZT' + MARCA
const CANT = 80
const SALE = 25          // 1 caja de 20 y 5 sueltas: obliga al tablero a decirlo en cajas
const POR_CAJA = 20
const BAJADAS = path.join(RAIZ, 'bajadas-tablero')

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
  const txt = await r.text()
  try { return JSON.parse(txt) } catch { return { error: txt } }
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
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-tablero`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
pag.on('dialog', d => d.accept())          // los window.confirm de quitar

const cliente = await pag.createCDPSession()
await cliente.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAJADAS })

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
const irArea = async (id) => {
  await pag.click(`.areas [data-area="${id}"]`)
  await espera(500)
}
const entrar = async () => {
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#formAcceso, #vistaPanel:not([hidden])', { timeout: 25000 })
  if (await pag.$('#formAcceso:not([hidden])')) {
    const visible = await pag.$eval('#vistaAcceso', e => !e.hidden).catch(() => true)
    if (visible) {
      await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
      await pag.type('#correo', ADMIN)
      await pag.type('#clave', CLAVE)
      await pag.click('#btnEntrar')
    }
  }
  await pag.waitForSelector('#vistaPanel:not([hidden])', { timeout: 30000 })
  await pag.waitForSelector('.areas', { timeout: 20000 })
}

try {
  console.log('='.repeat(64))
  console.log('TABLERO DE ENTREGAS, TRATAMIENTO Y MODO CLARO')
  console.log('='.repeat(64))

  /* ============================================================
     1. EL MODO CLARO
  ============================================================ */
  console.log('\n--- 1. Ver la pagina en modo claro ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#btnTema', { timeout: 20000 })

  const rotuloIni = await pag.$eval('#btnTema', e => e.innerText.replace(/\s+/g, ' ').trim())
  prueba('hay un boton para cambiar el modo', /modo (claro|oscuro)/i.test(rotuloIni), rotuloIni)

  await pag.click('#btnTema')
  await espera(200)
  let tema = await pag.evaluate(() => document.documentElement.getAttribute('data-theme'))
  prueba('al pulsarlo la pagina cambia de modo', tema === 'light' || tema === 'dark', String(tema))

  // Sea cual sea el modo del sistema, hay que poder llegar al CLARO.
  if (tema !== 'light') { await pag.click('#btnTema'); await espera(200) }
  tema = await pag.evaluate(() => document.documentElement.getAttribute('data-theme'))
  prueba('se puede dejar en modo claro', tema === 'light', String(tema))

  const fondo = await pag.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const claro = /rgb\((\d+), (\d+), (\d+)\)/.exec(fondo)
  prueba('y el fondo es de verdad claro',
    !!claro && Number(claro[1]) > 200 && Number(claro[2]) > 200, fondo)

  const rotuloClaro = await pag.$eval('#btnTema', e => e.innerText.replace(/\s+/g, ' ').trim())
  prueba('el boton dice a donde va, no donde esta', /modo oscuro/i.test(rotuloClaro), rotuloClaro)

  await pag.reload({ waitUntil: 'networkidle2' })
  await pag.waitForSelector('#btnTema', { timeout: 20000 })
  tema = await pag.evaluate(() => document.documentElement.getAttribute('data-theme'))
  prueba('se acuerda del modo al recargar', tema === 'light', String(tema))

  const contraste = await pag.evaluate(() => {
    const c = getComputedStyle(document.body)
    const n = (t) => (/rgb\((\d+), (\d+), (\d+)\)/.exec(t) || []).slice(1).map(Number)
    const [r1, g1, b1] = n(c.backgroundColor), [r2, g2, b2] = n(c.color)
    return Math.abs((r1 + g1 + b1) - (r2 + g2 + b2))
  })
  prueba('la letra se lee sobre el fondo claro', contraste > 300, 'diferencia: ' + contraste)

  await pag.click('#btnTema')
  await espera(200)
  tema = await pag.evaluate(() => document.documentElement.getAttribute('data-theme'))
  prueba('y se puede volver al oscuro', tema === 'dark', String(tema))
  await pag.click('#btnTema')   // se deja en claro para las capturas del resto

  /* ============================================================
     2. MERCANCIA: cargar un medicamento para poder entregarlo
  ============================================================ */
  console.log('\n--- 2. Cargar mercancia de la prueba ---')
  await entrar()
  await irArea('inventario')
  await pag.waitForSelector('#zona-inventario [data-p="cargar"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="cargar"]')
  await pag.waitForSelector('#rInsumo', { timeout: 20000 })
  await pag.evaluate(v => {
    document.getElementById('rInsumo').value = v.med
    document.getElementById('rPres').value = 'Caja de 20 tabletas de 50mg'
    document.getElementById('rLote').value = v.lote
    document.getElementById('rVence').value = '2028-06-30'
    document.getElementById('rCant').value = String(v.cant)
  }, { med: MED, lote: LOTE, cant: CANT })
  await pag.click('#rGuardar')
  await pag.waitForFunction(
    () => /Registrad|No se pudo/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  const msgCarga = await pag.$eval('#avisoInv', e => e.textContent.trim())
  prueba('se cargo el medicamento de la prueba', !/No se pudo/i.test(msgCarga), msgCarga)

  /* Se le pone el empaque a mano: la pantalla de carga rapida no lo
     pregunta, y sin el no habria forma de comprobar que el tablero sabe
     traducir las unidades a cajas. */
  await sql(`update farmacia.productos
                set empaque = 'caja', unidades_por_empaque = ${POR_CAJA}
              where nombre = '${MED}';`)

  /* ============================================================
     3. EL TRATAMIENTO al registrar a la persona
  ============================================================ */
  console.log('\n--- 3. Registrar a la persona CON sus medicinas ---')
  await irArea('despacho')
  await pag.waitForSelector('#buscaDestino', { timeout: 20000 })
  await pag.click('#btnNuevoDestino')
  await pag.waitForSelector('#guardarPac', { timeout: 20000 })

  const hayPicker = await pag.$('#tratBusca')
  prueba('al registrar una persona se le pueden anotar sus medicinas', !!hayPicker)

  await pag.type('#nNombre', PAC)
  await pag.type('#nCedula', CEDULA)
  await pag.type('#nTelefono', '0424-1234567')

  // a) una del catalogo
  await pag.click('#tratBusca')
  await pag.type('#tratBusca', MED)
  await pag.waitForFunction(m => {
    const f = document.querySelectorAll('#tratRes [data-i]')
    return f.length > 0 && [...f].some(x => x.innerText.includes(m))
  }, { timeout: 25000 }, MED)
  await pag.evaluate(m => {
    const b = [...document.querySelectorAll('#tratRes [data-i]')].find(x => x.innerText.includes(m))
    b.click()
  }, MED)
  await espera(300)
  let anotadas = await pag.$$eval('#tratElegidos .trat-par', f => f.length)
  prueba('se anota una medicina del catalogo', anotadas === 1, 'anotadas: ' + anotadas)

  // b) una que NO esta en el catalogo, escrita a mano
  await pag.evaluate(() => { document.getElementById('tratBusca').value = '' })
  await pag.type('#tratBusca', A_MANO)
  /* CANDADO: hay que esperar a que el boton diga LO QUE SE ACABA DE
     ESCRIBIR. Si no, se toca el de la busqueda anterior y se anota la
     medicina equivocada. Fue un fallo de verdad, no una manía. */
  await pag.waitForFunction(t => {
    const b = document.getElementById('tratAMano')
    return b && b.innerText.includes(t)
  }, { timeout: 25000 }, A_MANO)
  await pag.click('#tratAMano')
  await espera(300)
  anotadas = await pag.$$eval('#tratElegidos .trat-par', f => f.length)
  prueba('y otra que NO esta en el catalogo, tal como se escribio',
    anotadas === 2, 'anotadas: ' + anotadas)

  await pag.click('#guardarPac')
  await pag.waitForSelector('#zonaDestino .elegido', { timeout: 30000 })
  await pag.waitForFunction(() => {
    const t = document.querySelector('.trat')
    return t && !/Buscando/i.test(t.innerText)
  }, { timeout: 25000 })

  const trat = await pag.$eval('.trat', e => e.innerText.replace(/\s+/g, ' '))
  prueba('al ir a entregarle salen sus medicinas', /2 medicamentos/i.test(trat), trat.slice(0, 160))
  prueba('sale la del catalogo, con su existencia', trat.includes(MED) && /\d+ disponibles/i.test(trat),
    trat.slice(0, 200))
  prueba('y sale tambien la que se escribio a mano', trat.includes(A_MANO), trat.slice(0, 240))

  let enBase = await sql(`select count(*) c from farmacia.tratamientos_paciente t
     join farmacia.pacientes p on p.id = t.paciente_id
    where p.nombre = '${PAC}' and t.activo;`)
  prueba('y quedaron guardadas en su ficha', Number(enBase[0]?.c) === 2, JSON.stringify(enBase[0]))

  /* ---- agregarle otra despues, desde su propia ficha ---- */
  console.log('\n--- 3b. Corregir el tratamiento despues ---')
  await pag.click('#tratMas')
  await pag.waitForSelector('#tratBusca', { timeout: 20000 })
  await pag.type('#tratBusca', 'ZZZ-OTRA ' + MARCA)
  await pag.waitForSelector('#tratAMano', { timeout: 25000 })
  await pag.click('#tratAMano')
  await pag.waitForFunction(
    () => /qued[oó] anotad/i.test((document.getElementById('tratAviso') || {}).textContent || ''),
    { timeout: 25000 })
  enBase = await sql(`select count(*) c from farmacia.tratamientos_paciente t
     join farmacia.pacientes p on p.id = t.paciente_id
    where p.nombre = '${PAC}' and t.activo;`)
  prueba('se le puede agregar otra medicina despues', Number(enBase[0]?.c) === 3, JSON.stringify(enBase[0]))

  /* ---- y quitarle una ---- */
  await pag.evaluate(() => {
    const b = document.querySelectorAll('.trat [data-quita]')
    b[b.length - 1].click()
  })
  await pag.waitForFunction(
    () => /Se quit/i.test((document.getElementById('tratAviso') || {}).textContent || ''),
    { timeout: 25000 })
  enBase = await sql(`select
      count(*) filter (where t.activo) activas,
      count(*) total
    from farmacia.tratamientos_paciente t
     join farmacia.pacientes p on p.id = t.paciente_id
    where p.nombre = '${PAC}';`)
  prueba('se le puede quitar una', Number(enBase[0]?.activas) === 2, JSON.stringify(enBase[0]))
  prueba('y no se borra: queda el registro', Number(enBase[0]?.total) === 3, JSON.stringify(enBase[0]))

  /* ============================================================
     4. ENTREGAR desde el tratamiento
  ============================================================ */
  console.log('\n--- 4. Entregarle desde su tratamiento ---')
  await pag.evaluate(m => {
    const b = [...document.querySelectorAll('[data-trat]')].find(x => x.innerText.includes(m))
    b.click()
  }, MED)
  await pag.waitForSelector('#renglones .cesta-item, #renglones .renglon', { timeout: 25000 })
  prueba('tocar la medicina de su tratamiento la agrega a la entrega', true)

  await pag.evaluate(c => {
    const i = document.querySelector('#renglones input')
    i.value = String(c); i.dispatchEvent(new Event('input', { bubbles: true }))
    i.dispatchEvent(new Event('change', { bubbles: true }))
  }, SALE)
  await espera(400)
  await pag.click('#btnRegistrar')
  await pag.waitForFunction(
    () => /Entrega registrada|No se pudo/i.test((document.getElementById('zonaAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgEnt = await pag.$eval('#zonaAviso', e => e.textContent.trim())
  prueba('la entrega se registra', /Entrega registrada/i.test(msgEnt), msgEnt)

  const enBaseEnt = await sql(`select d.cantidad from farmacia.entrega_detalle d
     join farmacia.entregas e on e.id = d.entrega_id
     join farmacia.pacientes p on p.id = e.paciente_id
    where p.nombre = '${PAC}';`)
  prueba(`quedaron ${SALE} unidades entregadas en la base`,
    Number(enBaseEnt[0]?.cantidad) === SALE, JSON.stringify(enBaseEnt))

  /* ============================================================
     5. EL TABLERO en Mercancia
  ============================================================ */
  console.log('\n--- 5. El tablero de entregas, en Mercancia ---')
  await irArea('inventario')
  await pag.waitForSelector('#zona-inventario [data-p="entregas"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="entregas"]')
  await pag.waitForSelector('#invCuerpo .cifras-linea, #invCuerpo .vacio', { timeout: 30000 })

  const chips = await pag.$$eval('#invPer button', bs => bs.map(b => b.textContent.trim()))
  prueba('estan los cuatro periodos',
    ['Hoy', 'Esta semana', 'Este mes', 'Entre dos fechas'].every(x => chips.includes(x)),
    JSON.stringify(chips))

  const rot = await pag.$eval('#invRotulo', e => e.textContent.trim())
  prueba('dice de que dia esta hablando', /Hoy,/i.test(rot), rot)

  const cifras = await pag.$$eval('#invCuerpo .cifra-linea', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ')))
  prueba('salen las cinco cifras del periodo', cifras.length === 5, JSON.stringify(cifras))
  prueba('cuenta la entrega de hoy', /^1 /.test(cifras[0] || ''), JSON.stringify(cifras[0]))
  prueba('cuenta la persona atendida', /^1 /.test(cifras[1] || ''), JSON.stringify(cifras[1]))
  prueba(`cuenta las ${SALE} unidades`, (cifras[4] || '').indexOf(String(SALE)) === 0,
    JSON.stringify(cifras[4]))

  const cuerpo = await pag.$eval('#invCuerpo', e => e.innerText.replace(/\s+/g, ' '))
  prueba('la tabla dice QUE se entrego', cuerpo.includes(MED), cuerpo.slice(0, 200))
  prueba('y a quien', cuerpo.includes(PAC), cuerpo.slice(0, 200))
  prueba('y lo dice tambien en cajas, no solo en unidades',
    /1 caja y 5 sueltas/i.test(cuerpo), cuerpo.slice(0, 300))

  /* La regla que no se negocia: las entregas viejas del Excel no traen
     cantidad y no se pueden sumar. Se dice, no se esconde. */
  await pag.click('#invPer [data-per="mes"]')
  await pag.waitForFunction(
    () => !/Contando/.test((document.getElementById('invCuerpo') || {}).innerText || ''),
    { timeout: 40000 })
  const mes = await pag.$eval('#invCuerpo', e => e.innerText.replace(/\s+/g, ' '))
  prueba('en el mes avisa de las entregas del Excel sin cantidad',
    /vienen de los Excel/i.test(mes), mes.slice(0, 260))
  prueba('y explica que NO entran en el total de unidades',
    /no.{0,3} entran en el .{0,10}total de unidades/i.test(mes), mes.slice(0, 400))

  /* Un dia en especifico */
  await pag.click('#invPer [data-per="rango"]')
  await pag.waitForSelector('#invRango:not([hidden])', { timeout: 15000 })
  const ayer = await pag.evaluate(() => window.FARM.sumaDias(window.FARM.hoyCaracas(), -1))
  await pag.evaluate(d => {
    document.getElementById('invDesde').value = d
    document.getElementById('invHasta').value = d
  }, ayer)
  await pag.click('#invVer')
  await pag.waitForFunction(
    () => !/Contando/.test((document.getElementById('invCuerpo') || {}).innerText || ''),
    { timeout: 40000 })
  const rotAyer = await pag.$eval('#invRotulo', e => e.textContent.trim())
  prueba('se puede pedir un dia en especifico', !/Hoy,/i.test(rotAyer) && rotAyer.length > 6, rotAyer)
  const ayerTxt = await pag.$eval('#invCuerpo', e => e.innerText)
  prueba('y ese dia no cuenta la entrega de hoy', !ayerTxt.includes(PAC), ayerTxt.slice(0, 120))

  /* Vuelta a hoy para las descargas */
  await pag.click('#invPer [data-per="hoy"]')
  await pag.waitForFunction(
    () => !/Contando/.test((document.getElementById('invCuerpo') || {}).innerText || ''),
    { timeout: 40000 })

  console.log('\n--- 5b. El Excel y el PDF del periodo ---')
  await pag.click('#invExcel')
  const xls = await esperaArchivo(/\.xlsx$/i)
  prueba('el Excel del periodo se descarga', !!xls, String(xls))
  if (xls) {
    const tam = fs.statSync(path.join(BAJADAS, xls)).size
    prueba('y no viene vacio', tam > 5000, tam + ' bytes')
    prueba('el nombre dice de que fechas es', /^Entregas \d{4}-\d{2}-\d{2}/.test(xls), xls)
  }

  await pag.click('#invPdf')
  const pdf = await esperaArchivo(/\.pdf$/i)
  prueba('el PDF del periodo se descarga', !!pdf, String(pdf))
  if (pdf) {
    const buf = fs.readFileSync(path.join(BAJADAS, pdf))
    prueba('y es un PDF de verdad', buf.slice(0, 4).toString() === '%PDF', buf.slice(0, 8).toString())
    prueba('con mas de una hoja de contenido', buf.length > 20000, buf.length + ' bytes')
  }

  /* ============================================================
     6. EL MISMO TABLERO en Administracion
  ============================================================ */
  console.log('\n--- 6. El tablero tambien en Administracion ---')
  await irArea('admin')
  await pag.waitForSelector('#zona-admin [data-p="entregas"]', { timeout: 20000 })
  await pag.click('#zona-admin [data-p="entregas"]')
  await pag.waitForSelector('#admCuerpo .cifras-linea, #admCuerpo .vacio', { timeout: 30000 })
  const cifrasAdm = await pag.$$eval('#admCuerpo .cifra-linea', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ')))
  prueba('el administrador ve el mismo tablero', cifrasAdm.length === 5, JSON.stringify(cifrasAdm))
  prueba('y le da las mismas cifras que en Mercancia',
    JSON.stringify(cifrasAdm) === JSON.stringify(cifras), JSON.stringify(cifrasAdm))

  /* Las dos copias conviven en la pagina: si compartieran identificadores,
     una escribiria sobre la otra. Es el fallo que mas costaria encontrar. */
  const dobles = await pag.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id)
    const vistos = {}, rep = []
    ids.forEach(i => { if (vistos[i]) rep.push(i); vistos[i] = 1 })
    return rep
  })
  prueba('los dos tableros no se pisan (ningun identificador repetido)',
    dobles.length === 0, JSON.stringify(dobles.slice(0, 6)))

  const sigueInv = await pag.$$eval('#invCuerpo .cifra-linea', bs => bs.length).catch(() => 0)
  prueba('y el de Mercancia sigue entero detras', sigueInv === 5, 'cifras: ' + sigueInv)

  /* ============================================================
     7. En el telefono
  ============================================================ */
  console.log('\n--- 7. En una pantalla de telefono ---')
  await pag.setViewport({ width: 375, height: 780 })
  await espera(500)
  const ancho = await pag.evaluate(() => ({
    doc: document.documentElement.scrollWidth, vista: window.innerWidth
  }))
  prueba('no hay que arrastrar de lado', ancho.doc <= ancho.vista + 1, JSON.stringify(ancho))
  const chicos = await pag.evaluate(() => {
    const malos = []
    document.querySelectorAll('#admCuerpo button, #admCuerpo input').forEach(e => {
      const r = e.getBoundingClientRect()
      if (r.height > 0 && r.height < 44) malos.push(e.id || e.className || e.tagName)
    })
    return malos
  })
  prueba('todo se puede tocar con el dedo', chicos.length === 0, JSON.stringify(chicos.slice(0, 5)))
  await pag.setViewport({ width: 1280, height: 950 })

  /* ============================================================ */
  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-tablero.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-tablero', { recursive: true, force: true })
  fs.rmSync(BAJADAS, { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza
   Igual que en las demas pruebas: se borra TODO lo que creo, apagando los
   disparadores de inmutabilidad solo dentro de esta transaccion. */
const limpieza = await sql(`
begin;
set local session_replication_role = replica;

create temporary table zzz_e on commit drop as
  select e.id from farmacia.entregas e
   join farmacia.pacientes p on p.id = e.paciente_id
  where p.nombre like 'ZZZ%';

delete from farmacia.bitacora
 where registro_id in (select id::text from zzz_e)
    or registro_id in (select d.id::text from farmacia.entrega_detalle d join zzz_e z on z.id = d.entrega_id)
    or registro_id in (select t.id::text from farmacia.tratamientos_paciente t
                        join farmacia.pacientes p on p.id = t.paciente_id where p.nombre like 'ZZZ%')
    or registro_id in (select l.id::text from farmacia.lotes l join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select m.id::text from farmacia.movimientos m join farmacia.lotes l on l.id = m.lote_id join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.pacientes where nombre like 'ZZZ%');

-- Los descuentos que generaron esas entregas, SEA CUAL SEA el medicamento:
-- si la prueba tocara uno real, su descuento se quedaria puesto para siempre.
delete from farmacia.bitacora
 where registro_id in (select m.id::text from farmacia.movimientos m
                        where m.entrega_id in (select id from zzz_e));
delete from farmacia.movimientos m where m.entrega_id in (select id from zzz_e);

delete from farmacia.entrega_detalle d using zzz_e z where d.entrega_id = z.id;
delete from farmacia.entregas e using zzz_e z where e.id = z.id;
delete from farmacia.tratamientos_paciente t using farmacia.pacientes q
 where t.paciente_id = q.id and q.nombre like 'ZZZ%';
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.productos where nombre like 'ZZZ-%';
delete from farmacia.pacientes where nombre like 'ZZZ%';

set local session_replication_role = origin;
commit;`)

const quedaron = (await sql(`select
  (select count(*) from farmacia.productos where nombre like 'ZZZ-%') productos,
  (select count(*) from farmacia.pacientes where nombre like 'ZZZ%') pacientes,
  (select count(*) from farmacia.movimientos m where m.entrega_id is not null
     and not exists (select 1 from farmacia.entregas e where e.id = m.entrega_id)) descuentos_huerfanos;`))[0] || {}
const suma = Object.values(quedaron).reduce((a, b) => a + Number(b), 0)
prueba('la prueba no deja nada suyo en la base', suma === 0,
  JSON.stringify(limpieza.error ? limpieza : quedaron).slice(0, 220))

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas del tablero y el tratamiento.`)

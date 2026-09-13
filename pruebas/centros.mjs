/* LOS CENTROS DE SALUD: DAR DE ALTA, SU LISTA DE INSUMOS Y LO RECIBIDO.

   Comprueba, manejando el navegador de verdad:

     · Que en Mercancía se pueda registrar un CDI con su lista de insumos.
     · Que a cada insumo se le ponga cuánto necesita, y que la ficha diga
       si eso ALCANZA con lo que hay hoy.
     · Que al ir a entregarle, su lista salga sola con las cantidades
       puestas, y que si no alcanza se ponga lo que queda y se avise.
     · Que la ficha del centro muestre todo lo que se le ha entregado, y
       que salga en Excel y en PDF.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/centros.mjs
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
const CENTRO = 'ZZZ CDI CENTROS ' + MARCA
const SOBRA = 'ZZZ-SOBRA ' + MARCA      // hay de sobra: 200, pide 30
const FALTA = 'ZZZ-FALTA ' + MARCA      // no alcanza: hay 5, pide 50
const PIDE_SOBRA = 30
const PIDE_FALTA = 50
const HAY_SOBRA = 200
const HAY_FALTA = 5
const BAJADAS = path.join(RAIZ, 'bajadas-centros')

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
await new Promise(r => servidor.listen(0, r))
const PUERTO = servidor.address().port

fs.rmSync(BAJADAS, { recursive: true, force: true })
fs.mkdirSync(BAJADAS, { recursive: true })

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-centros`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
pag.on('dialog', d => d.accept())

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
const irArea = async (id) => { await pag.click(`.areas [data-area="${id}"]`); await espera(500) }
const cargar = async (nombre, cant) => {
  await pag.click('#zona-inventario [data-p="cargar"]')
  await pag.waitForSelector('#rInsumo', { timeout: 20000 })
  await pag.evaluate(() => { document.getElementById('avisoInv').innerHTML = '' })
  await pag.evaluate(v => {
    document.getElementById('rInsumo').value = v.n
    document.getElementById('rPres').value = 'Caja'
    document.getElementById('rLote').value = 'ZZZC' + String(v.c)
    document.getElementById('rVence').value = '2029-01-31'
    document.getElementById('rCant').value = String(v.c)
  }, { n: nombre, c: cant })
  await pag.click('#rGuardar')
  await pag.waitForFunction(
    () => /Registrad|No se pudo/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  return pag.$eval('#avisoInv', e => e.textContent.trim())
}
const elegirInsumo = async (pfx, nombre) => {
  await pag.evaluate(p => { document.getElementById(p + 'Busca').value = '' }, pfx)
  await pag.type('#' + pfx + 'Busca', nombre)
  await pag.waitForFunction((p, m) => {
    const f = document.querySelectorAll('#' + p + 'Res [data-i]')
    return f.length > 0 && [...f].some(x => x.innerText.includes(m))
  }, { timeout: 25000 }, pfx, nombre)
  await pag.evaluate((p, m) => {
    [...document.querySelectorAll('#' + p + 'Res [data-i]')].find(x => x.innerText.includes(m)).click()
  }, pfx, nombre)
  await espera(400)
}

try {
  console.log('='.repeat(64))
  console.log('CENTROS DE SALUD: ALTA, LISTA DE INSUMOS Y LO RECIBIDO')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y cargar dos insumos ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await irArea('inventario')
  await pag.waitForSelector('#zona-inventario [data-p="cargar"]', { timeout: 20000 })

  const m1 = await cargar(SOBRA, HAY_SOBRA)
  const m2 = await cargar(FALTA, HAY_FALTA)
  prueba('hay dos insumos cargados para la prueba',
    !/No se pudo/i.test(m1) && !/No se pudo/i.test(m2), m1 + ' | ' + m2)

  /* ============================================================
     2. LA PESTAÑA Y EL ALTA
  ============================================================ */
  console.log('\n--- 2. Registrar el centro con su lista ---')
  const pestanas = await pag.$$eval('#zona-inventario .conmuta button',
    bs => bs.map(b => b.textContent.trim()))
  prueba('Mercancia tiene la pestana Centros', pestanas.includes('Centros'), JSON.stringify(pestanas))

  await pag.click('#zona-inventario [data-p="centros"]')
  await pag.waitForSelector('#ceBusca', { timeout: 25000 })

  await pag.waitForSelector('#ceVistaAn', { timeout: 20000 })
  const analisisTxt = await pag.$eval('#ceDash', e => e.innerText)
  prueba('la lista trae el análisis de lo entregado a los centros', /Lo entregado a los centros/i.test(analisisTxt), analisisTxt.slice(0, 80))
  await pag.click('#ceVistaAn [data-v="mes"]')
  await pag.waitForFunction(
    () => document.querySelectorAll('#ceDash table tbody tr').length === 6,
    { timeout: 20000 })
  prueba('el selector Por mes trae 6 renglones de tendencia', true)

  await pag.click('#ceNuevo')
  await pag.waitForSelector('#ceCrear', { timeout: 20000 })

  const campos = await pag.evaluate(() => ({
    nombre: !!document.getElementById('ceNombre'),
    tipo: !!document.getElementById('ceTipo'),
    dir: !!document.getElementById('ceDireccion'),
    resp: !!document.getElementById('ceResponsable'),
    tel: !!document.getElementById('ceTelefono'),
    ins: !!document.getElementById('ceInsBusca'),
  }))
  prueba('el formulario pide los datos del centro y sus insumos',
    Object.values(campos).every(Boolean), JSON.stringify(campos))

  await pag.type('#ceNombre', CENTRO)
  await pag.select('#ceTipo', 'CDI')
  await pag.type('#ceDireccion', 'Sector de prueba automatica')
  await pag.type('#ceResponsable', 'Dra. Prueba Centros')
  await pag.type('#ceTelefono', '0239-1112233')

  await elegirInsumo('ceIns', SOBRA)
  await elegirInsumo('ceIns', FALTA)
  const anotados = await pag.$$eval('#ceListaPend .trat-par', f => f.length)
  prueba('se le anotan dos insumos antes de crearlo', anotados === 2, 'anotados: ' + anotados)

  await pag.click('#ceCrear')
  await pag.waitForFunction(
    () => /qued[oó] registrado|No se pudo|Ya hay/i.test(
      (document.getElementById('ceAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgCrear = await pag.$eval('#ceAviso', e => e.textContent.trim())
  prueba('el centro se registra con su lista', /quedó registrado/i.test(msgCrear), msgCrear)
  prueba('y avisa de que hay que ponerle las cantidades',
    /cu[aá]nto necesita/i.test(msgCrear), msgCrear)

  let base = await sql(`select
      (select count(*) from farmacia.instituciones where nombre = '${CENTRO}') centros,
      (select count(*) from farmacia.requerimientos_institucion r
        join farmacia.instituciones i on i.id = r.institucion_id
       where i.nombre = '${CENTRO}' and r.activo) insumos;`)
  prueba('en la base quedo el centro con sus 2 insumos',
    Number(base[0]?.centros) === 1 && Number(base[0]?.insumos) === 2, JSON.stringify(base[0]))

  /* ============================================================
     2b. EN LA LISTA SE VE LO RECIBIDO AUNQUE SEA CERO

     Antes, si todavia no se le habia entregado nada, el numero de
     unidades recibidas simplemente no aparecia -como si no se
     estuviera contando-. Ahora se ve siempre, con su "0" bien puesto.
  ============================================================ */
  console.log('\n--- 2b. En la lista se ve "0 unidades recibidas", no se esconde ---')
  await pag.click('#ceVolver')
  await pag.waitForSelector('#ceBusca', { timeout: 20000 })
  await pag.evaluate(() => { document.getElementById('ceBusca').value = '' })
  await pag.type('#ceBusca', CENTRO)
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#ceRes .ficha')
    return f.length === 1 && f[0].innerText.includes(t)
  }, { timeout: 25000 }, CENTRO)
  const listaSinEntregas = await pag.$eval('#ceRes .ficha', e => e.innerText.replace(/\s+/g, ' '))
  prueba('antes de recibir nada, la lista lo dice explícito en vez de escondelo',
    /0 unidades recibidas/i.test(listaSinEntregas), listaSinEntregas)

  await pag.click('#ceRes .ficha')
  await pag.waitForFunction(
    () => document.querySelectorAll('#ceZona [data-cant]').length === 2, { timeout: 25000 })

  /* ============================================================
     3. LAS CANTIDADES Y LA COBERTURA
  ============================================================ */
  console.log('\n--- 3. Cuanto necesita de cada uno ---')
  prueba('la ficha deja poner cuanto necesita de cada insumo', true)

  const ponCantidad = async (nombre, cant) => {
    await pag.evaluate((n, c) => {
      const fila = [...document.querySelectorAll('#ceZona .tabla.datos tbody tr')]
        .find(x => x.innerText.includes(n))
      const i = fila.querySelector('[data-cant]')
      i.value = String(c)
      i.dispatchEvent(new Event('change', { bubbles: true }))
    }, nombre, cant)
    await pag.waitForFunction(
      () => /Cantidad guardada|No se pudo/i.test(
        (document.getElementById('ceAviso') || {}).textContent || ''),
      { timeout: 25000 })
    const m = await pag.$eval('#ceAviso', e => e.textContent.trim())
    await pag.evaluate(() => { document.getElementById('ceAviso').innerHTML = '' })
    return m
  }
  const g1 = await ponCantidad(SOBRA, PIDE_SOBRA)
  prueba('la cantidad se guarda sola al salir de la casilla', /Cantidad guardada/i.test(g1), g1)
  const g2 = await ponCantidad(FALTA, PIDE_FALTA)
  prueba('y la del segundo tambien', /Cantidad guardada/i.test(g2), g2)

  const ficha = await pag.$eval('#ceZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('dice que de uno ALCANZA con lo que hay', /Alcanza/i.test(ficha), ficha.slice(0, 300))
  prueba('y que del otro NO alcanza', /No alcanza/i.test(ficha), ficha.slice(0, 300))
  prueba('y avisa arriba de cuantos renglones no se pueden cubrir',
    /no hay con qu[eé] cubrir 1/i.test(ficha), ficha.slice(0, 300))

  base = await sql(`select r.cantidad, p.nombre from farmacia.requerimientos_institucion r
      join farmacia.instituciones i on i.id = r.institucion_id
      left join farmacia.productos p on p.id = r.producto_id
     where i.nombre = '${CENTRO}' and r.activo order by p.nombre;`)
  prueba('las cantidades llegaron a la base',
    base.length === 2 && base.every(x => Number(x.cantidad) === PIDE_FALTA || Number(x.cantidad) === PIDE_SOBRA),
    JSON.stringify(base))

  /* ============================================================
     4. ENTREGARLE: SU LISTA SALE SOLA
  ============================================================ */
  console.log('\n--- 4. Al entregarle, su pedido sale solo ---')
  await irArea('despacho')
  await pag.waitForSelector('.conmuta [data-modo="institucion"]', { timeout: 25000 })
  await pag.click('.conmuta [data-modo="institucion"]')
  await pag.waitForSelector('#buscaDestino', { timeout: 20000 })
  await pag.type('#buscaDestino', CENTRO)
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#resultados .ficha')
    return f.length === 1 && f[0].innerText.includes(t)
  }, { timeout: 25000 }, CENTRO)
  await pag.evaluate(() => { document.querySelector('#resultados .ficha').click() })
  await pag.waitForSelector('#zonaDestino .elegido', { timeout: 25000 })
  await pag.waitForFunction(
    () => /Lo que pide este centro/i.test((document.getElementById('zonaDestino') || {}).innerText || '') &&
          !/Buscando/i.test((document.getElementById('zonaDestino') || {}).innerText || ''),
    { timeout: 25000 })

  const pedido = await pag.$eval('#zonaDestino', e => e.innerText.replace(/\s+/g, ' '))
  prueba('al elegir el centro sale lo que pide', /Lo que pide este centro . 2 insumos/i.test(pedido),
    pedido.slice(0, 220))
  prueba('cada renglon dice cuanto necesita y cuanto hay',
    pedido.includes('necesita ' + PIDE_SOBRA) && pedido.includes('hay ' + HAY_SOBRA),
    pedido.slice(0, 320))
  prueba('y avisa del que no alcanza', /no alcanza/i.test(pedido), pedido.slice(0, 400))

  await pag.click('#reqTodo')
  await pag.waitForFunction(
    () => /Se agregaron/i.test((document.getElementById('zonaAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgTodo = await pag.$eval('#zonaAviso', e => e.textContent.trim())
  prueba('un solo toque arma el pedido entero', /Se agregaron 2 de los 2/i.test(msgTodo), msgTodo)
  prueba('y dice que de uno no hay lo que pide', /no hay lo que pide/i.test(msgTodo), msgTodo)

  const cantidades = await pag.$$eval('#renglones input[type="number"]', is => is.map(i => Number(i.value)))
  prueba('pone la cantidad que pide el centro, no 1',
    cantidades.includes(PIDE_SOBRA), JSON.stringify(cantidades))
  prueba('y del que no alcanza pone SOLO lo que queda',
    cantidades.includes(HAY_FALTA) && !cantidades.includes(PIDE_FALTA), JSON.stringify(cantidades))

  await pag.type('#recibeNombre', 'Dra. Prueba Centros')
  await pag.type('#recibeCedula', '13131313')
  await pag.click('#btnRegistrar')
  await pag.waitForFunction(
    () => /Entrega registrada|No se pudo/i.test((document.getElementById('zonaAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgEnt = await pag.$eval('#zonaAviso', e => e.textContent.trim())
  prueba('la entrega al centro se registra', /Entrega registrada/i.test(msgEnt), msgEnt)

  base = await sql(`select sum(d.cantidad) total, count(*) renglones
      from farmacia.entrega_detalle d
      join farmacia.entregas e on e.id = d.entrega_id
      join farmacia.instituciones i on i.id = e.institucion_id
     where i.nombre = '${CENTRO}';`)
  prueba(`salieron ${PIDE_SOBRA + HAY_FALTA} unidades en 2 renglones`,
    Number(base[0]?.total) === PIDE_SOBRA + HAY_FALTA && Number(base[0]?.renglones) === 2,
    JSON.stringify(base[0]))

  /* ============================================================
     5. LA FICHA DEL CENTRO, CON LO RECIBIDO
  ============================================================ */
  console.log('\n--- 5. Su ficha muestra lo que ha recibido ---')
  await irArea('inventario')
  /* El area se esconde, no se destruye: la pestana vuelve donde estaba,
     que era la FICHA del centro. Es lo que se quiere (no perder lo que
     estabas haciendo), asi que la prueba vuelve a la lista a mano. */
  await pag.evaluate(() => {
    const t = document.querySelector('#zona-inventario [data-p="centros"]')
    if (t && !t.classList.contains('on')) t.click()
  })
  await espera(600)
  await pag.evaluate(() => {
    const v = document.getElementById('ceVolver')
    if (v) v.click()
  })
  await pag.waitForSelector('#ceBusca', { timeout: 25000 })
  await pag.type('#ceBusca', CENTRO)
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#ceRes .ficha')
    return f.length === 1 && f[0].innerText.includes(t)
  }, { timeout: 25000 }, CENTRO)
  const enLista = await pag.$eval('#ceRes .ficha', e => e.innerText.replace(/\s+/g, ' '))
  prueba('en la lista se ve cuantos insumos pide', /2 insumos/i.test(enLista), enLista)
  prueba('y cuantas unidades ha recibido',
    enLista.includes(String(PIDE_SOBRA + HAY_FALTA)), enLista)

  await pag.evaluate(() => { document.querySelector('#ceRes .ficha').click() })
  await pag.waitForFunction(
    () => /Lo que se le ha entregado/i.test((document.getElementById('ceZona') || {}).innerText || '') &&
          !/Buscando/i.test((document.getElementById('ceZona') || {}).innerText || ''),
    { timeout: 30000 })
  const fichaFin = await pag.$eval('#ceZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('la ficha resume lo que se le ha entregado',
    fichaFin.includes(SOBRA) && fichaFin.includes(FALTA), fichaFin.slice(0, 400))
  prueba('con el total de unidades',
    fichaFin.includes(String(PIDE_SOBRA + HAY_FALTA)), fichaFin.slice(0, 400))

  console.log('\n--- 5b. En Excel y en PDF ---')
  await pag.click('#ceExcel')
  const xls = await esperaArchivo(/\.xlsx$/i)
  prueba('el Excel del centro se descarga', !!xls, String(xls))
  if (xls) {
    const tam = fs.statSync(path.join(BAJADAS, xls)).size
    prueba('y no viene vacio', tam > 4000, tam + ' bytes')
    prueba('el nombre lleva el centro', String(xls).includes('ZZZ CDI CENTROS'), String(xls))
  }
  await pag.click('#cePdf')
  const pdf = await esperaArchivo(/\.pdf$/i)
  prueba('el PDF del centro se descarga', !!pdf, String(pdf))
  if (pdf) {
    const buf = fs.readFileSync(path.join(BAJADAS, pdf))
    prueba('y es un PDF de verdad', buf.slice(0, 4).toString() === '%PDF', buf.slice(0, 8).toString())
  }

  /* ============================================================
     5c. REGISTRAR UNA ENTREGA DESDE LA FICHA DEL CENTRO

     A esta altura, del récipe/pedido de la sección 4 ya no queda NADA
     de FALTA (hay 5, el pedido se llevó las 5) y sí quedan 170 de
     SOBRA (hay 200, el pedido se llevó 30). Sirve para probar los dos
     casos con datos reales, sin inventar otro escenario.
  ============================================================ */
  console.log('\n--- 5c. Registrar una entrega directo desde la ficha del centro ---')
  await pag.click('#ceIrEntregar')
  await pag.waitForSelector('#ceEntGuardar', { timeout: 20000 })
  await pag.type('#ceEntDepto', 'ZZZ ENFERMERIA')
  await elegirInsumo('ceEnt', SOBRA)
  await pag.waitForFunction(
    () => document.querySelectorAll('#ceZona [data-cesta-cant]').length === 1, { timeout: 20000 })
  await pag.evaluate(() => {
    const i = document.querySelector('[data-cesta-cant="0"]')
    i.value = '10'
    i.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await pag.type('#ceEntRecibe', 'ZZZ Recibe Prueba')
  await pag.click('#ceEntGuardar')
  await pag.waitForFunction(
    () => /Entrega registrada/i.test((document.getElementById('ceAviso') || {}).textContent || ''),
    { timeout: 25000 })
  prueba('la entrega se registra directo desde Centros, sin ir a Entregar', true)

  await pag.waitForSelector('#ceIrEntregar', { timeout: 20000 })
  /* Volver a la ficha repinta con lo viejo primero -para no dejar la
     pantalla en blanco- y refresca aparte, en cuanto responde la base.
     Sin esperar ESE refresco, se lee "1 entrega" un instante antes de
     que llegue el "2". */
  await pag.waitForFunction(
    () => /2\s*entregas/i.test((document.getElementById('ceZona') || {}).innerText || ''),
    { timeout: 20000 })
  const fichaTrasEntrega = await pag.$eval('#ceZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('vuelve a la ficha del centro, ya con la entrega contada', /2\s*entregas/i.test(fichaTrasEntrega), fichaTrasEntrega.slice(0, 200))
  prueba('y las unidades sumadas (30 de sobra + 5 de falta + 10 nuevas = 45)',
    fichaTrasEntrega.includes('45'), fichaTrasEntrega.slice(0, 200))
  prueba('aparece el detalle día por día', /Día por día/i.test(fichaTrasEntrega), '')

  const enBase = await sql(`select departamento, recibe_nombre from farmacia.entregas
     where institucion_id = (select id from farmacia.instituciones where nombre = '${CENTRO}')
       and departamento is not null;`)
  prueba('el departamento y quién recibe llegaron a la base',
    enBase[0]?.departamento === 'ZZZ ENFERMERIA' && enBase[0]?.recibe_nombre === 'ZZZ Recibe Prueba',
    JSON.stringify(enBase[0]))

  console.log('\n--- 5d. Sin existencia, no deja registrar la entrega ---')
  await pag.click('#ceIrEntregar')
  await pag.waitForSelector('#ceEntGuardar', { timeout: 20000 })
  await elegirInsumo('ceEnt', FALTA)
  await pag.waitForFunction(
    () => document.querySelectorAll('#ceZona [data-cesta-cant]').length === 1, { timeout: 20000 })
  await pag.type('#ceEntRecibe', 'ZZZ Recibe Sin Stock')
  await pag.click('#ceEntGuardar')
  await pag.waitForFunction(
    () => /No hay existencia disponible/i.test((document.getElementById('ceAviso') || {}).textContent || ''),
    { timeout: 20000 })
  prueba('avisa que no hay existencia, en vez de dejarlo entrar en números negativos', true)
  const noSeCreo = await sql(`select count(*) c from farmacia.entregas
     where institucion_id = (select id from farmacia.instituciones where nombre = '${CENTRO}')
       and recibe_nombre = 'ZZZ Recibe Sin Stock';`)
  prueba('y no queda ninguna entrega a medias en la base', Number(noSeCreo[0]?.c) === 0, JSON.stringify(noSeCreo[0]))
  await pag.click('#ceEntVolver')
  await pag.waitForSelector('#ceIrEntregar', { timeout: 20000 })

  /* ============================================================
     6. QUITAR UN INSUMO
  ============================================================ */
  console.log('\n--- 6. Quitar un insumo de la lista ---')
  await pag.evaluate(n => {
    const fila = [...document.querySelectorAll('#ceZona .tabla.datos tbody tr')]
      .find(x => x.innerText.includes(n))
    fila.querySelector('[data-quita]').click()
  }, FALTA)
  await pag.waitForFunction(
    () => /Se quit/i.test((document.getElementById('ceAviso') || {}).textContent || ''),
    { timeout: 25000 })
  base = await sql(`select
      count(*) filter (where r.activo) activos, count(*) total
    from farmacia.requerimientos_institucion r
    join farmacia.instituciones i on i.id = r.institucion_id
   where i.nombre = '${CENTRO}';`)
  prueba('se quita de su lista', Number(base[0]?.activos) === 1, JSON.stringify(base[0]))
  prueba('y no se borra: queda el registro', Number(base[0]?.total) === 2, JSON.stringify(base[0]))
  const trasQuitar = await pag.$eval('#ceZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('quitarlo de la lista NO borra lo que ya se le entrego',
    trasQuitar.includes(FALTA), trasQuitar.slice(0, 400))

  /* ============================================================
     7. EN EL TELEFONO
  ============================================================ */
  console.log('\n--- 7. En una pantalla de telefono ---')
  await pag.setViewport({ width: 375, height: 780 })
  await espera(600)
  const ancho = await pag.evaluate(() => ({
    doc: document.documentElement.scrollWidth, vista: window.innerWidth
  }))
  prueba('no hay que arrastrar de lado', ancho.doc <= ancho.vista + 1, JSON.stringify(ancho))
  const chicos = await pag.evaluate(() => {
    const malos = []
    document.querySelectorAll('#ceZona button, #ceZona input, #ceZona select').forEach(e => {
      const r = e.getBoundingClientRect()
      if (r.height > 0 && r.height < 44) malos.push(e.id || e.className || e.tagName)
    })
    return malos
  })
  prueba('todo se puede tocar con el dedo', chicos.length === 0, JSON.stringify(chicos.slice(0, 5)))
  await pag.setViewport({ width: 1280, height: 950 })

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-centros.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-centros', { recursive: true, force: true })
  fs.rmSync(BAJADAS, { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza */
const limpieza = await sql(`
begin;
set local session_replication_role = replica;

create temporary table zzz_e on commit drop as
  select e.id from farmacia.entregas e
   join farmacia.instituciones i on i.id = e.institucion_id
  where i.nombre like 'ZZZ%';

delete from farmacia.bitacora
 where registro_id in (select id::text from zzz_e)
    or registro_id in (select d.id::text from farmacia.entrega_detalle d join zzz_e z on z.id = d.entrega_id)
    or registro_id in (select r.id::text from farmacia.requerimientos_institucion r
                        join farmacia.instituciones i on i.id = r.institucion_id where i.nombre like 'ZZZ%')
    or registro_id in (select l.id::text from farmacia.lotes l
                        join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select m.id::text from farmacia.movimientos m
                        join farmacia.lotes l on l.id = m.lote_id
                        join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.instituciones where nombre like 'ZZZ%');

delete from farmacia.bitacora
 where registro_id in (select m.id::text from farmacia.movimientos m
                        where m.entrega_id in (select id from zzz_e));
delete from farmacia.movimientos m where m.entrega_id in (select id from zzz_e);

delete from farmacia.entrega_detalle d using zzz_e z where d.entrega_id = z.id;
delete from farmacia.entregas e using zzz_e z where e.id = z.id;
delete from farmacia.requerimientos_institucion r using farmacia.instituciones i
 where r.institucion_id = i.id and i.nombre like 'ZZZ%';
delete from farmacia.instituciones where nombre like 'ZZZ%';
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.productos where nombre like 'ZZZ-%';

set local session_replication_role = origin;
commit;`)

const quedaron = (await sql(`select
  (select count(*) from farmacia.productos where nombre like 'ZZZ-%') productos,
  (select count(*) from farmacia.instituciones where nombre like 'ZZZ%') centros,
  (select count(*) from farmacia.movimientos m where m.entrega_id is not null
     and not exists (select 1 from farmacia.entregas e where e.id = m.entrega_id)) descuentos_huerfanos;`))[0] || {}
const suma = Object.values(quedaron).reduce((a, b) => a + Number(b), 0)
prueba('la prueba no deja nada suyo en la base', suma === 0,
  JSON.stringify(limpieza.error ? limpieza : quedaron).slice(0, 220))

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas de los centros de salud.`)

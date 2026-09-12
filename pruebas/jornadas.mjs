/* JORNADAS: cada jornada es un evento, y sus totales se cuentan solos.

   Comprueba, manejando el navegador de verdad:

     · Que el menú de Mercancía se pasó a la izquierda en pantalla ancha,
       fijo mientras se hace scroll.
     · Que "Jornadas" abre la lista de EVENTOS (no de personas), con su
       botón de "+ Nueva jornada".
     · Que se crea una jornada con su equipo y sus firmas, SIN pedir los
       tres totales.
     · Que al cargarle personas -incluida si llevaron récipe- los tres
       totales (atendidos, medicamentos, récipes) se cuentan solos, sin
       que nadie los escriba.
     · Que la pestaña "Registros" sigue mostrando a todo el mundo, de
       todas las jornadas, para buscar y corregir -pero SIN un botón de
       registrar suelto: para cargar gente nueva hay que entrar primero
       a su jornada.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/jornadas.mjs
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
const LUGAR = 'ZZZ CDI PRUEBA ' + MARCA
const NOMBRE1 = 'ZZZ PACIENTE UNO ' + MARCA
const NOMBRE2 = 'ZZZ PACIENTE DOS ' + MARCA
const CEDULA1 = String(9100000 + (Date.now() % 899999)).slice(0, 8)

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
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-jornadas`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
pag.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
pag.on('dialog', (d) => d.accept())

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const sinCargando = (id) => pag.waitForFunction(
  (elId) => !/Cargando|Buscando/.test((document.getElementById(elId) || {}).innerText || ''),
  { timeout: 25000 }, id)

try {
  console.log('='.repeat(64))
  console.log('JORNADAS: EVENTOS, SU EQUIPO Y SUS TOTALES QUE SE CUENTAN SOLOS')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir Jornadas ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.waitForSelector('#zona-inventario [data-p="jornadas"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="jornadas"]')
  await pag.waitForSelector('#joVistaTop', { timeout: 20000 })
  await sinCargando('joZona')

  console.log('\n--- 2. El menú de Mercancía quedó a la izquierda ---')
  const posiciones = await pag.evaluate(() => {
    const menu = document.querySelector('#zona-inventario .conmuta').getBoundingClientRect()
    const contenido = document.querySelector('#zona-inventario .panel-contenido').getBoundingClientRect()
    return { menuDer: menu.right, contenidoIzq: contenido.left, menuArriba: menu.top }
  })
  prueba('el menú queda a la izquierda del contenido', posiciones.menuDer <= posiciones.contenidoIzq + 1,
    JSON.stringify(posiciones))
  // "No se pierde al bajar" se comprueba más adelante, en Registros: con
  // 3975 fichas la página sí es más alta que la pantalla de verdad.

  console.log('\n--- 3. "Jornadas" abre EVENTOS, no personas ---')
  const pestanaOn = await pag.$eval('#joVistaTop [data-v="eventos"]', (b) => b.classList.contains('on'))
  prueba('la pestaña por defecto es "Jornadas"', pestanaOn, '')
  prueba('se ve el botón de crear una jornada nueva', !!(await pag.$('#joEvNueva')), '')
  prueba('todavía no se ve el buscador del listado plano de personas', !(await pag.$('#joBusca')), '')

  console.log('\n--- 4. Crear la jornada, con su equipo y sus firmas ---')
  await pag.click('#joEvNueva')
  await pag.waitForSelector('#joEvGuardar', { timeout: 20000 })
  await pag.click('#joEvFTipo [data-v="ruta_materna"]')
  await pag.evaluate(() => { document.getElementById('joEvFecha').value = '2026-09-10' })
  await pag.type('#joEvLugar', LUGAR)
  await pag.type('#joEvParroquia', 'ZZZ Parroquia Prueba')
  await pag.type('#joEvDietista', 'ZZZ Magaly Medina')
  await pag.type('#joEvAutoridad', 'ZZZ Autoridad Prueba')
  await pag.type('#joEvTrabajador', 'ZZZ Luis Solorzano')
  await pag.type('#joEvFirmaTxt', 'ZZZ Yuris')
  await pag.click('#joEvFirmaAgregar')
  await pag.type('#joEvFirmaTxt', 'ZZZ Juan')
  await pag.click('#joEvFirmaAgregar')
  await pag.waitForFunction(() => document.querySelectorAll('#joEvFirmas button').length === 2, { timeout: 10000 })
  prueba('se pueden agregar firmas antes de guardar', true)

  await pag.click('#joEvGuardar')
  await pag.waitForFunction(
    () => /qued[oó] creada/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  prueba('la jornada se crea sin pedir los tres totales', true)

  await pag.waitForSelector('#joDetAgregar', { timeout: 20000 })
  const detInicial = await pag.$eval('#joZona', (e) => e.innerText.replace(/\s+/g, ' '))
  prueba('al crearla, entra directo a su detalle', detInicial.includes(LUGAR), detInicial.slice(0, 120))
  prueba('empieza en cero -nada escrito a mano-',
    /0\s*pacientes atendidos/i.test(detInicial) && /0\s*medicamentos entregados/i.test(detInicial), detInicial.slice(0, 300))
  prueba('se ve el equipo que se anotó', detInicial.includes('ZZZ Magaly Medina'), detInicial.slice(0, 400))
  prueba('y quién firmó', detInicial.includes('ZZZ Yuris') && detInicial.includes('ZZZ Juan'), detInicial.slice(0, 400))

  const evento = await sql(`select id, tipo from farmacia.jornadas_eventos where lugar = '${LUGAR}';`)
  prueba('quedó en la base con el tipo elegido (ruta materna)', evento[0]?.tipo === 'ruta_materna', JSON.stringify(evento[0]))
  const eventoId = evento[0]?.id

  console.log('\n--- 5. Cargar a la primera persona, con récipe ---')
  await pag.click('#joDetAgregar')
  await pag.waitForSelector('#joNombre', { timeout: 20000 })
  const sinConjunto = !(await pag.$('#joConjunto'))
  prueba('no se pregunta el conjunto -ya lo dice la jornada-', sinConjunto, '')
  await pag.type('#joNombre', NOMBRE1)
  await pag.type('#joCedula', CEDULA1)
  await pag.click('#joSexo [data-v="F"]')
  await pag.type('#joTratamiento', 'SUERO ORAL / ALBENDAZOL / NUTAMIN')
  await pag.click('#joRecipe [data-v="si"]')
  await pag.click('#joGuardar')
  await pag.waitForFunction(
    () => /qued[oó] registrada/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })

  await pag.waitForFunction(
    () => /1\s*paciente atendido/i.test((document.getElementById('joZona') || {}).innerText || ''),
    { timeout: 20000 })
  let detalle = await pag.$eval('#joZona', (e) => e.innerText.replace(/\s+/g, ' '))
  prueba('vuelve sola al detalle de la jornada, ya contando a esta persona',
    /1\s*paciente atendido/i.test(detalle), detalle.slice(0, 200))
  prueba('cuenta las 3 piezas de su tratamiento como 3 medicamentos',
    /3\s*medicamentos entregados/i.test(detalle), detalle.slice(0, 200))
  prueba('y 1 con récipe', /1\s*con récipe/i.test(detalle), detalle.slice(0, 200))
  prueba('el detalle muestra NUTAMIN', detalle.includes('NUTAMIN'), detalle.slice(0, 400))

  console.log('\n--- 6. Segunda persona, sin récipe, con un medicamento repetido ---')
  await pag.click('#joDetAgregar')
  await pag.waitForSelector('#joNombre', { timeout: 20000 })
  await pag.type('#joNombre', NOMBRE2)
  await pag.click('#joSexo [data-v="M"]')
  await pag.type('#joTratamiento', 'NUTAMIN')
  await pag.click('#joRecipe [data-v="no"]')
  await pag.click('#joGuardar')
  await pag.waitForFunction(
    () => /qued[oó] registrada/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  await pag.waitForFunction(
    () => /2\s*pacientes atendidos/i.test((document.getElementById('joZona') || {}).innerText || ''),
    { timeout: 20000 })
  detalle = await pag.$eval('#joZona', (e) => e.innerText.replace(/\s+/g, ' '))
  prueba('ahora son 2 pacientes atendidos', /2\s*pacientes atendidos/i.test(detalle), detalle.slice(0, 200))
  prueba('4 medicamentos en total (3 + 1)', /4\s*medicamentos entregados/i.test(detalle), detalle.slice(0, 200))
  prueba('sigue en 1 con récipe -el segundo dijo que no-', /1\s*con récipe/i.test(detalle), detalle.slice(0, 200))

  const filaNutamin = await pag.evaluate(() => {
    const fila = [...document.querySelectorAll('#joZona table tr')].find(tr => tr.innerText.includes('NUTAMIN'))
    return fila ? fila.innerText.replace(/\s+/g, ' ') : null
  })
  prueba('NUTAMIN aparece UNA vez en el detalle, con 2 -no se funde ni se duplica la fila-',
    filaNutamin === 'NUTAMIN 2', filaNutamin)

  console.log('\n--- 7. Se puede abrir y corregir a alguien desde el detalle de su jornada ---')
  await pag.evaluate((n) => {
    [...document.querySelectorAll('#joZona .ficha')].find(b => b.innerText.includes(n)).click()
  }, NOMBRE1)
  await pag.waitForSelector('#joTelefono', { timeout: 20000 })
  await pag.type('#joTelefono', '04120000000')
  await pag.click('#joGuardar')
  await pag.waitForFunction(
    () => /qued[oó] corregida/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  await pag.waitForSelector('#joDetAgregar', { timeout: 20000 })
  prueba('al corregir, vuelve a la jornada -no a Registros-', true)
  const corregido = await sql(`select telefono from farmacia.jornadas_registros where nombre = '${NOMBRE1}';`)
  prueba('el cambio llegó a la base', corregido[0]?.telefono === '04120000000', JSON.stringify(corregido))

  console.log('\n--- 8. "Registros" sigue mostrando a todos, sin botón de registrar suelto ---')
  await pag.click('#joVistaTop [data-v="registros"]')
  await pag.waitForSelector('#joBusca', { timeout: 20000 })
  await sinCargando('joZona')
  prueba('no hay botón de "+Registrar" en el listado plano', !(await pag.$('#joNueva')), '')

  console.log('\n--- 8b. Con las 50 fichas de esta página, el menú no se pierde al bajar ---')
  await pag.evaluate(() => window.scrollBy(0, 700))
  await espera(300)
  const topTrasBajar = await pag.evaluate(() =>
    document.querySelector('#zona-inventario .conmuta').getBoundingClientRect().top)
  prueba('sigue pegado arriba después de hacer scroll', topTrasBajar <= 20, 'top: ' + topTrasBajar)
  await pag.evaluate(() => window.scrollTo(0, 0))

  await pag.type('#joBusca', NOMBRE1)
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE1)
  const fichaEnRegistros = await pag.$eval('#joRes .ficha', (e) => e.innerText)
  prueba('la persona cargada en la jornada también sale en Registros', fichaEnRegistros.includes(NOMBRE1), fichaEnRegistros)
  prueba('y dice que tiene récipe', /con récipe/i.test(fichaEnRegistros), fichaEnRegistros)

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-jornadas.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-jornadas', { recursive: true, force: true })
}

console.log('\n--- Limpieza ---')
const limpieza = await sql(`
delete from farmacia.jornadas_registros where nombre like 'ZZZ %';
`)
const limpiezaEv = await sql(`delete from farmacia.jornadas_eventos where lugar like 'ZZZ %' returning id;`)
const quedan = await sql(`select
  (select count(*) from farmacia.jornadas_registros where nombre like 'ZZZ %') registros,
  (select count(*) from farmacia.jornadas_eventos where lugar like 'ZZZ %') eventos;`)
prueba('no deja nada suyo en la base', Number(quedan[0]?.registros) === 0 && Number(quedan[0]?.eventos) === 0,
  JSON.stringify(quedan[0]))
console.log('  (se borró ' + (Array.isArray(limpiezaEv) ? limpiezaEv.length : 0) + ' jornada(s) de prueba)')

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas de jornadas.`)
}

/* JORNADAS: registrar, buscar, corregir y borrar un renglón.

   Comprueba, manejando el navegador de verdad, que la pantalla nueva de
   Jornadas (aparte de Personas, sin tocar pacientes ni tratamientos):

     · Está en Mercancía, como su propia pestaña.
     · Deja registrar uno nuevo con todos sus datos.
     · Se puede buscar por nombre y por cédula.
     · Se puede abrir y corregir.
     · Sin cédula o sin sexo, queda marcado "Por revisar" solo -nadie
       inventa el dato que falta.
     · Se puede borrar, y no deja rastro.

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
const NOMBRE = 'ZZZ PRUEBA JORNADA ' + MARCA
const CEDULA = String(9300000 + (Date.now() % 699999)).slice(0, 8)

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

try {
  console.log('='.repeat(64))
  console.log('JORNADAS: registrar, buscar, corregir y borrar')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })

  console.log('\n--- 2. Jornadas está en Mercancía, aparte de Personas ---')
  await pag.click('.areas [data-area="inventario"]')
  await espera(500)
  await pag.waitForSelector('#zona-inventario [data-p="jornadas"]', { timeout: 20000 })
  prueba('la pestaña Jornadas existe', true)
  await pag.click('#zona-inventario [data-p="jornadas"]')
  await pag.waitForSelector('#joNueva', { timeout: 20000 })
  prueba('se abre con la lista y el botón de registrar', true)

  console.log('\n--- 3. Registrar uno nuevo ---')
  await pag.click('#joNueva')
  await pag.waitForSelector('#joNombre', { timeout: 20000 })
  prueba('el formulario pide los datos', true)

  await pag.type('#joNombre', NOMBRE)
  await pag.type('#joCedula', CEDULA)
  await pag.click('#joSexo button[data-v="F"]')
  await pag.type('#joTratamiento', 'ZZZ-MEDICINA DE PRUEBA')
  await pag.type('#joDireccion', 'ZZZ SECTOR DE PRUEBA')
  await pag.click('#joGuardar')

  await pag.waitForFunction(
    () => /qued[oó] registrada/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  prueba('se registra y avisa', true)

  const base = await sql(`select id, estado, sexo, cedula from farmacia.jornadas_registros where nombre = '${NOMBRE}';`)
  prueba('quedó en la base, activo (tenía cédula y sexo)',
    base.length === 1 && base[0].estado === 'activo', JSON.stringify(base))
  const idNuevo = base[0]?.id

  const sinCargando = () => pag.waitForFunction(
    () => !/Buscando/.test((document.getElementById('joRes') || {}).innerText || ''),
    { timeout: 20000 })

  console.log('\n--- 4. Buscarlo por nombre y por cédula, con toda la información a la vista ---')
  await pag.waitForSelector('#joBusca', { timeout: 20000 })
  await pag.type('#joBusca', NOMBRE)
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE)
  prueba('aparece buscando por nombre', true)

  const targeta = await pag.$eval('#joRes .ficha', (e) => e.innerText)
  prueba('la ficha de la lista trae todo -cédula, dirección y tratamiento- sin tener que abrirla',
    targeta.includes(CEDULA) && targeta.includes('ZZZ SECTOR DE PRUEBA') && targeta.includes('ZZZ-MEDICINA DE PRUEBA'),
    targeta)

  await pag.evaluate(() => { document.getElementById('joBusca').value = '' })
  await pag.type('#joBusca', CEDULA)
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE)
  prueba('y buscando por cédula', true)

  console.log('\n--- 4b. La búsqueda avanzada también cubre dirección y tratamiento ---')
  await pag.evaluate(() => { document.getElementById('joBusca').value = '' })
  await pag.type('#joBusca', 'ZZZ SECTOR DE PRUEBA')
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE)
  prueba('se encuentra buscando por la dirección', true)

  await pag.evaluate(() => { document.getElementById('joBusca').value = '' })
  await pag.type('#joBusca', 'ZZZ-MEDICINA DE PRUEBA')
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE)
  prueba('y buscando por el tratamiento', true)

  console.log('\n--- 4c. El filtro de hoja/mes del Excel funciona ---')
  await pag.evaluate(() => { document.getElementById('joBusca').value = '' })
  await pag.select('#joHoja', 'JULIO A SEPTIEMBRE')
  await sinCargando()
  const totalJulSep = await pag.$eval('#joRes .conteo', (e) => Number((e.textContent.match(/\d+/) || [0])[0]))
  await pag.select('#joHoja', 'RUTA MATERNA MES JULIO')
  await sinCargando()
  const totalRuta = await pag.$eval('#joRes .conteo', (e) => Number((e.textContent.match(/\d+/) || [0])[0]))
  prueba('el filtro por hoja del Excel de verdad acota la lista',
    totalJulSep > 0 && totalRuta > 0 && totalJulSep !== totalRuta,
    `julio-septiembre=${totalJulSep} · ruta materna=${totalRuta}`)
  await pag.select('#joHoja', 'todos')
  await sinCargando()

  console.log('\n--- 5. Abrirlo y corregirle el teléfono ---')
  await pag.evaluate(() => { document.getElementById('joBusca').value = '' })
  await pag.type('#joBusca', CEDULA)
  await pag.waitForFunction(
    (n) => (document.getElementById('joRes') || {}).innerText.includes(n),
    { timeout: 20000 }, NOMBRE)
  await pag.click('.ficha')
  await pag.waitForSelector('#joTelefono', { timeout: 20000 })
  await pag.type('#joTelefono', '04120000000')
  await pag.click('#joGuardar')
  await pag.waitForFunction(
    () => /qued[oó] corregida/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  const corregido = await sql(`select telefono from farmacia.jornadas_registros where id = '${idNuevo}';`)
  prueba('el teléfono llegó a la base', corregido[0]?.telefono === '04120000000', JSON.stringify(corregido))

  console.log('\n--- 6. Sin cédula ni sexo, queda "por revisar" solo ---')
  await pag.waitForSelector('#joNueva', { timeout: 20000 })
  await pag.click('#joNueva')
  await pag.waitForSelector('#joNombre', { timeout: 20000 })
  const NOMBRE2 = NOMBRE + ' SIN DATOS'
  await pag.type('#joNombre', NOMBRE2)
  await pag.click('#joGuardar')
  await pag.waitForFunction(
    () => /qued[oó] registrada/i.test((document.getElementById('joAviso') || {}).textContent || ''),
    { timeout: 20000 })
  const sinDatos = await sql(`select estado, cedula, sexo, motivo_revision from farmacia.jornadas_registros where nombre = '${NOMBRE2}';`)
  prueba('queda "por_revisar", sin inventarle cédula ni sexo',
    sinDatos[0]?.estado === 'por_revisar' && !sinDatos[0]?.cedula && !sinDatos[0]?.sexo, JSON.stringify(sinDatos[0]))
  prueba('y dice por qué',
    /cedula vacia/i.test(sinDatos[0]?.motivo_revision || '') && /sexo vacio/i.test(sinDatos[0]?.motivo_revision || ''),
    sinDatos[0]?.motivo_revision)

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
const limpieza = await sql(`delete from farmacia.jornadas_registros where nombre like 'ZZZ %' returning id;`)
const quedan = await sql(`select count(*) as n from farmacia.jornadas_registros where nombre like 'ZZZ %';`)
prueba('no deja nada suyo en la base', Number(quedan[0]?.n) === 0, JSON.stringify(quedan))
console.log('  (se borraron ' + (Array.isArray(limpieza) ? limpieza.length : 0) + ' registro(s) de prueba)')

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas de jornadas.`)
}

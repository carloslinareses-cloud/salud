/* ENTREGAR → "Varios niños con el mismo récipe": un adulto trae a
   varios niños de una vez y se registran todos juntos, cada uno con su
   propia ficha, sin tener que repetir la búsqueda ni los datos del
   adulto varias veces.

   Comprueba, manejando el navegador de verdad:
     · El botón nuevo abre el formulario de varios niños.
     · Se pueden agregar niños, y uno de ellos SIN cédula (muchos niños
       no tienen).
     · Un niño que se deja completamente en blanco no se guarda ni
       revienta el envío de los demás.
     · Cada niño queda con SU PROPIA ficha (no se mezclan datos).
     · Queda anotado quién los trae, en la solicitud de cada uno.
     · Las medicinas que se le anotaron a cada niño son solo las suyas.
     · "Ver su ficha" abre la ficha correcta de ese niño.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/despacho-varios-ninos.mjs
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
const ADULTO = 'ZZZ ADULTO VARIOS NINOS ' + MARCA
const NINO1 = 'ZZZ NINO UNO ' + MARCA
const NINO2 = 'ZZZ NINO DOS ' + MARCA
const CEDULA_ADULTO = String(9300000 + (Date.now() % 599999)).slice(0, 8)
const CEDULA_NINO1 = String(9500000 + (Date.now() % 399999)).slice(0, 8)

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
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-varios-ninos`],
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
  console.log('ENTREGAR → VARIOS NIÑOS CON EL MISMO RÉCIPE')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir el formulario ---')
  await pag.goto(`http://127.0.0.1:${PUERTO}/`, { waitUntil: 'domcontentloaded' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="despacho"]')
  await espera(500)
  await pag.waitForSelector('#btnVariosNinos', { timeout: 20000 })
  await pag.click('#btnVariosNinos')
  await pag.waitForSelector('#ninosGuardar', { timeout: 20000 })
  prueba('arranca con un solo niño', (await pag.$$('.ficha-nino')).length === 1)

  console.log('\n--- 2. Quién los trae (el adulto, que NO es paciente) ---')
  await pag.type('#traeNombre', ADULTO)
  await pag.type('#traeCedula', CEDULA_ADULTO)
  await pag.type('#ninosIndicado', 'Dr. ZZZ Pediatra de prueba')

  console.log('\n--- 3. Niño 1: con cédula y una medicina ---')
  await pag.type('#nino0Nombre', NINO1)
  await pag.type('#nino0Cedula', CEDULA_NINO1)
  await pag.click('#nino0Sexo [data-s="M"]')
  await pag.type('#nino0Edad', '5 años')
  await pag.type('#nino0Busca', 'zzz-medicina-que-no-existe-en-catalogo')
  await espera(500)
  await pag.waitForSelector('#nino0AMano', { timeout: 8000 })
  await pag.click('#nino0AMano')
  await pag.waitForFunction(() => (document.getElementById('nino0Elegidos') || {}).innerText.includes('zzz-medicina'), { timeout: 8000 })

  console.log('\n--- 4. Agregar niño 2: SIN cédula (muchos niños no tienen) ---')
  await pag.click('#ninoAgregar')
  await pag.waitForSelector('#nino1Nombre', { timeout: 8000 })
  prueba('ya hay 2 niños en pantalla', (await pag.$$('.ficha-nino')).length === 2)
  await pag.type('#nino1Nombre', NINO2)
  // Cédula del niño 2 se deja en blanco a propósito.
  await pag.click('#nino1Sexo [data-s="F"]')
  await pag.type('#nino1Edad', '2 años')

  console.log('\n--- 5. Agregar un 3er niño y dejarlo completamente en blanco ---')
  await pag.click('#ninoAgregar')
  await pag.waitForSelector('#nino2Nombre', { timeout: 8000 })
  prueba('ya hay 3 niños en pantalla', (await pag.$$('.ficha-nino')).length === 3)
  // No se escribe nada en el niño 3: debe omitirse solo, sin bloquear a los otros dos.

  console.log('\n--- 6. Registrar ---')
  await pag.click('#ninosGuardar')
  await pag.waitForFunction(() => /registrado/i.test((document.getElementById('ninosResultado') || {}).innerText || ''), { timeout: 25000 })
  const resTxt = await pag.$eval('#ninosResultado', (e) => e.innerText)
  prueba('dice "2 de 2 niños registrados" (el en blanco no cuenta ni falla)', /2 de 2/.test(resTxt), resTxt)
  prueba('aparece el nombre del niño 1 en el resultado', resTxt.includes(NINO1))
  prueba('aparece el nombre del niño 2 en el resultado', resTxt.includes(NINO2))

  console.log('\n--- 7. Cada niño quedó con SU PROPIA ficha, no mezclados ---')
  const filaNino1 = await sql(`select id, nombre, cedula, edad_texto, sexo from farmacia.pacientes where nombre = '${NINO1}';`)
  const filaNino2 = await sql(`select id, nombre, cedula, edad_texto, sexo from farmacia.pacientes where nombre = '${NINO2}';`)
  const filaAdulto = await sql(`select id from farmacia.pacientes where nombre = '${ADULTO}';`)
  prueba('el niño 1 quedó registrado, con su cédula', filaNino1[0]?.cedula === CEDULA_NINO1, JSON.stringify(filaNino1[0]))
  prueba('el niño 2 quedó registrado, SIN cédula (no se inventó una)', filaNino2.length === 1 && filaNino2[0].cedula == null, JSON.stringify(filaNino2[0]))
  prueba('el adulto que los trae NO quedó como paciente', filaAdulto.length === 0, JSON.stringify(filaAdulto))

  console.log('\n--- 8. Queda anotado quién los trae, en la solicitud de cada niño ---')
  const solNino1 = await sql(`select via, motivo, indicado_por from farmacia.solicitudes where paciente_id = '${filaNino1[0].id}';`)
  prueba('la solicitud del niño 1 es por récipe', solNino1[0]?.via === 'recipe', JSON.stringify(solNino1[0]))
  prueba('el motivo dice quién lo trae', (solNino1[0]?.motivo || '').includes(ADULTO) && solNino1[0].motivo.includes(CEDULA_ADULTO), JSON.stringify(solNino1[0]))
  prueba('quedó anotado quién lo indicó', solNino1[0]?.indicado_por === 'Dr. ZZZ Pediatra de prueba', JSON.stringify(solNino1[0]))

  console.log('\n--- 9. Las medicinas de un niño no se mezclan con las del otro ---')
  const tratNino1 = await sql(`select texto_original from farmacia.tratamientos_paciente where paciente_id = '${filaNino1[0].id}';`)
  const tratNino2 = await sql(`select texto_original from farmacia.tratamientos_paciente where paciente_id = '${filaNino2[0].id}';`)
  prueba('el niño 1 tiene su medicina anotada', tratNino1.some((t) => (t.texto_original || '').includes('zzz-medicina')), JSON.stringify(tratNino1))
  prueba('el niño 2 NO tiene la medicina del niño 1 (no se mezclaron)', tratNino2.length === 0, JSON.stringify(tratNino2))

  console.log('\n--- 10. "Ver su ficha" abre la ficha correcta ---')
  await pag.evaluate(() => {
    const b = [...document.querySelectorAll('[data-ver-id]')][0]
    if (b) b.click()
  })
  await pag.waitForFunction((n) => ((document.getElementById('zonaDestino') || {}).innerText || '').includes(n), { timeout: 15000 }, NINO1)
  prueba('abrió la ficha del niño correcto', true)

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la página no lanzó ningún error', graves.length === 0, graves.slice(0, 5).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { console.log('  URL al momento del fallo: ' + pag.url()) } catch {}
  if (errores.length) { console.log('  Errores capturados:'); errores.forEach((er) => console.log('    ' + er)) }
  try { await pag.screenshot({ path: RAIZ + '/fallo-varios-ninos.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-varios-ninos', { recursive: true, force: true })
}

console.log('\n--- Limpieza ---')
await sql(`delete from farmacia.tratamientos_paciente where paciente_id in (select id from farmacia.pacientes where nombre like 'ZZZ NINO%${MARCA}' or nombre like 'ZZZ ADULTO%${MARCA}');`)
await sql(`delete from farmacia.solicitudes where paciente_id in (select id from farmacia.pacientes where nombre like 'ZZZ NINO%${MARCA}' or nombre like 'ZZZ ADULTO%${MARCA}');`)
await sql(`delete from farmacia.pacientes where nombre like 'ZZZ NINO%${MARCA}' or nombre like 'ZZZ ADULTO%${MARCA}';`)
const quedan = await sql(`select count(*) n from farmacia.pacientes where nombre like '%${MARCA}';`)
prueba('no deja nada suyo en la base', Number(quedan[0]?.n) === 0, JSON.stringify(quedan[0]))

console.log('\n' + '='.repeat(64))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach((f) => console.log('   - ' + f))
  process.exit(1)
} else {
  console.log(`Pasaron las ${ok} pruebas.`)
}

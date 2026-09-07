/* LA PANTALLA DE CARGA DEL INVENTARIO.

   Cinco datos y listo: insumo, presentacion y componentes, lote, fecha de
   vencimiento y cantidad. Comprueba que:
     · crea el insumo si no existe,
     · reutiliza el lote si ya existe en vez de abrir otro igual,
     · y que la existencia queda bien en los dos casos.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/carga-rapida.mjs
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
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN (hace falta para limpiar).'); process.exit(2) }

const REF = 'tfbzghjjfcaqmkzsxrrs'
const MARCA = Math.floor(Date.now() / 1000).toString(36).toUpperCase()
const INSUMO = 'ZZZ-CARGA ' + MARCA
const PRES = 'Caja de 30 tabletas de 50 mg'
const LOTE = 'ZZZC' + MARCA
const CANT1 = 90
const CANT2 = 30   // se le suma al MISMO lote
const VENCE = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10)

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

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-chrome`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return t }
}

async function cargar(lote, cant, vence) {
  await pag.evaluate(() => { document.getElementById('avisoInv').innerHTML = '' })
  await pag.evaluate(v => {
    document.getElementById('rInsumo').value = v.insumo
    document.getElementById('rPres').value = v.pres
    document.getElementById('rLote').value = v.lote
    document.getElementById('rVence').value = v.vence
    document.getElementById('rCant').value = String(v.cant)
  }, { insumo: INSUMO, pres: PRES, lote: lote, vence: vence, cant: cant })
  await pag.click('#rGuardar')
  await pag.waitForFunction(
    () => /Registradas|No se pudo/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  return pag.$eval('#avisoInv', e => e.textContent.trim())
}

try {
  console.log('='.repeat(62))
  console.log('CARGA DEL INVENTARIO · cinco datos')
  console.log('='.repeat(62))

  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#formAcceso')
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 20000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 25000 })
  await pag.click('.areas [data-area="inventario"]')
  await pag.waitForSelector('#rGuardar', { timeout: 25000 })

  const campos = await pag.evaluate(() => ({
    insumo: !!document.getElementById('rInsumo'),
    pres: !!document.getElementById('rPres'),
    lote: !!document.getElementById('rLote'),
    vence: !!document.getElementById('rVence'),
    cant: !!document.getElementById('rCant'),
    rotulos: [...document.querySelectorAll('#zonaInv label')].map(l => l.textContent.trim()),
  }))
  prueba('la pantalla de carga es la primera que sale', true)
  prueba('pide los cinco datos y nada mas',
    campos.insumo && campos.pres && campos.lote && campos.vence && campos.cant &&
    campos.rotulos.length === 5, JSON.stringify(campos.rotulos))

  console.log('\n--- Cargar algo nuevo ---')
  let msg = await cargar(LOTE, CANT1, VENCE)
  prueba('registra el insumo nuevo con su lote', /Registradas/i.test(msg), msg)

  let f = await sql(`select p.nombre, p.presentacion, l.codigo, l.vence, v.existencia
     from farmacia.v_existencia_lote v
     join farmacia.lotes l on l.id = v.lote_id
     join farmacia.productos p on p.id = l.producto_id
    where p.nombre = '${INSUMO}';`)
  prueba('quedo un solo lote con la cantidad correcta',
    Array.isArray(f) && f.length === 1 && Number(f[0].existencia) === CANT1, JSON.stringify(f))
  prueba('guardo la presentacion y los componentes',
    f[0] && f[0].presentacion === PRES, JSON.stringify(f[0] && f[0].presentacion))

  console.log('\n--- Cargar MAS del mismo lote ---')
  msg = await cargar(LOTE, CANT2, VENCE)
  prueba('avisa que se lo sumo a un lote que ya existia', /ya existía/i.test(msg), msg)

  f = await sql(`select count(*) lotes, sum(v.existencia) total
     from farmacia.v_existencia_lote v
     join farmacia.lotes l on l.id = v.lote_id
     join farmacia.productos p on p.id = l.producto_id
    where p.nombre = '${INSUMO}';`)
  prueba('NO abrio un lote repetido', Number(f[0].lotes) === 1, JSON.stringify(f[0]))
  prueba(`la existencia quedo en ${CANT1 + CANT2}`,
    Number(f[0].total) === CANT1 + CANT2, JSON.stringify(f[0]))

  f = await sql(`select count(*) c from farmacia.productos where nombre = '${INSUMO}';`)
  prueba('NO creo el insumo dos veces', Number(f[0].c) === 1, JSON.stringify(f[0]))

  console.log('\n--- Cargar OTRO lote del mismo insumo ---')
  msg = await cargar(LOTE + 'B', 15, VENCE)
  f = await sql(`select count(*) lotes, sum(v.existencia) total
     from farmacia.v_existencia_lote v
     join farmacia.lotes l on l.id = v.lote_id
     join farmacia.productos p on p.id = l.producto_id
    where p.nombre = '${INSUMO}';`)
  prueba('ahora si abre un lote aparte', Number(f[0].lotes) === 2, JSON.stringify(f[0]))
  prueba('y la existencia suma los dos lotes',
    Number(f[0].total) === CANT1 + CANT2 + 15, JSON.stringify(f[0]))

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|404|net::ERR_/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 2).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-carga.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-chrome', { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza */
await sql(`
begin;
set local session_replication_role = replica;
delete from farmacia.bitacora
 where registro_id in (select m.id::text from farmacia.movimientos m
                        join farmacia.lotes l on l.id = m.lote_id
                        join farmacia.productos p on p.id = l.producto_id
                       where p.nombre like 'ZZZ-CARGA%')
    or registro_id in (select l.id::text from farmacia.lotes l
                        join farmacia.productos p on p.id = l.producto_id
                       where p.nombre like 'ZZZ-CARGA%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-CARGA%');
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-CARGA%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-CARGA%';
delete from farmacia.productos where nombre like 'ZZZ-CARGA%';
set local session_replication_role = origin;
commit;`)
const resto = await sql(`select count(*) c from farmacia.productos where nombre like 'ZZZ-CARGA%';`)
prueba('la prueba no deja nada suyo en la base', Number(resto[0].c) === 0, JSON.stringify(resto))

console.log('\n' + '='.repeat(62))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas de carga.`)

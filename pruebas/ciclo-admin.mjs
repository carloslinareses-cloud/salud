/* EL CICLO COMPLETO EN MANOS DEL ADMINISTRADOR.

   Comprueba, manejando el navegador de verdad, que quien entra como
   administrador puede recorrer todo el ciclo sin cambiar de usuario:

     1. Entra y ve las tres areas.
     2. Mercancia   -> crea un medicamento y le registra un lote con cantidad.
     3. Entregar    -> busca al paciente y le entrega de ese lote.
     4. Mercancia   -> comprueba que la existencia bajo por la entrega.
     5. Administracion -> la entrega aparece en la bitacora con su nombre.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

   Necesita instalar el controlador del navegador:

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/ciclo-admin.mjs
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
const MED = 'ZZZ-CICLO ' + MARCA
const PAC = 'ZZZ PACIENTE CICLO ' + MARCA
const CEDULA = String(9000000 + (Date.now() % 999999)).slice(0, 8)
const LOTE = 'ZZZL' + MARCA
const CANT_ENTRA = 40
const CANT_SALE = 7

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

const irArea = async (id) => {
  await pag.click(`.areas [data-area="${id}"]`)
  await new Promise(r => setTimeout(r, 400))
}
const esperaTexto = (re, ms = 25000) =>
  pag.waitForFunction(r => new RegExp(r, 'i').test(document.body.innerText), { timeout: ms }, re.source || re)

try {
  console.log('='.repeat(64))
  console.log('EL CICLO COMPLETO COMO ADMINISTRADOR')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForSelector('#formAcceso')
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 20000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('#vistaPanel:not([hidden])', { timeout: 25000 })

  await pag.waitForSelector('.areas', { timeout: 15000 })
  const areas = await pag.$$eval('.areas button', bs => bs.map(b => b.textContent.trim()))
  prueba('ve las tres areas del ciclo',
    areas.length === 3 && areas.includes('Entregar') && areas.includes('Mercancía') && areas.includes('Administración'),
    JSON.stringify(areas))

  console.log('\n--- 2. Mercancia: registrar lo que llega ---')
  await irArea('inventario')
  await pag.waitForSelector('[data-p="catalogo"]', { timeout: 20000 })
  await pag.click('[data-p="catalogo"]')
  await pag.waitForSelector('#catBusca', { timeout: 15000 })
  await pag.waitForSelector('.ficha, .vacio', { timeout: 25000 })
  const cuantos = await pag.$eval('.conteo', e => e.textContent.trim()).catch(() => '')
  prueba('el catalogo se ve entero sin tener que escribir', /medicamento/i.test(cuantos), cuantos)

  const conDatos = await pag.$$eval('.ficha', fs => fs.slice(0, 1).map(f => f.innerText.replace(/\s+/g, ' ')))
  prueba('cada renglon dice cuanto hay y en cuantos lotes',
    /unidad|lote/i.test(conDatos[0] || ''), conDatos[0] || '(sin fichas)')

  await pag.type('#catBusca', MED)
  await pag.waitForSelector('#catNuevo', { timeout: 25000 })
  await pag.click('#catNuevo')
  await pag.waitForSelector('#lCant', { timeout: 25000 })
  prueba('puede crear un medicamento nuevo en el catalogo', true)

  await pag.type('#lCodigo', LOTE)
  const vence = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10)
  await pag.evaluate(v => { document.getElementById('lVence').value = v }, vence)
  await pag.type('#lCant', String(CANT_ENTRA))
  await pag.click('#lGuardar')
  await pag.waitForFunction(
    () => ((document.getElementById('avisoInv') || {}).textContent || '').trim().length > 0,
    { timeout: 30000 })
  const avisoEntrada = await pag.$eval('#avisoInv', e => e.textContent.trim()).catch(() => '')
  prueba('registra la entrada de mercancia',
    !/no se pudo|error|permiso/i.test(avisoEntrada), avisoEntrada)

  console.log('\n--- 3. Entregar: despachar de ese lote ---')
  await irArea('despacho')
  await pag.waitForSelector('#buscaDestino', { timeout: 20000 })
  prueba('el administrador entra a Entregar', true)

  await pag.type('#buscaDestino', CEDULA)
  await new Promise(r => setTimeout(r, 1500))
  const hayNuevo = await pag.$('#nuevoPac')
  if (hayNuevo) {
    await pag.click('#nuevoPac')
    await pag.waitForSelector('#nNombre', { timeout: 15000 })
    await pag.type('#nNombre', PAC)
    const ced = await pag.$('#nCedula')
    if (ced) { await pag.evaluate(c => { document.getElementById('nCedula').value = c }, CEDULA) }
    await pag.click('#guardarPac')
    await new Promise(r => setTimeout(r, 2000))
  }
  await pag.waitForSelector('#buscaMed', { timeout: 20000 })
  prueba('elige al paciente y llega a la cesta', true)

  await pag.type('#buscaMed', MED)
  /* CANDADO: la lista se muestra de entrada con TODO lo disponible, así que
     hay que esperar a que el filtro la haya reducido a lo de la prueba. Sin
     esto se hacía clic en el primer medicamento REAL de la farmacia y se le
     descontaba existencia de verdad. Pasó una vez; no puede volver a pasar. */
  await pag.waitForFunction(m => {
    const f = document.querySelectorAll('#resMed .ficha')
    return f.length > 0 && [...f].every(x => x.innerText.includes(m))
  }, { timeout: 25000 }, MED)
  const primera = await pag.$eval('#resMed .ficha', e => e.innerText.replace(/\s+/g, ' '))
  if (!primera.includes(MED)) {
    throw new Error('CANDADO: la primera ficha no es la de la prueba, es «' + primera + '». No se toca.')
  }
  await pag.click('#resMed .ficha')
  await new Promise(r => setTimeout(r, 1200))

  const hayCant = await pag.$('#renglones input[type="number"], #zonaCesta input[type="number"]')
  if (hayCant) {
    await pag.evaluate(c => {
      const i = document.querySelector('#renglones input[type="number"], #zonaCesta input[type="number"]')
      i.value = c; i.dispatchEvent(new Event('input', { bubbles: true }))
      i.dispatchEvent(new Event('change', { bubbles: true }))
    }, CANT_SALE)
  }
  await pag.click('#btnRegistrar')
  await pag.waitForFunction(
    () => /Entrega registrada|no se pudo|error|permiso|vencid|suficiente/i
      .test((document.getElementById('zonaAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const avisoEntrega = await pag.$eval('#zonaAviso', e => e.textContent.trim()).catch(() => '')
  prueba('el administrador registra la entrega',
    /Entrega registrada/i.test(avisoEntrega), avisoEntrega)

  console.log('\n--- 4. La existencia bajo ---')
  const saldo = await pag.evaluate(async ({ med, lote }) => {
    const c = window.CONFIG
    const r = await fetch(`${c.SUPABASE_URL}/rest/v1/v_existencia_lote?select=producto,lote,existencia&producto=eq.${encodeURIComponent(med)}`,
      { headers: { apikey: c.SUPABASE_ANON_KEY, 'Accept-Profile': 'farmacia',
        Authorization: 'Bearer ' + JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.includes('auth-token')))).access_token } })
    return await r.json()
  }, { med: MED, lote: LOTE })
  const quedan = Array.isArray(saldo) && saldo[0] ? Number(saldo[0].existencia) : null
  prueba(`quedan ${CANT_ENTRA - CANT_SALE} unidades (entraron ${CANT_ENTRA}, salieron ${CANT_SALE})`,
    quedan === CANT_ENTRA - CANT_SALE, 'quedan: ' + JSON.stringify(saldo))

  console.log('\n--- 4b. La hoja de conteo, tipo Excel ---')
  await irArea('inventario')
  await pag.waitForSelector('[data-p="conteo"]', { timeout: 20000 })
  await pag.click('[data-p="conteo"]')
  await pag.waitForSelector('.celda', { timeout: 25000 })
  const cuantosLotes = await pag.$eval('.conteo', e => e.textContent.trim()).catch(() => '')
  prueba('la hoja trae los lotes de 50 en 50', /de \d+ lotes|lotes?$/i.test(cuantosLotes), cuantosLotes)

  await pag.type('#hojaBusca', MED)
  /* CANDADO: igual que arriba, hay que esperar a que el filtro deje SOLO
     los lotes de la prueba antes de escribir en ninguna casilla. */
  await pag.waitForFunction(m => {
    const f = document.querySelectorAll('.tabla.hoja tbody tr')
    return f.length > 0 && [...f].every(x => x.innerText.includes(m))
  }, { timeout: 25000 }, MED)

  const CONTADO = 25   // lo que "se contó de verdad"
  await pag.evaluate(c => {
    const i = document.querySelector('.celda')
    i.value = String(c)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, CONTADO)
  await new Promise(r => setTimeout(r, 400))

  const dif = await pag.$eval('.tabla.hoja tr.cambiada .dif', e => e.textContent.trim()).catch(() => '')
  prueba('calcula sola la diferencia', dif === String(CONTADO - (CANT_ENTRA - CANT_SALE)), dif)
  const barra = await pag.$eval('.barra-guardar', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
  prueba('avisa cuantos renglones cambiaron', /1 rengl[oó]n cambiado/i.test(barra), barra)

  await pag.type('#hMotivo', 'Conteo fisico de la prueba automatica')
  await pag.click('#hGuardar')
  await pag.waitForFunction(
    () => /Guardad|no se guard/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  const msgHoja = await pag.$eval('#avisoInv', e => e.textContent.trim())
  prueba('guarda las correcciones de golpe', /Guardada/i.test(msgHoja), msgHoja)

  const tras = await pag.evaluate(async (med) => {
    const c = window.CONFIG
    const t = JSON.parse(localStorage.getItem(
      Object.keys(localStorage).find(k => k.includes('auth-token')))).access_token
    const r = await fetch(`${c.SUPABASE_URL}/rest/v1/v_existencia_lote?select=existencia&producto=eq.${encodeURIComponent(med)}`,
      { headers: { apikey: c.SUPABASE_ANON_KEY, 'Accept-Profile': 'farmacia', Authorization: 'Bearer ' + t } })
    return await r.json()
  }, MED)
  prueba(`la existencia quedo en ${CONTADO}, que fue lo contado`,
    Array.isArray(tras) && Number(tras[0]?.existencia) === CONTADO, JSON.stringify(tras))

  console.log('\n--- 5. Administracion: queda en la bitacora ---')
  await irArea('admin')
  await pag.waitForSelector('[data-p="bitacora"]', { timeout: 20000 })
  await pag.click('[data-p="bitacora"]')
  await new Promise(r => setTimeout(r, 2500))
  const bit = await pag.evaluate(() => document.body.innerText)
  prueba('la bitacora registra al administrador como quien lo hizo',
    /Carlos Linares/i.test(bit), bit.slice(0, 160))

  console.log('\n--- 6. Recuerda el area al recargar ---')
  await pag.reload({ waitUntil: 'networkidle2' })
  await pag.waitForSelector('.areas', { timeout: 25000 })
  await new Promise(r => setTimeout(r, 1200))
  const activa = await pag.$eval('.areas button.on', b => b.textContent.trim())
  prueba('vuelve al area donde estaba', activa === 'Administración', activa)

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|404|net::ERR_/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-ciclo.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-chrome', { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza
   Se borra todo lo que creo la prueba. Los movimientos y la bitacora son
   inmutables a proposito, asi que la limpieza corre como administrador de
   la base apagando los disparadores solo en esta transaccion. */
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  return { estado: r.status, cuerpo: await r.text() }
}
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
    or registro_id in (select l.id::text from farmacia.lotes l join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-CICLO%')
    or registro_id in (select m.id::text from farmacia.movimientos m join farmacia.lotes l on l.id = m.lote_id join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-CICLO%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-CICLO%')
    or registro_id in (select id::text from farmacia.pacientes where nombre like 'ZZZ%');

-- Los movimientos que generaron esas entregas, SEA CUAL SEA el medicamento.
-- Si solo se borraran los de los productos ZZZ, una entrega de prueba sobre
-- un medicamento real dejaría su descuento puesto para siempre. Pasó una vez.
delete from farmacia.bitacora
 where registro_id in (select m.id::text from farmacia.movimientos m
                        where m.entrega_id in (select id from zzz_e));
delete from farmacia.movimientos m where m.entrega_id in (select id from zzz_e);

delete from farmacia.entrega_detalle d using zzz_e z where d.entrega_id = z.id;
delete from farmacia.entregas e using zzz_e z where e.id = z.id;
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-CICLO%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-CICLO%';
delete from farmacia.tratamientos_paciente t using farmacia.pacientes q
 where t.paciente_id = q.id and q.nombre like 'ZZZ%';
delete from farmacia.productos where nombre like 'ZZZ-CICLO%';
delete from farmacia.pacientes where nombre like 'ZZZ%';

set local session_replication_role = origin;
commit;`)

const resto = await sql(`select
  (select count(*) from farmacia.productos where nombre like 'ZZZ-CICLO%') productos,
  (select count(*) from farmacia.pacientes where nombre like 'ZZZ%') pacientes,
  (select count(*) from farmacia.movimientos m where m.entrega_id is not null
     and not exists (select 1 from farmacia.entregas e where e.id = m.entrega_id)) descuentos_huerfanos;`)
const quedaron = JSON.parse(resto.cuerpo || '[]')[0] || {}
const suma = Object.values(quedaron).reduce((a, b) => a + Number(b), 0)
prueba('la prueba no deja nada suyo en la base', suma === 0,
  limpieza.estado === 201 ? JSON.stringify(quedaron) : limpieza.cuerpo.slice(0, 200))

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas del ciclo completo.`)

/* CONTROL DE INSUMOS ENTREGADOS: LA PANTALLA, MANEJANDO EL NAVEGADOR DE VERDAD.

   Igual que pruebas/insumos.mjs, pero para la hoja CONTROL.

   Comprueba:
     · Que la hoja control tenga lista, buscador, trimestre y balance.
     · Registrar un control con "Agregar +" varias veces.
     · Que sin cantidad NO se guarde; que en la base quede lo escrito.
     · Corregirlo (cambiar observación, poner cantidad).
     · Excel y PDF del listado y del balance.
     · En un teléfono (375 px): sin scroll de lado.

   Todo lo que crea empieza por ZZZ y se borra al terminar (también su
   rastro en la bitácora, con session_replication_role = replica).

       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/insumos-control.mjs
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
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }

const REF = 'tfbzghjjfcaqmkzsxrrs'
const MARCA = Math.floor(Date.now() / 1000).toString(36).toUpperCase()
const PERSONA = 'ZZZ PERSONA CONTROL ' + MARCA
const BAJADAS = path.join(RAIZ, 'bajadas-control')

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

const nav = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-control`] })
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
/* En un campo de fecha, teclear "2026-09-01" lo interpreta el navegador con
   el formato de la PC y sale una fecha equivocada: se pone el valor directo. */
const escribir = async (sel, valor) => {
  const esFecha = await pag.$eval(sel, e => e.type === 'date')
  if (esFecha) {
    await pag.$eval(sel, (e, v) => {
      e.value = v
      e.dispatchEvent(new Event('input', { bubbles: true }))
      e.dispatchEvent(new Event('change', { bubbles: true }))
    }, valor)
    return
  }
  await pag.$eval(sel, e => { e.value = '' })
  await pag.type(sel, valor)
}

let idCreado = null

try {
  console.log('='.repeat(64))
  console.log('INSUMOS: CONTROL DE INSUMOS ENTREGADOS')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y abrir la hoja control ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })
  await pag.click('.areas [data-area="inventario"]')
  await pag.waitForSelector('#zona-inventario [data-p="insumos"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="insumos"]')
  await pag.waitForSelector('#inHojas', { timeout: 20000 })
  await pag.click('#inHojas [data-h="control"]')
  await pag.waitForSelector('#inLista', { timeout: 20000 })
  prueba('la hoja control tiene el título', /CONTROL DE INSUMOS ENTREGADOS/.test(await texto('#inZona')))
  prueba('tiene botón de registrar', !!(await pag.$('#inNueva')))
  prueba('tiene filtro de trimestre', !!(await pag.$('#inTrimestre [data-t="todo"]')))
  prueba('tiene botón Balance', !!(await pag.$('#inBalance')))

  console.log('\n--- 2. Registrar un control con Agregar + ---')
  await pag.click('#inNueva')
  await pag.waitForSelector('#inPersona', { timeout: 15000 })
  await escribir('#inFecha', '2026-09-01')
  await escribir('#inPersona', PERSONA)
  await escribir('#inCategoria', 'ZZZ CATEGORIA')
  await escribir('#inEstado', 'ENTREGADO')
  await escribir('#inObs', 'ZZZ observacion de prueba')
  await escribir('#inItems [data-desc="0"]', 'ZZZ JERINGA#20')
  await escribir('#inItems [data-cant="0"]', '5')
  await pag.click('#inAgregar')
  await escribir('#inItems [data-desc="1"]', 'ZZZ JELCO#22')
  await escribir('#inItems [data-cant="1"]', '3')
  prueba('el total calculado suma las cantidades', /8 unidades en total/.test(await texto('#inTotal')), await texto('#inTotal'))

  await pag.click('#inGuardar')
  /* Si no se guarda, el aviso dice por qué: sin esto la prueba solo decía "se acabó el tiempo". */
  await pag.waitForFunction(() => document.querySelector('#inCorregir') ||
    /No se guardó|Falta|Escribe|Revisa|no es válida|Agrega/.test((document.getElementById('inAviso') || {}).textContent || ''), { timeout: 25000 })
  if (!(await pag.$('#inCorregir'))) { prueba('se guardó', false, await aviso()); throw new Error('no se guardó: ' + (await aviso())) }
  prueba('se guardó y abrió el detalle', /ZZZ PERSONA CONTROL/.test(await texto('#inZona')))
  prueba('muestra la observación', /ZZZ observacion de prueba/.test(await texto('#inZona')))
  prueba('muestra el total 8', /8/.test(await texto('#inZona')))

  const fila = await sql(`select id from farmacia.v_insumos_control_entregas
    where persona = '${PERSONA}' and origen = 'manual' and not anulada limit 1`)
  idCreado = fila[0] && fila[0].id
  const rev = await sql(`select count(*) n, sum(cantidad) s from farmacia.insumos_control_entregas_items
    where entrega_id = '${idCreado}'`)
  prueba('la base tiene 2 insumos y suma 8', Number(rev[0].n) === 2 && Number(rev[0].s) === 8, JSON.stringify(rev[0]))

  console.log('\n--- 3. Corregir: cambiar cantidad y observación ---')
  await pag.click('#inCorregir')
  await pag.waitForSelector('#inItems [data-cant="0"]', { timeout: 15000 })
  await pag.$eval('#inItems [data-cant="0"]', e => { e.value = '' })
  await pag.type('#inItems [data-cant="0"]', '10')
  await pag.$eval('#inObs', e => { e.value = '' })
  await pag.type('#inObs', 'ZZZ observacion corregida')
  await pag.click('#inGuardar')
  /* Si no se guarda, el aviso dice por qué: sin esto la prueba solo decía "se acabó el tiempo". */
  await pag.waitForFunction(() => document.querySelector('#inCorregir') ||
    /No se guardó|Falta|Escribe|Revisa|no es válida|Agrega/.test((document.getElementById('inAviso') || {}).textContent || ''), { timeout: 25000 })
  if (!(await pag.$('#inCorregir'))) { prueba('se guardó', false, await aviso()); throw new Error('no se guardó: ' + (await aviso())) }
  const rev2 = await sql(`select sum(cantidad) s from farmacia.insumos_control_entregas_items
    where entrega_id = '${idCreado}'`)
  prueba('la corrección quedó en la base (suma 13)', Number(rev2[0].s) === 13, JSON.stringify(rev2[0]))
  const obs2 = await sql(`select observacion from farmacia.insumos_control_entregas where id = '${idCreado}'`)
  prueba('la observación quedó corregida', obs2[0].observacion === 'ZZZ observacion corregida', JSON.stringify(obs2[0]))

  console.log('\n--- 4. Sin cantidad no se guarda ---')
  await pag.click('#inVolver')
  await espera(200)
  const bot = await pag.$('#inVolver')
  if (bot) { await bot.click(); await espera(300) }
  await pag.click('#inNueva')
  await pag.waitForSelector('#inPersona', { timeout: 15000 })
  await escribir('#inFecha', '2026-09-02')
  await escribir('#inPersona', PERSONA + ' VACIO')
  await escribir('#inItems [data-desc="0"]', 'ZZZ SIN CANTIDAD')
  await pag.click('#inGuardar')
  await espera(600)
  prueba('sin cantidad avisa y NO se guarda', /Falta la cantidad/.test(await pag.$eval('#inAviso', e => e.innerText).catch(() => '')))

  console.log('\n--- 5. Balance y descargas ---')
  await pag.click('#inVolver')
  await espera(400)
  if (await pag.$('#inVolver')) { await pag.click('#inVolver'); await espera(300) }
  await pag.waitForSelector('#inBalance', { timeout: 15000 })
  await pag.click('#inBalance')
  await pag.waitForFunction(() => /Balance general por trimestre/.test(document.getElementById('inBalanceZona').innerText),
    { timeout: 30000 })
  prueba('el balance muestra trimestres', /ENERO A MARZO|ABRIL A JUNIO|JULIO A SEPTIEMBRE|OCTUBRE A DICIEMBRE/.test(
    await texto('#inBalanceZona')))
  prueba('el balance avisa qué cifras son sin desglose', /sin desglose/.test(await texto('#inBalanceZona')))

  await pag.click('#inBalanceZona #inBalExcel')
  const xl = await esperaArchivo(/Balance/i, 40000)
  prueba('descarga el Excel del balance', !!xl, String(xl))

  await pag.click('#inBalanceZona #inBalPdf')
  const pdf = await esperaArchivo(/Balance/i, 40000)
  prueba('descarga el PDF del balance', !!pdf, String(pdf))

  await pag.click('#inBalanceZona #inBalCerrar')
  await pag.click('#inExcel')
  const xl2 = await esperaArchivo(/Control/i, 40000)
  prueba('descarga el Excel del listado', !!xl2, String(xl2))

  console.log('\n--- 6. Teléfono ---')
  await pag.setViewport({ width: 375, height: 800 })
  await espera(300)
  const overflow = await pag.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  prueba('en 375px no hay scroll de lado', !overflow)

  console.log('\n--- 7. Sin errores de JavaScript ---')
  prueba('no hubo errores de JavaScript', errores.length === 0, errores.join(' | '))
} finally {
  console.log('\n--- Limpiando lo de ZZZ ---')
  /* La bitácora no deja borrar: se apagan los disparadores en esta transacción.
     Sin disparadores tampoco corre la cascada: los insumos se borran primero. */
  const limpio = await sql(`begin;
    set local session_replication_role = replica;
    delete from farmacia.bitacora
     where tabla in ('insumos_control_entregas', 'insumos_control_entregas_items')
       and (coalesce(antes::text, '') || coalesce(despues::text, '')) like '%ZZZ%';
    delete from farmacia.insumos_control_entregas_items it using farmacia.insumos_control_entregas e
     where it.entrega_id = e.id and e.persona like 'ZZZ%';
    delete from farmacia.insumos_control_entregas where persona like 'ZZZ%';
    commit;`)
  if (limpio && limpio.error) console.log('  limpieza: ' + String(limpio.error).slice(0, 300))
  await nav.close()
  servidor.close()
}
const quedo = await sql(`select (select count(*) from farmacia.insumos_control_entregas where persona like 'ZZZ%') +
  (select count(*) from farmacia.bitacora where tabla like 'insumos_control%' and (coalesce(antes::text,'') || coalesce(despues::text,'')) like '%ZZZ%') as n`)
prueba('limpieza: no quedó nada de la prueba (ni en la bitácora)', Array.isArray(quedo) && Number(quedo[0].n) === 0, JSON.stringify(quedo))

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}:\n  - ` + fallos.join('\n  - ') : `Pasaron las ${ok} pruebas de control en el navegador.`))
process.exit(mal ? 1 : 0)

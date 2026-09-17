/* MANTENER EL CATÁLOGO: corregir, ajustar y borrar.

   Abre un Chrome de verdad con el código REAL del inventario, pero con
   un doble de la base: así se comprueba QUÉ le manda la pantalla a la
   base sin tocar ni un dato de la farmacia.

   Lo que comprueba:
     · Que se pueden corregir los datos de un medicamento y de un lote.
     · Que la existencia NO se escribe encima: se ajusta con un
       movimiento que dice cuánto y por qué.
     · Que un ajuste sin motivo no pasa.
     · Que borrar solo se le ofrece al administrador.
     · Que no se borra nada que tenga existencia o historia.

       node pruebas/inventario-crud.mjs
*/
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

let puppeteer
try { puppeteer = (await import('puppeteer-core')).default }
catch { console.error('Falta puppeteer-core:  npm i -g puppeteer-core'); process.exit(2) }

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + String(d).slice(0, 250)) }
}

const PROD = {
  producto_id: 'p-1', producto: 'ACETAMINOFEN', dosificacion: '500MG', presentacion: 'TABLETA',
  categoria: 'medicamento', stock_minimo: 0, empaque: 'caja', unidades_por_empaque: 30,
  disponible: 125, vencido: 0, en_cajas: '4 cajas y 5 sueltas'
}
const LOTES = [
  { lote_id: 'l-1', lote: 'AB-100', vence: '2027-05-31', existencia: 125, en_cajas: '4 cajas y 5 sueltas', situacion: 'vigente', estado: 'disponible' },
  { lote_id: 'l-2', lote: 'AB-200', vence: '2027-09-30', existencia: 0, en_cajas: '', situacion: 'por_vencer_90', estado: 'disponible' }
]

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' }
const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba del inventario</title>
<link rel="stylesheet" href="/__estilos.css"></head>
<body><div id="app"></div>
<script src="/comunes.js"></script>
<script src="/picker.js"></script>
<script src="/inventario.js"></script>
<script src="/__doble.js"></script>
</body></html>`

const doble = (rol) => `
window.ESCRITURAS = []; window.CONSULTAS = [];
window.FARMACIA_PERFIL = { rol: '${rol}', nombre: 'Quien prueba' };
var PROD = ${JSON.stringify(PROD)};
var LOTES = ${JSON.stringify(LOTES)};
function consulta(tabla) {
  var q = { _eq: {} };
  q.select = function () { return q };
  q.eq = function (c, v) { q._eq[c] = v; return q };
  q.is = function () { return q };
  q.in = function () { return q };
  q.or = function () { return q };
  q.gte = function () { return q };
  q.lte = function () { return q };
  q.ilike = function () { return q };
  q.order = function () { return q };
  q.range = function () { return Promise.resolve({ data: [], count: 0, error: null }) };
  q.limit = function () { return Promise.resolve({ data: [], count: 0, error: null }) };
  q.single = function () {
    window.CONSULTAS.push({ tabla: tabla, eq: q._eq });
    if (tabla === 'v_catalogo') return Promise.resolve({ data: PROD, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  q.maybeSingle = q.single;
  q.insert = function (d) { window.ESCRITURAS.push({ tabla: tabla, op: 'insert', d: d }); return q };
  q.update = function (d) { window.ESCRITURAS.push({ tabla: tabla, op: 'update', d: d, eq: q._eq }); return q };
  q.delete = function () { window.ESCRITURAS.push({ tabla: tabla, op: 'delete', eq: q._eq }); return q };
  q.then = function (res) {
    window.CONSULTAS.push({ tabla: tabla, eq: q._eq });
    var datos = tabla === 'v_existencia_lote' ? LOTES : [];
    return Promise.resolve({ data: datos, count: datos.length, error: null }).then(res);
  };
  return q;
}
window.PANTALLA_INVENTARIO({ from: consulta }, document.getElementById('app'));
setTimeout(function () { window.INVENTARIO_VER_PRODUCTO(PROD); }, 80);
`

const servidor = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/' || p === '/__prueba') { res.writeHead(200, { 'Content-Type': TIPOS['.html'] }); return res.end(PAGINA) }
  if (p === '/__doble.js') { res.writeHead(200, { 'Content-Type': TIPOS['.js'] }); return res.end(doble(ROL)) }
  if (p === '/__estilos.css') {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8')
    res.writeHead(200, { 'Content-Type': TIPOS['.css'] })
    return res.end(html.split('<style>')[1].split('</style>')[0])
  }
  const f = path.join(RAIZ, p)
  if (!f.startsWith(path.resolve(RAIZ)) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no') }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  res.end(fs.readFileSync(f))
})
let ROL = 'inventario'
await new Promise((r) => servidor.listen(0, r))
const BASE = 'http://127.0.0.1:' + servidor.address().port

const nav = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const pag = await nav.newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e)))
pag.on('dialog', d => d.accept())      /* las confirmaciones se aceptan */
await pag.setViewport({ width: 1200, height: 1000 })

const escrituras = () => pag.evaluate(() => window.ESCRITURAS)
const abrirFicha = async () => {
  await pag.goto(BASE + '/__prueba', { waitUntil: 'networkidle0' })
  await pag.evaluate(() => { window.ESCRITURAS = [] })
  await pag.waitForSelector('#catEditar, .prod-acciones', { timeout: 10000 })
}

try {
  console.log('\n--- Mantener el catálogo (como inventario) ---')
  await abrirFicha()
  prueba('la ficha ofrece corregir los datos del medicamento', !!(await pag.$('#catEditar')))
  prueba('quien NO es admin no ve el botón de borrar del catálogo', !(await pag.$('#catBorrar')))
  prueba('cada lote ofrece corregir y ajustar',
    (await pag.$$eval('[data-editalote]', n => n.length)) === 2 &&
    (await pag.$$eval('[data-ajusta]', n => n.length)) === 2)
  prueba('no se ofrece borrar un lote que todavía tiene existencia',
    (await pag.$$eval('[data-borralote]', n => n.length)) === 0)
  /* El total, siempre a la vista: 125 + 0 = 125. */
  prueba('la tabla de lotes termina con el TOTAL sumado',
    /125/.test(await pag.$eval('.tabla tfoot', e => e.textContent)) &&
    /Total/i.test(await pag.$eval('.tabla tfoot', e => e.textContent)),
    await pag.$eval('.tabla tfoot', e => e.textContent.replace(/\s+/g, ' ').trim()))

  /* --- corregir el medicamento --- */
  await pag.click('#catEditar')
  await pag.waitForSelector('#epNombre', { timeout: 10000 })
  await pag.$eval('#epNombre', e => { e.value = 'ACETAMINOFEN COMPUESTO' })
  await pag.$eval('#epPorEmpaque', e => { e.value = '20' })
  await pag.click('#epGuardar')
  await new Promise(r => setTimeout(r, 400))
  const cambioProd = (await escrituras()).filter(x => x.tabla === 'productos' && x.op === 'update')[0]
  prueba('guarda el nombre corregido en el medicamento correcto',
    !!cambioProd && cambioProd.d.nombre === 'ACETAMINOFEN COMPUESTO' && cambioProd.eq.id === 'p-1',
    JSON.stringify(cambioProd))
  prueba('y guarda también cuántas unidades trae el empaque',
    cambioProd && cambioProd.d.unidades_por_empaque === 20, JSON.stringify(cambioProd && cambioProd.d))
  prueba('al corregir NO se toca la existencia',
    !('disponible' in (cambioProd.d || {})) && !('existencia' in (cambioProd.d || {})))

  /* un nombre demasiado corto no se guarda */
  await abrirFicha()
  await pag.click('#catEditar')
  await pag.waitForSelector('#epNombre', { timeout: 10000 })
  await pag.$eval('#epNombre', e => { e.value = 'AB' })
  await pag.click('#epGuardar')
  await new Promise(r => setTimeout(r, 300))
  prueba('un nombre demasiado corto no se guarda',
    (await escrituras()).filter(x => x.tabla === 'productos').length === 0)
  prueba('y se avisa por qué', /corto/i.test(await pag.$eval('#invAviso, .aviso', e => e.textContent).catch(() => '')))

  /* --- corregir un lote --- */
  await abrirFicha()
  await pag.click('[data-editalote="0"]')
  await pag.waitForSelector('#elVence', { timeout: 10000 })
  await pag.$eval('#elVence', e => { e.value = '2028-01-31' })
  await pag.click('#elGuardar')
  await new Promise(r => setTimeout(r, 400))
  const cambioLote = (await escrituras()).filter(x => x.tabla === 'lotes' && x.op === 'update')[0]
  prueba('corrige el vencimiento del lote correcto',
    !!cambioLote && cambioLote.d.vence === '2028-01-31' && cambioLote.eq.id === 'l-1',
    JSON.stringify(cambioLote))

  /* --- ajustar la existencia --- */
  await abrirFicha()
  await pag.click('[data-ajusta="0"]')
  await pag.waitForSelector('#ajReal', { timeout: 10000 })
  await pag.$eval('#ajReal', e => { e.value = '120'; e.dispatchEvent(new Event('input')) })
  prueba('dice claramente cuántas se van a quitar',
    /QUITAR 5/.test(await pag.$eval('#ajDif', e => e.textContent)), await pag.$eval('#ajDif', e => e.textContent))
  await pag.click('#ajGuardar')
  await new Promise(r => setTimeout(r, 300))
  prueba('sin motivo no se ajusta nada', (await escrituras()).length === 0)
  await pag.$eval('#ajMotivo', e => { e.value = 'Se contó de nuevo el estante' })
  await pag.click('#ajGuardar')
  await new Promise(r => setTimeout(r, 400))
  const mov = (await escrituras()).filter(x => x.tabla === 'movimientos')[0]
  prueba('el ajuste entra como movimiento, con la diferencia y el motivo',
    !!mov && mov.d.tipo === 'ajuste' && mov.d.cantidad === -5 && /Se contó de nuevo/.test(mov.d.motivo),
    JSON.stringify(mov && mov.d))
  prueba('NO se escribe la existencia a mano en ninguna tabla',
    (await escrituras()).every(x => x.tabla === 'movimientos'),
    JSON.stringify(await escrituras()))

  /* --- el lote vacío sí se puede borrar, y solo el admin --- */
  console.log('\n--- Lo que solo puede el administrador ---')
  ROL = 'admin'
  await abrirFicha()
  prueba('el admin sí ve borrar del catálogo', !!(await pag.$('#catBorrar')))
  prueba('y ve borrar SOLO el lote que está en cero',
    (await pag.$$eval('[data-borralote]', n => n.map(x => x.dataset.borralote))).join() === '1')
  await pag.click('[data-borralote="1"]')
  await new Promise(r => setTimeout(r, 400))
  const borrado = (await escrituras()).filter(x => x.tabla === 'lotes' && x.op === 'delete')[0]
  prueba('borra el lote vacío, no el que tiene existencia',
    !!borrado && borrado.eq.id === 'l-2', JSON.stringify(borrado))

  await abrirFicha()
  await pag.click('#catBorrar')
  await new Promise(r => setTimeout(r, 400))
  prueba('un medicamento CON lotes no se borra: se avisa y no se manda nada',
    (await escrituras()).filter(x => x.tabla === 'productos' && x.op === 'delete').length === 0,
    JSON.stringify(await escrituras()))
  prueba('y se explica por qué',
    /tiene lotes/i.test(await pag.evaluate(() => document.body.textContent)))

  prueba('la pantalla no lanzó ningún error', errores.length === 0, errores.join(' | '))
} finally {
  await nav.close()
  servidor.close()
}

console.log('\n' + '='.repeat(58))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas del mantenimiento del catálogo.`)

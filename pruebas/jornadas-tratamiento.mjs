/* TRATAMIENTO DE LAS JORNADAS: elegir del inventario y anotar cuántos.

   Abre un Chrome de verdad con el código REAL de la pantalla
   (comunes.js, picker.js y jornadas.js, los mismos archivos que se
   publican) pero con un doble de la base de datos: así se prueba todo
   el manejo del formulario sin tocar los datos de la farmacia ni hacer
   falta ninguna clave.

   Lo que comprueba:
     · Que el buscador ofrece lo que está cargado en el inventario.
     · Que al elegir uno se escribe en el campo con su cantidad.
     · Que elegir dos veces el mismo suma, no lo repite.
     · Que los botones + y − cambian la cantidad y ✕ lo quita.
     · Que lo escrito a mano NO se pierde.
     · Que elegir NO descuenta nada del inventario.

       node pruebas/jornadas-tratamiento.mjs
*/
import fs from 'node:fs'
import path from 'node:path'

let puppeteer
try { puppeteer = (await import('puppeteer-core')).default }
catch { console.error('Falta puppeteer-core:  npm i -g puppeteer-core'); process.exit(2) }

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) }
  else { mal++; fallos.push(n + '  ' + d); console.log('  FALLA ' + n + '   ' + String(d).slice(0, 200)) }
}

/* El catálogo de mentira: lo que “estaría cargado en el inventario”. */
const CATALOGO = [
  { producto_id: 1, producto: 'ACETAMINOFEN SUSPENSION', dosificacion: '120MG/5ML', presentacion: 'FRASCO', disponible: 40, situacion: 'ok' },
  { producto_id: 2, producto: 'AMOXICILINA', dosificacion: '500MG', presentacion: 'CAPSULA', disponible: 12, situacion: 'ok' },
  { producto_id: 3, producto: 'SUERO ORAL', dosificacion: null, presentacion: 'SOBRE', disponible: 0, situacion: 'agotado' },
  { producto_id: 4, producto: 'GASA 5X5', dosificacion: null, presentacion: 'PAQUETE', disponible: 7, situacion: 'ok' }
]

/* Los archivos se sirven de verdad, como en el sitio publicado: pegarlos
   dentro de la página rompía el HTML (hay etiquetas dentro de las cadenas). */
import http from 'node:http'
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' }
const PAGINA_PRUEBA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba del tratamiento</title>
<link rel="stylesheet" href="/__estilos.css"></head>
<body><div id="app"></div>
<script src="/comunes.js"></script>
<script src="/picker.js"></script>
<script src="/jornadas.js"></script>
<script src="/__doble.js"></script>
</body></html>`

const DOBLE = `
/* Doble de la base: solo responde lo que esta pantalla le pregunta. */
window.CONSULTAS = []; window.ESCRITURAS = [];
var CATALOGO = ${JSON.stringify(CATALOGO)};
function consulta(tabla) {
  var q = {
    select: function () { return q },
    ilike: function (campo, patron) { q._texto = String(patron).split('*').join('').toLowerCase(); return q },
    eq: function () { return q },
    order: function () { return q },
    range: function () { return Promise.resolve({ data: [], count: 0, error: null }) },
    or: function () { return q },
    in: function () { return q },
    is: function () { return q },
    gte: function () { return q },
    lte: function () { return q },
    maybeSingle: function () { return Promise.resolve({ data: null, error: null }) },
    limit: function () {
      window.CONSULTAS.push({ tabla: tabla, texto: q._texto || '' });
      var f = CATALOGO.filter(function (x) { return !q._texto || x.producto.toLowerCase().indexOf(q._texto) >= 0 });
      return Promise.resolve({ data: f, count: f.length, error: null });
    },
    single: function () { return Promise.resolve({ data: null, error: null }) },
    insert: function (d) { window.ESCRITURAS.push({ tabla: tabla, op: 'insert', d: d }); return q },
    update: function (d) { window.ESCRITURAS.push({ tabla: tabla, op: 'update', d: d }); return q },
    delete: function () { window.ESCRITURAS.push({ tabla: tabla, op: 'delete' }); return q },
    then: function (res) { return Promise.resolve({ data: [], count: 0, error: null }).then(res) }
  };
  q._texto = '';
  return q;
}
window.T = window.PANTALLA_JORNADAS({ from: consulta }, document.getElementById('app'), { prefijo: 'jo' });
window.T.modo = 'ficha';
window.T.quien = { id: 1, nombre: 'ZZZ PRUEBA', tratamiento: 'VITAMINA C', fecha: '2026-09-16', conjunto: 'jornadas' };
window.T.origenPersona = null;
setTimeout(function () { window.T.verFormularioPersona(window.T.quien); }, 60);
`

const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/' || p === '/__prueba') {
    res.writeHead(200, { 'Content-Type': TIPOS['.html'] }); res.end(PAGINA_PRUEBA); return
  }
  if (p === '/__doble.js') { res.writeHead(200, { 'Content-Type': TIPOS['.js'] }); res.end(DOBLE); return }
  if (p === '/__estilos.css') {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8')
    res.writeHead(200, { 'Content-Type': TIPOS['.css'] })
    res.end(html.split('<style>')[1].split('</style>')[0]); return
  }
  const f = path.join(RAIZ, p)
  if (!f.startsWith(path.resolve(RAIZ)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' })
  res.end(fs.readFileSync(f))
})
await new Promise((r) => servidor.listen(0, r))
const BASE = 'http://127.0.0.1:' + servidor.address().port

const nav = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const pag = await nav.newPage()
const errores = []
pag.on('pageerror', e => errores.push(String(e)))
await pag.setViewport({ width: 1200, height: 900 })
await pag.goto(BASE + '/__prueba', { waitUntil: 'networkidle0' })

const valor = () => pag.$eval('#joTratamiento', e => e.value)
const chips = () => pag.$$eval('.trat-chip', ns => ns.map(n => n.textContent.replace(/\s+/g, ' ').trim()))

try {
  console.log('\n--- El campo de tratamiento con ayuda del inventario ---')
  await pag.waitForSelector('#joTratamiento', { timeout: 10000 })
  prueba('el campo sigue siendo de texto y conserva lo que ya tenía', await valor() === 'VITAMINA C')
  prueba('lo que ya estaba escrito aparece como renglón', (await chips()).some(c => /VITAMINA C/.test(c)))
  prueba('dice que NO descuenta del inventario',
    /No descuenta del inventario/i.test(await pag.$eval('.trat-barra', e => e.textContent)))

  await pag.click('#joTratBuscar')
  await pag.waitForSelector('#joTratMedBusca', { timeout: 10000 })
  await new Promise(r => setTimeout(r, 500))
  prueba('el buscador ofrece lo que hay en el inventario',
    (await pag.$$eval('#joTratMedRes .ficha', ns => ns.length)) >= 4)
  prueba('y dice cuántos hay disponibles de cada uno',
    /40/.test(await pag.$eval('#joTratMedRes', e => e.textContent)))

  await pag.type('#joTratMedBusca', 'aceta')
  await new Promise(r => setTimeout(r, 600))
  prueba('al escribir, busca en el catálogo',
    (await pag.evaluate(() => window.CONSULTAS.map(c => c.texto))).includes('aceta'))
  await pag.click('#joTratMedRes .ficha')
  await new Promise(r => setTimeout(r, 400))
  prueba('al elegirlo se escribe en el campo con su cantidad',
    /VITAMINA C \/ ACETAMINOFEN SUSPENSION X1/.test(await valor()), await valor())

  /* El mismo otra vez: suma, no se repite (en el Excel viejo salía dos veces). */
  await pag.click('#joTratMedRes .ficha')
  await new Promise(r => setTimeout(r, 400))
  prueba('elegir el mismo dos veces SUMA, no lo repite',
    /ACETAMINOFEN SUSPENSION X2/.test(await valor()) &&
    (await valor()).split('ACETAMINOFEN').length === 2, await valor())

  const masBoton = '.trat-chip:nth-child(2) .trat-mas'
  await pag.click(masBoton)
  await new Promise(r => setTimeout(r, 250))
  prueba('el botón + sube la cantidad', /ACETAMINOFEN SUSPENSION X3/.test(await valor()), await valor())
  await pag.click('.trat-chip:nth-child(2) .trat-menos')
  await new Promise(r => setTimeout(r, 250))
  prueba('el botón − la baja', /ACETAMINOFEN SUSPENSION X2/.test(await valor()), await valor())

  /* Escribir a mano tiene que seguir funcionando igual que siempre. */
  await pag.$eval('#joTratamiento', e => { e.value = 'ACETAMINOFEN SUSPENSION X2 / ALGO ESCRITO A MANO'; e.dispatchEvent(new Event('change')) })
  await new Promise(r => setTimeout(r, 250))
  prueba('lo escrito a mano NO se pierde y sale como renglón',
    (await chips()).some(c => /ALGO ESCRITO A MANO/.test(c)), JSON.stringify(await chips()))

  await pag.click('.trat-chip:nth-child(2) .trat-quitar')
  await new Promise(r => setTimeout(r, 250))
  prueba('la ✕ quita solo ese', await valor() === 'ACETAMINOFEN SUSPENSION X2', await valor())

  /* Una gasa 5x5 no se puede convertir en "5 gasas": es el tamaño. */
  await pag.$eval('#joTratMedBusca', e => { e.value = 'gasa'; e.dispatchEvent(new Event('input')) })
  await new Promise(r => setTimeout(r, 600))
  await pag.click('#joTratMedRes .ficha')
  await new Promise(r => setTimeout(r, 400))
  prueba('una gasa 5X5 queda con su medida y su cantidad aparte',
    /GASA 5X5 X1/.test(await valor()), await valor())

  prueba('NADA se escribió en la base: elegir no mueve el inventario',
    (await pag.evaluate(() => window.ESCRITURAS.length)) === 0,
    JSON.stringify(await pag.evaluate(() => window.ESCRITURAS)))
  prueba('solo se consultó el catálogo, ninguna otra tabla',
    (await pag.evaluate(() => window.CONSULTAS.every(c => c.tabla === 'v_catalogo'))),
    JSON.stringify(await pag.evaluate(() => window.CONSULTAS.map(c => c.tabla))))
  prueba('la pantalla no lanzó ningún error', errores.length === 0, errores.join(' | '))
} finally {
  await nav.close()
  servidor.close()
}

console.log('\n' + '='.repeat(58))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas del tratamiento en las jornadas.`)

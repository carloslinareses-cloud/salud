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
const BAJADAS = path.join(RAIZ, 'tmp', 'pdfs', 'jornadas-informe')
if (!path.resolve(BAJADAS).startsWith(path.resolve(RAIZ, 'tmp', 'pdfs') + path.sep)) {
  throw new Error('La carpeta temporal de descargas quedó fuera del proyecto.')
}
fs.rmSync(BAJADAS, { recursive: true, force: true })
fs.mkdirSync(BAJADAS, { recursive: true })

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
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script src="/comunes.js"></script>
<script src="/logos-base64.js"></script>
<script src="/pdf-header.js"></script>
<script src="/reportes.js"></script>
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
    range: function () {
      var data = tabla === 'jornadas_registros' && window.JORNADA_PERSONAS ? window.JORNADA_PERSONAS :
        (tabla === 'v_jornadas_eventos' && window.JORNADA_EVENTOS ? window.JORNADA_EVENTOS : []);
      return Promise.resolve({ data: data, count: data.length, error: null })
    },
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
const cliente = await pag.createCDPSession()
await cliente.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: BAJADAS })
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

  prueba('un producto escrito sin cantidad queda claramente vacío',
    (await pag.$$eval('.trat-cantidad', ns => ns.map(n => n.value)))[1] === '')
  await pag.click('#joGuardar')
  await new Promise(r => setTimeout(r, 250))
  prueba('no deja guardar una entrega si falta la cantidad de un producto',
    /Indica cuántas unidades/i.test(await pag.$eval('#joAviso', e => e.textContent)) &&
    (await pag.evaluate(() => window.ESCRITURAS.length)) === 0)

  await pag.$eval('#joTratamiento', e => {
    e.value = 'ALCOHOL 2 unidades / DICLOFENAC 3 unidades'
    e.dispatchEvent(new Event('input'))
  })
  await new Promise(r => setTimeout(r, 250))
  prueba('el ejemplo ALCOHOL 2 + DICLOFENAC 3 muestra un total real de 5',
    /Total real:\s*5 unidades/i.test(await pag.$eval('#joTratTotal', e => e.textContent)),
    await pag.$eval('#joTratTotal', e => e.textContent))
  prueba('las dos cantidades aparecen separadas y auditables',
    JSON.stringify(await pag.$$eval('.trat-cantidad', ns => ns.map(n => n.value))) === JSON.stringify(['2', '3']))

  await pag.$eval('.trat-cantidad', e => { e.value = '4'; e.dispatchEvent(new Event('change', { bubbles: true })) })
  await new Promise(r => setTimeout(r, 250))
  prueba('cambiar una cantidad recalcula inmediatamente 4 + 3 = 7',
    /Total real:\s*7 unidades/i.test(await pag.$eval('#joTratTotal', e => e.textContent)) &&
    /ALCOHOL X4 \/ DICLOFENAC X3/.test(await valor()), await valor())

  await pag.$eval('#joTratamiento', e => {
    e.value = 'ACETAMINOFEN SUSPENSION X2 / ALGO ESCRITO A MANO'
    e.dispatchEvent(new Event('input'))
  })
  await new Promise(r => setTimeout(r, 250))

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

  /* La ayuda tiene que estar en TODOS los sitios donde se anota una
     persona: en "Registros" (lo de arriba), dentro de una jornada y
     dentro de la ruta materna, que usan el mismo formulario. */
  for (const [tipo, comoSeLlama] of [['jornadas', 'una jornada'], ['ruta_materna', 'la ruta materna']]) {
    await pag.evaluate((tipo) => {
      window.T.origenPersona = { tipo: 'evento', id: 'zzz-1' };
      window.T.eventoActual = { id: 'zzz-1', tipo: tipo, fecha: '2026-09-16', lugar: 'ZZZ' };
      window.T.modoEv = 'form-persona';
      window.T.verFormularioPersona({ tratamiento: 'VITAMINA C' });
    }, tipo)
    await new Promise(r => setTimeout(r, 400))
    prueba('dentro de ' + comoSeLlama + ' también está el buscador del inventario',
      !!(await pag.$('#joTratBuscar')) && !!(await pag.$('#joTratChips')))
    await pag.click('#joTratBuscar')
    await pag.waitForSelector('#joTratMedBusca', { timeout: 10000 })
    await new Promise(r => setTimeout(r, 500))
    await pag.click('#joTratMedRes .ficha')
    await new Promise(r => setTimeout(r, 400))
    prueba('y allí también se anota con su cantidad', /X1/.test(await valor()), await valor())
  }

  await pag.$eval('#joTratamiento', e => {
    e.value = 'ALCOHOL 2 unidades / DICLOFENAC 3 unidades'
    e.dispatchEvent(new Event('input'))
  })
  await pag.setViewport({ width: 375, height: 812 })
  await new Promise(r => setTimeout(r, 250))
  const movil = await pag.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    ventana: window.innerWidth,
    cantidades: [...document.querySelectorAll('.trat-cantidad')].map(e => e.getBoundingClientRect().height),
    botones: [...document.querySelectorAll('.trat-chip button')].map(e => e.getBoundingClientRect().height),
    chips: [...document.querySelectorAll('.trat-chip')].map(e => e.getBoundingClientRect().width)
  }))
  prueba('en un teléfono de 375 px no aparece desplazamiento horizontal', movil.ancho <= movil.ventana,
    JSON.stringify(movil))
  prueba('en teléfono, cantidades y botones miden al menos 44 px de alto',
    movil.cantidades.every(n => n >= 44) && movil.botones.every(n => n >= 44), JSON.stringify(movil))
  prueba('los renglones de productos caben completos en el teléfono',
    movil.chips.every(n => n <= movil.ventana), JSON.stringify(movil))

  console.log('\n--- Comunas y comunidades de las jornadas ---')
  await pag.setViewport({ width: 1200, height: 900 })
  await pag.evaluate(() => {
    window.JORNADA_EVENTOS = [
      { id: 'e1', tipo: 'jornadas', fecha: '2026-09-18', lugar: 'UNO', comuna: 'COMUNA A', comunidad: 'LA ESPERANZA', pacientes: 10, recipes: 5 },
      { id: 'e2', tipo: 'jornadas', fecha: '2026-09-17', lugar: 'DOS', comuna: 'comuna a', comunidad: 'LOS OLIVOS', pacientes: 8, recipes: 4 },
      { id: 'e3', tipo: 'jornadas', fecha: '2026-09-16', lugar: 'TRES', comuna: 'COMUNA B', comunidad: 'LA ESPERANZA', pacientes: 7, recipes: 3 },
      { id: 'e4', tipo: 'jornadas', fecha: '2026-09-15', lugar: 'SIN TERRITORIO', comuna: null, comunidad: null, pacientes: 2, recipes: 1 },
      { id: 'e5', tipo: 'ruta_materna', fecha: '2026-09-14', lugar: 'CINCO', comuna: 'COMUNA B', comunidad: 'COMUNIDAD TRES', pacientes: 6, recipes: 2 }
    ]
    window.T.vista = 'eventos'
    window.T.modoEv = 'lista'
    window.T.pintar()
  })
  await pag.waitForSelector('#joTablaComunas', { timeout: 10000 })
  const textoTerritorio = await pag.$eval('#joEvTerritorio', e => e.innerText.replace(/\s+/g, ' '))
  prueba('al abrir Jornadas muestra el total de jornadas, comunas y comunidades',
    /5 jornadas registradas/i.test(textoTerritorio) && /2 comunas atendidas/i.test(textoTerritorio) &&
    /4 comunidades atendidas/i.test(textoTerritorio), textoTerritorio)
  prueba('el desglose muestra todas las comunas y todas las comunidades',
    (await pag.$$eval('#joTablaComunas tbody tr', rs => rs.length)) === 2 &&
    (await pag.$$eval('#joTablaComunidades tbody tr', rs => rs.length)) === 4)
  prueba('una comunidad homónima en otra comuna se muestra por separado',
    /COMUNA B\s+LA ESPERANZA\s+1/i.test(textoTerritorio), textoTerritorio)
  prueba('avisa cuáles jornadas todavía no tienen comuna o comunidad anotada',
    /1 jornada sin comuna anotada/i.test(textoTerritorio) && /1 jornada sin comunidad anotada/i.test(textoTerritorio))
  await pag.setViewport({ width: 375, height: 812 })
  await new Promise(r => setTimeout(r, 200))
  const movilTerritorio = await pag.evaluate(() => ({
    ancho: document.documentElement.scrollWidth, ventana: window.innerWidth
  }))
  prueba('el resumen territorial cabe en un teléfono de 375 px',
    movilTerritorio.ancho <= movilTerritorio.ventana, JSON.stringify(movilTerritorio))

  console.log('\n--- Informe detallado de una jornada ---')
  await pag.setViewport({ width: 1200, height: 900 })
  await pag.evaluate(() => {
    window.DESCARGAS_JORNADA = []
    var generadorReal = window.FARMREP
    window.FARMREP = {
      excel: (archivo, hojas) => {
        window.DESCARGAS_JORNADA.push({ tipo: 'excel', archivo, hojas })
        generadorReal.excel(archivo, hojas)
      },
      pdfInforme: (opciones) => {
        window.DESCARGAS_JORNADA.push({ tipo: 'pdf', opciones })
        generadorReal.pdfInforme(opciones)
      }
    }
    window.JORNADA_PERSONAS = [
      { id: 'p1', nombre: 'ANA PRUEBA', cedula: '12345678', sexo: 'F', edad_texto: '34',
        telefono: '04120000001', direccion: 'CALLE UNO', item: 'SECTOR A',
        tratamiento: 'ALCOHOL X2 / DICLOFENAC X3', recipe: true, estado: 'activo' },
      { id: 'p2', nombre: 'LUIS PRUEBA', cedula: '87654321', sexo: 'M', edad_texto: '40',
        telefono: '04120000002', direccion: 'CALLE DOS', item: 'SECTOR B',
        tratamiento: 'alcohol X4', recipe: false, estado: 'activo' },
      { id: 'p3', nombre: 'MARIA HISTORICA', cedula: '', sexo: 'F', edad_texto: 'SIN DATO',
        telefono: '', direccion: '', item: 'SECTOR C', tratamiento: 'ACETAMINOFEN',
        recipe: null, estado: 'por_revisar' }
    ]
    window.T.eventoActual = {
      id: 'ev-informe', tipo: 'jornadas', fecha: '2026-09-18', lugar: 'LA MAGDALENA',
      parroquia: 'CHARALLAVE', comuna: 'COMUNA PRUEBA', comunidad: 'LA MAGDALENA',
      dietista: 'RESPONSABLE PRUEBA', firmas: ['FIRMA UNO']
    }
    window.T.modoEv = 'detalle'
    window.T.verEventoDetalle()
  })
  await pag.waitForSelector('#joDetExcel', { timeout: 10000 })
  await new Promise(r => setTimeout(r, 250))
  const detalleJornada = await pag.$eval('#joZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('la jornada muestra pacientes, unidades, productos distintos, renglones y récipes',
    /3 pacientes atendidos/i.test(detalleJornada) && /9 unidades realmente entregadas/i.test(detalleJornada) &&
    /2 medicamentos o insumos distintos/i.test(detalleJornada) && /3 renglones de productos/i.test(detalleJornada) &&
    /1 con récipe/i.test(detalleJornada), detalleJornada.slice(0, 800))
  const filaAlcohol = await pag.evaluate(() => {
    const fila = [...document.querySelectorAll('#joZona table tr')].find(tr => /ALCOHOL/i.test(tr.innerText))
    return fila ? fila.innerText.replace(/\s+/g, ' ').trim() : ''
  })
  prueba('ALCOHOL se agrupa aunque cambien mayúsculas y suma 2 + 4 = 6',
    /ALCOHOL\s+6\s+2\s+2/i.test(filaAlcohol), filaAlcohol)
  prueba('se muestran las tres entregas detalladas por paciente y producto',
    (await pag.$$('#joZona table')) && (await pag.$$eval('#joZona table', ts =>
      ts.reduce((n, t) => n + (t.querySelectorAll('tbody tr').length || 0), 0))) >= 6)
  prueba('la fecha se muestra larga y también numérica',
    /viernes 18 de septiembre de 2026 · 18\/09\/2026/i.test(detalleJornada))

  await pag.click('#joDetExcel')
  await new Promise(r => setTimeout(r, 300))
  const excel = await pag.evaluate(() => window.DESCARGAS_JORNADA.find(x => x.tipo === 'excel'))
  prueba('el Excel trae Resumen, Medicamentos, Detalle por paciente, Pacientes y Sin cantidad',
    JSON.stringify(excel.hojas.map(h => h.nombre)) ===
    JSON.stringify(['Resumen', 'Medicamentos', 'Detalle por paciente', 'Pacientes', 'Sin cantidad']),
    JSON.stringify(excel && excel.hojas && excel.hojas.map(h => h.nombre)))
  prueba('el Excel incluye todas las personas y cada producto entregado',
    excel.hojas.find(h => h.nombre === 'Pacientes').filas.length === 3 &&
    excel.hojas.find(h => h.nombre === 'Detalle por paciente').filas.length === 3)
  prueba('el Excel conserva las columnas completas y cuadradas', excel.hojas.every(h =>
    h.filas.every(f => f.length === h.encabezados.length) && h.anchos.length === h.encabezados.length))
  await new Promise(r => setTimeout(r, 1200))
  const archivoExcel = fs.readdirSync(BAJADAS).find(n => /\.xlsx$/i.test(n))
  prueba('el Excel completo se genera y descarga de verdad', !!archivoExcel, fs.readdirSync(BAJADAS).join(', '))

  await pag.click('#joDetPdf')
  await new Promise(r => setTimeout(r, 300))
  const pdf = await pag.evaluate(() => window.DESCARGAS_JORNADA.find(x => x.tipo === 'pdf'))
  prueba('el PDF incluye datos, totales por producto, detalle, pacientes, tratamientos y pendientes',
    JSON.stringify(pdf.opciones.bloques.map(b => b.titulo)) === JSON.stringify([
      'Datos de la jornada', 'Totales por medicamento o insumo', 'Detalle por paciente y producto',
      'Datos completos de las personas atendidas', 'Tratamiento completo por paciente',
      'Productos sin cantidad anotada'
    ]), JSON.stringify(pdf && pdf.opciones && pdf.opciones.bloques.map(b => b.titulo)))
  prueba('el PDF lleva las seis cifras principales', pdf.opciones.resumen.length === 6)
  await new Promise(r => setTimeout(r, 1200))
  const archivoPdf = fs.readdirSync(BAJADAS).find(n => /\.pdf$/i.test(n))
  prueba('el PDF completo se genera y descarga de verdad', !!archivoPdf &&
    fs.readFileSync(path.join(BAJADAS, archivoPdf)).subarray(0, 5).toString('latin1') === '%PDF-',
    fs.readdirSync(BAJADAS).join(', '))

  await pag.setViewport({ width: 375, height: 812 })
  await new Promise(r => setTimeout(r, 250))
  const movilInforme = await pag.evaluate(() => ({
    ancho: document.documentElement.scrollWidth, ventana: window.innerWidth,
    botones: [...document.querySelectorAll('#joZona .descargas button')].map(e => e.getBoundingClientRect().height)
  }))
  prueba('el informe detallado tampoco desborda en un teléfono de 375 px',
    movilInforme.ancho <= movilInforme.ventana, JSON.stringify(movilInforme))
  prueba('los botones de descarga miden al menos 44 px en teléfono',
    movilInforme.botones.every(n => n >= 44), JSON.stringify(movilInforme))

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
  fs.rmSync(BAJADAS, { recursive: true, force: true })
}

console.log('\n' + '='.repeat(58))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas del tratamiento en las jornadas.`)

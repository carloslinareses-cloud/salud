/* ASISTENCIA MANUAL DEL ADMINISTRADOR

   Abre la pantalla real en Chrome con una base simulada y comprueba que:
     · El formulario sirve para crear y para corregir.
     · Las horas existentes se muestran en hora de Venezuela.
     · No se guarda sin entrada ni sin un motivo claro.
     · Se llama exclusivamente a la RPC protegida de la base.
     · En un teléfono de 375 px no aparece desplazamiento horizontal.

       node pruebas/asistencia-manual.mjs
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
const prueba = (nombre, condicion, detalle = '') => {
  if (condicion) { ok++; console.log('  OK    ' + nombre) }
  else { mal++; fallos.push(nombre + '  ' + detalle); console.log('  FALLA ' + nombre + '   ' + String(detalle).slice(0, 250)) }
}

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba asistencia manual</title>
<link rel="stylesheet" href="/__estilos.css"></head><body><main><div class="wrap"><div id="app"></div></div></main>
<script src="/asistencia.js"></script><script src="/__doble.js"></script></body></html>`

const DOBLE = `
window.LLAMADAS = []; window.PROMPTS = 0;
window.prompt = function () { window.PROMPTS++; return null };
window.FARM = {
  hoyCaracas: function () { return '2026-09-21' },
  horaCaracas: function (iso) { return new Date(iso).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' }) }
};
window.FARMREP = { fechaCorta: function (f) { return f }, fechaLarga: function () { return 'lunes 21 de septiembre de 2026' } };
var PERSONAL = [
  { cedula: '12345678', nombre: 'ANA PEREZ', telefono: '04141234567' },
  { cedula: '87654321', nombre: 'LUIS GOMEZ', telefono: '' }
];
var EXISTENTE = {
  id: 'marca-1', cedula: '12345678', hora_entrada: '2026-09-21T12:15:00Z',
  hora_salida: '2026-09-21T21:05:00Z', nota_correccion: null
};
function consulta(tabla) {
  var q = { eqs: {} };
  ['select','order','limit','range','gte','lte','ilike'].forEach(function (m) {
    q[m] = function () { return q };
  });
  q.eq = function (c, v) { q.eqs[c] = v; return q };
  q.maybeSingle = function () {
    var dato = tabla === 'v_asistencia' && q.eqs.cedula === EXISTENTE.cedula && q.eqs.fecha === '2026-09-21'
      ? EXISTENTE : null;
    return Promise.resolve({ data: dato, error: null });
  };
  q.then = function (resolver, rechazar) {
    var datos = [];
    if (tabla === 'asistencia_personal') datos = PERSONAL;
    if (tabla === 'v_asistencia' && !q.eqs.cedula) datos = [EXISTENTE];
    return Promise.resolve({ data: datos, error: null }).then(resolver, rechazar);
  };
  return q;
}
var cliente = {
  from: consulta,
  rpc: function (nombre, datos) {
    window.LLAMADAS.push({ nombre: nombre, datos: datos });
    return Promise.resolve({ data: { id: 'manual-1' }, error: null });
  }
};
window.PANTALLA_ASISTENCIA(cliente, document.getElementById('app'), { id: 'admin-1' });
`

const servidor = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/' || p === '/__prueba') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGINA) }
  if (p === '/__doble.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(DOBLE) }
  if (p === '/__estilos.css') {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8')
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
    return res.end(html.split('<style>')[1].split('</style>')[0])
  }
  const archivo = path.join(RAIZ, p)
  if (!archivo.startsWith(path.resolve(RAIZ)) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end('no') }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
  res.end(fs.readFileSync(archivo))
})

await new Promise(resolve => servidor.listen(0, resolve))
const base = 'http://127.0.0.1:' + servidor.address().port
const navegador = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const pagina = await navegador.newPage()
const errores = []
pagina.on('pageerror', e => errores.push(String(e)))
await pagina.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 })

try {
  await pagina.goto(base + '/__prueba', { waitUntil: 'networkidle0' })
  await pagina.click('[data-sa="manual"]')
  await pagina.waitForSelector('#asManGuardar:not([disabled])', { timeout: 10000 })

  prueba('el administrador tiene una pestaña clara para registrar manualmente',
    !!(await pagina.$('[data-sa="manual"]')) && !!(await pagina.$('#asManPersona')))
  prueba('detecta el registro existente y lo presenta como corrección',
    /Ya existe/.test(await pagina.$eval('#asManEstado', e => e.textContent)))
  prueba('muestra la entrada existente en hora de Venezuela',
    (await pagina.$eval('#asManEntrada', e => e.value)) === '08:15')
  prueba('muestra la salida existente en hora de Venezuela',
    (await pagina.$eval('#asManSalida', e => e.value)) === '17:05')
  prueba('el formulario cabe en un teléfono de 375 px',
    await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    await pagina.evaluate(() => document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth))

  await pagina.$eval('#asManEntrada', e => { e.value = '' })
  await pagina.$eval('#asManMotivo', e => { e.value = 'Motivo suficientemente claro' })
  await pagina.click('#asManGuardar')
  await new Promise(r => setTimeout(r, 100))
  prueba('sin hora de entrada no llama a la base', (await pagina.evaluate(() => window.LLAMADAS.length)) === 0)
  prueba('explica que la entrada es obligatoria', /hora de entrada/i.test(await pagina.$eval('#avisoAsis', e => e.textContent)))

  await pagina.$eval('#asManEntrada', e => { e.value = '08:20' })
  await pagina.$eval('#asManMotivo', e => { e.value = 'corto' })
  await pagina.click('#asManGuardar')
  await new Promise(r => setTimeout(r, 100))
  prueba('un motivo demasiado corto no llama a la base', (await pagina.evaluate(() => window.LLAMADAS.length)) === 0)

  await pagina.$eval('#asManMotivo', e => { e.value = 'El teléfono no tenía conexión al llegar' })
  await pagina.click('#asManGuardar')
  await new Promise(r => setTimeout(r, 250))
  const llamada = await pagina.evaluate(() => window.LLAMADAS[0])
  prueba('guarda mediante la RPC protegida, no escribiendo la tabla directo',
    llamada && llamada.nombre === 'asis_admin_registrar_manual', JSON.stringify(llamada))
  prueba('envía persona, fecha, horas y motivo completos',
    llamada && llamada.datos.p_cedula === '12345678' && llamada.datos.p_fecha === '2026-09-21' &&
    llamada.datos.p_hora_entrada === '08:20' && llamada.datos.p_hora_salida === '17:05' &&
    /conexión/.test(llamada.datos.p_motivo), JSON.stringify(llamada && llamada.datos))
  prueba('confirma al usuario que el cambio quedó auditado',
    /bitácora/i.test(await pagina.$eval('#avisoAsis', e => e.textContent)))
  prueba('ya no usa ventanas prompt para corregir', (await pagina.evaluate(() => window.PROMPTS)) === 0)

  await pagina.click('[data-sa="hoy"]')
  await pagina.waitForSelector('[data-manual="87654321"]', { timeout: 10000 })
  await pagina.click('[data-manual="87654321"]')
  await pagina.waitForSelector('#asManGuardar:not([disabled])', { timeout: 10000 })
  prueba('desde Hoy se abre el formulario con la persona correcta',
    (await pagina.$eval('#asManPersona', e => e.value)) === '87654321')
  prueba('si falta el registro explica que creará uno sin GPS',
    /sin datos GPS/i.test(await pagina.$eval('#asManEstado', e => e.textContent)))
  prueba('la pantalla no lanzó errores de JavaScript', errores.length === 0, errores.join(' | '))
} finally {
  await navegador.close()
  servidor.close()
}

console.log('\n' + '='.repeat(58))
if (mal) {
  console.log(`FALLARON ${mal} de ${ok + mal}`)
  fallos.forEach(f => console.log('   - ' + f))
  process.exit(1)
}
console.log(`Pasaron las ${ok} pruebas de asistencia manual.`)

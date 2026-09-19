/* La pantalla "Horario" del control de asistencia (asistencia.js), en Chrome.

   Se carga el asistencia.js REAL con los estilos reales de index.html, pero
   contra una base de mentira que anota lo que la pantalla intenta guardar.
   Así se prueba la pantalla sin cuenta de administrador y sin tocar la base.

       node pruebas/panel-horario.mjs              corre las pruebas
       node pruebas/panel-horario.mjs --mutantes   rompe la pantalla y exige que se note */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASIS = process.env.ASIS_RUTA || path.join(RAIZ, 'asistencia.js')

if (process.argv.includes('--mutantes')) {
  const fuente = fs.readFileSync(path.join(RAIZ, 'asistencia.js'), 'utf8')
  const MUT = [
    ['sin la columna, la salida aparece libre', 'var salidaLibre = c.salida_libre === true;', 'var salidaLibre = c.salida_libre !== false;'],
    ['el botón de salida no guarda el interruptor', 'guardar({ salida_libre: libre, salida_desde: desde, salida_hasta: hasta },', 'guardar({ salida_desde: desde, salida_hasta: hasta },'],
    ['el botón del fin de semana guarda al revés', 'guardar({ fin_de_semana_libre: libre },', 'guardar({ fin_de_semana_libre: !libre },'],
    ['los horarios de salida no se apagan al tocar el interruptor', "            document.getElementById('asSalDesde').disabled = x.checked;\n", ''],
    ['la etiqueta no cambia al tocar el interruptor', "p.textContent = x.checked ? x.getAttribute('data-si') : x.getAttribute('data-no');", ''],
  ]
  let vivos = 0
  for (const [nombre, a, b] of MUT) {
    const f = fuente.replace(/\r\n/g, '\n')
    if (f.split(a).length !== 2) { console.log(`  ? ${nombre}: no encontré el texto`); vivos++; continue }
    const tmp = path.join(RAIZ, 'pruebas', '.mutante-asistencia.js')
    fs.writeFileSync(tmp, f.replace(a, b))
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, ASIS_RUTA: tmp }, encoding: 'utf8' })
      const notada = r.status !== 0
      if (!notada) vivos++
      console.log(`  ${notada ? '✓' : '✗'} ${nombre}: ${notada ? 'detectado' : '¡NADIE LO NOTÓ!'}`)
    } finally { fs.rmSync(tmp, { force: true }) }
  }
  console.log(`\nmutantes vivos: ${vivos}`)
  process.exitCode = vivos ? 1 : 0
} else {
  await principal()
}

async function principal() {
  const index = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8')
  const estilos = [...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  const pagina = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${estilos}</style></head><body><main style="padding:12px"><div id="zona"></div></main>
<script>
  /* Base de mentira: devuelve la configuración de window.__config y anota lo que se guarda. */
  window.__updates = [];
  function consulta(tabla) {
    const q = { op: 'select', campos: null, single: false };
    const encadena = ['select', 'eq', 'order', 'range', 'gte', 'lte', 'in', 'is', 'not', 'limit', 'neq', 'ilike', 'or'];
    encadena.forEach(m => { q[m] = function () { return q; }; });
    q.single = function () { q.esSingle = true; return q; };
    q.update = function (c) { q.op = 'update'; q.campos = c; window.__updates.push({ tabla, campos: JSON.parse(JSON.stringify(c)) }); return q; };
    q.then = function (ok, mal) {
      let data;
      if (tabla === 'config_asistencia') data = q.op === 'update' ? [Object.assign(window.__config, q.campos)] : window.__config;
      else data = q.esSingle ? null : [];
      return Promise.resolve({ data, error: null }).then(ok, mal);
    };
    return q;
  }
  window.__sb = { from: consulta, rpc: () => Promise.resolve({ data: null, error: null }) };
</script>
<script src="/comunes.js"></script>
<script src="/asistencia.js"></script>
</body></html>`
  const servidor = await new Promise(ok => {
    const s = http.createServer((pet, res) => {
      const ruta = pet.url.split('?')[0]
      if (ruta === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(pagina); return }
      if (ruta === '/asistencia.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(ASIS)); return }
      if (ruta === '/comunes.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(path.join(RAIZ, 'comunes.js'))); return }
      res.writeHead(404).end()
    })
    s.listen(0, '127.0.0.1', () => ok(s))
  })
  const BASE = 'http://127.0.0.1:' + servidor.address().port + '/'
  const nav = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' })
  let ok = 0, mal = 0
  const prueba = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : mal++; console.log(`  ${b ? '✓' : '✗'} ${n}${b ? '' : '  → esperaba ' + JSON.stringify(esp) + ', dio ' + JSON.stringify(real)}`) }
  const errores = []
  const CONFIG = { id: 1, entrada_desde: '07:00:00', entrada_hasta: '08:45:00', salida_desde: '16:30:00', salida_hasta: '18:30:00',
    exigir_gps: true, tolerancia_gps_metros: 25, precision_maxima_metros: 100 }

  async function abrir(config, ancho = 375) {
    const p = await nav.newPage()
    await p.setViewport({ width: ancho, height: 800 })
    p.on('pageerror', e => errores.push(e.message))
    p.on('dialog', d => d.accept())
    await p.evaluateOnNewDocument((c) => { window.__config = c }, config)
    await p.goto(BASE, { waitUntil: 'networkidle0' })
    await p.evaluate(() => window.PANTALLA_ASISTENCIA(window.__sb, document.getElementById('zona'), { id: 'x' }))
    await p.click('[data-sa="horario"]')
    await p.waitForSelector('#asGuardarFinde', { timeout: 5000 })
    return p
  }
  const estado = (p) => p.evaluate(() => ({
    salidaLibre: document.getElementById('asSalidaLibre').checked,
    pillSalida: document.getElementById('asSalidaLibreEstado').textContent,
    finde: document.getElementById('asFindeLibre').checked,
    pillFinde: document.getElementById('asFindeLibreEstado').textContent,
    horasApagadas: [document.getElementById('asSalDesde').disabled, document.getElementById('asSalHasta').disabled],
    notaEntrada: document.querySelector('#zonaAsis .sub').textContent
  }))

  try {
    console.log('\nCon la salida libre y el fin de semana libre (como quedó pedido)')
    let p = await abrir({ ...CONFIG, salida_libre: true, fin_de_semana_libre: true })
    let e = await estado(p)
    prueba('los dos interruptores aparecen encendidos, y dicen "libre"', [e.salidaLibre, e.pillSalida, e.finde, e.pillFinde], [true, 'libre', true, 'libre'])
    prueba('el horario de salida aparece apagado (no se usa)', e.horasApagadas, [true, true])
    prueba('la entrada aclara que su horario es de lunes a viernes', /de lunes a viernes/.test(e.notaEntrada), true)
    prueba('en el teléfono nada se sale de la pantalla', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 0), true)
    await p.click('#asSalidaLibre')
    e = await estado(p)
    prueba('al apagar la salida libre, la etiqueta dice "con horario" y se prenden las dos horas', [e.pillSalida, e.horasApagadas], ['con horario', [false, false]])
    await p.click('#asGuardarSalida'); await new Promise(r => setTimeout(r, 300))
    const u1 = await p.evaluate(() => window.__updates.slice(-1)[0])
    prueba('"Guardar la salida" guarda el interruptor y las horas', [u1.tabla, u1.campos.salida_libre, u1.campos.salida_desde, u1.campos.salida_hasta], ['config_asistencia', false, '16:30', '18:30'])
    prueba('y avisa que la salida vuelve a tener horario', /vuelve a tener horario/.test(await p.$eval('#avisoAsis', x => x.textContent)), true)
    await p.click('#asFindeLibre')
    await p.click('#asGuardarFinde'); await new Promise(r => setTimeout(r, 300))
    const u2 = await p.evaluate(() => window.__updates.slice(-1)[0])
    prueba('"Guardar el fin de semana" guarda solo ese interruptor, apagado', Object.keys(u2.campos).filter(k => k !== 'actualizado_en').concat([u2.campos.fin_de_semana_libre]), ['fin_de_semana_libre', false])
    await p.close()

    console.log('\nCon la base de antes (sin las columnas nuevas)')
    p = await abrir({ ...CONFIG })
    e = await estado(p)
    prueba('los interruptores aparecen apagados (el comportamiento de antes)', [e.salidaLibre, e.finde, e.pillSalida], [false, false, 'con horario'])
    prueba('y el horario de salida se puede editar', e.horasApagadas, [false, false])
    await p.click('#asSalidaLibre')
    prueba('al encender la salida libre se apagan las dos horas', (await estado(p)).horasApagadas, [true, true])
    prueba('la entrada no habla de "lunes a viernes"', /de lunes a viernes/.test(e.notaEntrada), false)
    await p.close()

    prueba('ninguna página soltó un error', errores, [])
  } catch (x) {
    mal++; console.log('  ✗ la prueba se cortó: ' + x.message)
  } finally {
    await nav.close(); servidor.close()
    console.log(`\n${mal ? '✗' : '✓'} ${ok} bien, ${mal} mal`)
    process.exitCode = mal ? 1 : 0
  }
}

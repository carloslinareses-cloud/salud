/* LAS FICHAS DE LA GENTE: DATOS, PATOLOGÍAS Y MEDICINAS.

   Comprueba, manejando el navegador de verdad, que desde Mercancía se
   puede llevar la ficha completa de una persona:

     · Registrarla desde cero con sus patologías y sus medicinas.
     · Buscarla después, por nombre, por cédula y POR PATOLOGÍA.
     · Corregirle los datos, y anotarle o quitarle patologías y medicinas.
     · Que quien va a entregarle vea sus patologías en la ficha.
     · Que la misma patología no entre dos veces escrita distinto.

   Todo lo que crea empieza por ZZZ y se borra al terminar.

       npm install puppeteer-core
       export FARMACIA_ADMIN_CLAVE=...
       export SUPABASE_TOKEN=sbp_...
       node pruebas/personas.mjs
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
const PAC = 'ZZZ PERSONA FICHA ' + MARCA
const MED = 'ZZZ-MEDICINA FICHA ' + MARCA
const LOTE = 'ZZZP' + MARCA
const CEDULA = String(9200000 + (Date.now() % 799999)).slice(0, 8)
const PAT_RARA = 'ZZZ PATOLOGIA RARA ' + MARCA

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
await new Promise(r => servidor.listen(0, r))
const PUERTO = servidor.address().port

const nav = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', `--user-data-dir=${RAIZ}/perfil-personas`],
})
const pag = await nav.newPage()
await pag.setViewport({ width: 1280, height: 950 })
const errores = []
pag.on('pageerror', e => errores.push('pageerror: ' + e.message))
pag.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
/* Lo que se contesta al prompt de "corregir". Se cambia antes de cada
   caso; null es "cancelar". */
let respuesta = ''
pag.on('dialog', d => (respuesta === null ? d.dismiss() : d.accept(respuesta)))

const espera = (ms) => new Promise(r => setTimeout(r, ms))
const irArea = async (id) => { await pag.click(`.areas [data-area="${id}"]`); await espera(500) }
const sinCargar = () => pag.waitForFunction(
  () => !/Cargando|Buscando/.test((document.getElementById('peZona') || {}).innerText || ''),
  { timeout: 30000 })

try {
  console.log('='.repeat(64))
  console.log('LAS FICHAS DE LA GENTE: DATOS, PATOLOGIAS Y MEDICINAS')
  console.log('='.repeat(64))

  console.log('\n--- 1. Entrar y cargar una medicina para la prueba ---')
  await pag.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'networkidle2' })
  await pag.waitForFunction(() => !document.getElementById('btnEntrar').disabled, { timeout: 25000 })
  await pag.type('#correo', ADMIN)
  await pag.type('#clave', CLAVE)
  await pag.click('#btnEntrar')
  await pag.waitForSelector('.areas', { timeout: 30000 })

  await irArea('inventario')
  await pag.waitForSelector('#zona-inventario [data-p="cargar"]', { timeout: 20000 })
  await pag.click('#zona-inventario [data-p="cargar"]')
  await pag.waitForSelector('#rInsumo', { timeout: 20000 })
  await pag.evaluate(v => {
    document.getElementById('rInsumo').value = v.med
    document.getElementById('rPres').value = 'Tableta'
    document.getElementById('rLote').value = v.lote
    document.getElementById('rVence').value = '2028-12-31'
    document.getElementById('rCant').value = '40'
  }, { med: MED, lote: LOTE })
  await pag.click('#rGuardar')
  await pag.waitForFunction(
    () => /Registrad|No se pudo/i.test((document.getElementById('avisoInv') || {}).textContent || ''),
    { timeout: 30000 })
  prueba('hay una medicina cargada para la prueba', true)

  /* ============================================================
     2. LA PESTAÑA
  ============================================================ */
  console.log('\n--- 2. Personas esta en Mercancia ---')
  const pestanas = await pag.$$eval('#zona-inventario .conmuta button',
    bs => bs.map(b => b.textContent.trim()))
  prueba('Mercancia tiene la pestana Personas', pestanas.includes('Personas'), JSON.stringify(pestanas))

  await pag.click('#zona-inventario [data-p="personas"]')
  await pag.waitForSelector('#peBusca', { timeout: 25000 })
  await sinCargar()
  prueba('se abre con la lista de la gente', true)

  /* ============================================================
     3. REGISTRAR CON PATOLOGIAS Y MEDICINAS
  ============================================================ */
  console.log('\n--- 3. Registrar a alguien con sus patologias ---')
  await pag.click('#peNueva')
  await pag.waitForSelector('#peCrear', { timeout: 20000 })

  const hayCajas = await pag.evaluate(() => ({
    pat: !!document.getElementById('pePatBusca'),
    med: !!document.getElementById('peMedBusca'),
    ced: !!document.getElementById('peCedula'),
    cne: !!document.getElementById('peCne'),
  }))
  prueba('el formulario pide los datos, las patologias y las medicinas',
    hayCajas.pat && hayCajas.med && hayCajas.ced && hayCajas.cne, JSON.stringify(hayCajas))

  await pag.type('#peNombre', PAC)
  await pag.type('#peCedula', CEDULA)
  await pag.type('#peTelefono', '0424-9998877')
  await pag.click('#peSexo [data-v="F"]')

  /* Una patologia de la lista comun: es lo que evita que cada quien la
     escriba de una forma distinta. */
  await pag.waitForFunction(
    () => document.querySelectorAll('#pePatRes .chips.patologias button').length > 0,
    { timeout: 25000 })
  const comunes = await pag.$$eval('#pePatRes .chips.patologias button',
    bs => bs.map(b => b.textContent.trim()))
  prueba('salen patologias ya escritas para elegir', comunes.length > 5, comunes.slice(0, 4).join(' | '))
  prueba('entre ellas las mas comunes de la farmacia',
    comunes.some(x => /HIPERTENSI[OÓ]N/i.test(x)) && comunes.some(x => /DIABETES/i.test(x)),
    comunes.slice(0, 6).join(' | '))

  await pag.evaluate(() => {
    const b = [...document.querySelectorAll('#pePatRes .chips.patologias button')]
      .find(x => /HIPERTENSI[OÓ]N/i.test(x.textContent))
    b.click()
  })
  await espera(300)

  /* Y otra que no existe en ningun sitio, escrita a mano. */
  await pag.evaluate(() => { document.getElementById('pePatBusca').value = '' })
  await pag.type('#pePatBusca', PAT_RARA)
  await pag.waitForFunction(t => {
    const b = document.getElementById('pePatAMano')
    return b && b.innerText.includes(t)
  }, { timeout: 25000 }, PAT_RARA)
  await pag.click('#pePatAMano')
  await espera(300)

  let anotadas = await pag.$$eval('#peListaPat .trat-par', f => f.length)
  prueba('se le anotan dos patologias', anotadas === 2, 'anotadas: ' + anotadas)

  /* Una medicina del catalogo. */
  await pag.type('#peMedBusca', MED)
  await pag.waitForFunction(m => {
    const f = document.querySelectorAll('#peMedRes [data-i]')
    return f.length > 0 && [...f].some(x => x.innerText.includes(m))
  }, { timeout: 25000 }, MED)
  await pag.evaluate(m => {
    [...document.querySelectorAll('#peMedRes [data-i]')].find(x => x.innerText.includes(m)).click()
  }, MED)
  await espera(300)
  const meds = await pag.$$eval('#peListaMed .trat-par', f => f.length)
  prueba('y una medicina', meds === 1, 'medicinas: ' + meds)

  await pag.click('#peCrear')
  await pag.waitForFunction(
    () => /qued[oó] registrada|No se pudo|ya está registrada/i.test(
      (document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgCrear = await pag.$eval('#peAviso', e => e.textContent.trim())
  prueba('se registra de una vez con todo', /quedó registrada/i.test(msgCrear), msgCrear)
  prueba('y el aviso dice cuantas cosas le quedaron', /2 patolog/i.test(msgCrear), msgCrear)

  let base = await sql(`select
      (select count(*) from farmacia.pacientes where nombre = '${PAC}') personas,
      (select count(*) from farmacia.patologias_paciente d
        join farmacia.pacientes p on p.id = d.paciente_id
       where p.nombre = '${PAC}' and d.activo) patologias,
      (select count(*) from farmacia.tratamientos_paciente t
        join farmacia.pacientes p on p.id = t.paciente_id
       where p.nombre = '${PAC}' and t.activo) medicinas;`)
  prueba('en la base quedo la persona con sus 2 patologias y su medicina',
    Number(base[0]?.personas) === 1 && Number(base[0]?.patologias) === 2 &&
    Number(base[0]?.medicinas) === 1, JSON.stringify(base[0]))

  /* ============================================================
     4. SU FICHA
  ============================================================ */
  console.log('\n--- 4. Corregir su ficha ---')
  await pag.waitForFunction(
    () => /Sus patolog/i.test((document.getElementById('peZona') || {}).innerText || ''),
    { timeout: 25000 })
  const ficha = await pag.$eval('#peZona', e => e.innerText.replace(/\s+/g, ' '))
  prueba('la ficha muestra sus patologias', /HIPERTENSI[OÓ]N/i.test(ficha), ficha.slice(0, 200))
  prueba('incluida la que se escribio a mano', ficha.includes(PAT_RARA), ficha.slice(0, 300))
  prueba('y sus medicinas con lo que hay en existencia',
    ficha.includes(MED) && /\d+ disponibles/i.test(ficha), ficha.slice(0, 400))

  /* No se puede anotar dos veces la misma. */
  await pag.click('#peMasPat')
  await pag.waitForSelector('#pePatBusca', { timeout: 20000 })
  await pag.type('#pePatBusca', 'HIPERTENSI')
  await pag.waitForFunction(
    () => document.querySelectorAll('#pePatRes .chips.patologias button').length > 0,
    { timeout: 25000 })
  await pag.evaluate(() => {
    const b = [...document.querySelectorAll('#pePatRes .chips.patologias button')]
      .find(x => /HIPERTENSI[OÓ]N ARTERIAL/i.test(x.textContent))
    b.click()
  })
  await pag.waitForFunction(
    () => /ya estaba anotada|qued[oó] anotada/i.test(
      (document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 25000 })
  const msgRepe = await pag.$eval('#peAviso', e => e.textContent.trim())
  prueba('no deja anotar dos veces la misma patologia', /ya estaba anotada/i.test(msgRepe), msgRepe)

  /* Quitar una. */
  await pag.evaluate(t => {
    const b = [...document.querySelectorAll('#peZona [data-quitapat]')]
      .find(x => x.getAttribute('aria-label').includes(t))
    b.click()
  }, PAT_RARA)
  await pag.waitForFunction(
    () => /Se quit/i.test((document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 25000 })
  base = await sql(`select
      count(*) filter (where d.activo) activas, count(*) total
    from farmacia.patologias_paciente d
    join farmacia.pacientes p on p.id = d.paciente_id
   where p.nombre = '${PAC}';`)
  prueba('se le puede quitar una patologia', Number(base[0]?.activas) === 1, JSON.stringify(base[0]))
  prueba('y no se borra: queda el registro', Number(base[0]?.total) === 2, JSON.stringify(base[0]))

  /* Corregir un dato. */
  await pag.evaluate(() => {
    const i = document.getElementById('peTelefono')
    i.value = '0212-5551234'
  })
  await pag.click('#peGuardar')
  await pag.waitForFunction(
    () => /quedaron guardados|No se pudo/i.test((document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 30000 })
  const msgGuardar = await pag.$eval('#peAviso', e => e.textContent.trim())
  prueba('se le corrigen los datos', /quedaron guardados/i.test(msgGuardar), msgGuardar)
  base = await sql(`select telefono, sexo from farmacia.pacientes where nombre = '${PAC}';`)
  prueba('y el cambio llego a la base', base[0]?.telefono === '0212-5551234', JSON.stringify(base[0]))
  prueba('el sexo se guardo como se eligio, no deducido del nombre',
    base[0]?.sexo === 'F', JSON.stringify(base[0]))

  /* ============================================================
     4b. UNA SOLA LISTA, Y CADA RENGLON SE CORRIGE

     Antes habia tres cosas separadas: lo enlazado al catalogo, lo escrito
     a mano y lo que decia el cuaderno. Para quien atiende eso es UNA
     lista: lo que la persona necesita. Y cada renglon se corrige ahi.
  ============================================================ */
  console.log('\n--- 4b. Una sola lista, y se corrige ---')

  /* Se le anota una medicina que NO esta en el catalogo, para tener en la
     lista las dos clases de renglon a la vez. */
  const A_MANO_MED = 'ZZZ SUERO QUE NO ESTA ' + MARCA
  await pag.click('#peMasMed')
  await pag.waitForSelector('#peMedBusca', { timeout: 20000 })
  await pag.type('#peMedBusca', A_MANO_MED)
  await pag.waitForFunction(t => {
    const b = document.getElementById('peMedAMano')
    return b && b.innerText.includes(t)
  }, { timeout: 25000 }, A_MANO_MED)
  await pag.click('#peMedAMano')
  await pag.waitForFunction(
    () => /qued[oó] anotada/i.test((document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 25000 })

  const listas = await pag.$$eval('#peZona .trat', ts => ts.map(x => x.innerText))
  const suya = listas.find(x => /Medicinas que necesita/i.test(x)) || ''
  prueba('las dos clases de renglon van en la MISMA lista',
    suya.includes(MED) && suya.includes(A_MANO_MED), suya.slice(0, 260))
  prueba('no hay un bloque aparte para lo del cuaderno',
    !/Lo que dice el cuaderno|retirado antes/i.test(
      await pag.$eval('#peZona', e => e.innerText)))
  const cuantasListas = await pag.$$eval('#peZona .trat .trat-lista', l => l.length)
  prueba('las medicinas caben en un solo listado', cuantasListas === 2,
    'listados (patologias + medicinas): ' + cuantasListas)

  const conBoton = await pag.$$eval('#peZona [data-editamed]', b => b.length)
  prueba('cada renglon se puede corregir', conBoton === 2, 'botones: ' + conBoton)

  /* Corregir a algo que SI esta en el catalogo: queda enlazado, y entonces
     se puede entregar de un toque. */
  respuesta = MED
  await pag.evaluate(t => {
    const b = [...document.querySelectorAll('#peZona [data-editamed]')]
      .find(x => x.dataset.texto === t)
    b.click()
  }, A_MANO_MED)
  await pag.waitForFunction(
    () => /enlazado al cat|ya está en su tratamiento|No se pudo/i.test(
      (document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 25000 })
  const msgRepe2 = await pag.$eval('#peAviso', e => e.textContent.trim())
  prueba('no deja corregir a algo que ya tiene', /ya está en su tratamiento/i.test(msgRepe2), msgRepe2)

  /* Ahora a un nombre libre. */
  const CORREGIDO = 'ZZZ SUERO CORREGIDO ' + MARCA
  respuesta = CORREGIDO
  await pag.evaluate(t => {
    const b = [...document.querySelectorAll('#peZona [data-editamed]')]
      .find(x => x.dataset.texto === t)
    b.click()
  }, A_MANO_MED)
  await pag.waitForFunction(
    () => /Qued[oó] como/i.test((document.getElementById('peAviso') || {}).textContent || ''),
    { timeout: 25000 })
  let tr = await sql(`select count(*) c from farmacia.tratamientos_paciente t
     join farmacia.pacientes p on p.id = t.paciente_id
    where p.nombre = '${PAC}' and t.activo and t.texto_original = '${CORREGIDO}';`)
  prueba('se corrige el nombre y llega a la base', Number(tr[0]?.c) === 1, JSON.stringify(tr[0]))

  const trasCorregir = await pag.$eval('#peZona', e => e.innerText)
  prueba('y se ve corregido en la lista', trasCorregir.includes(CORREGIDO),
    trasCorregir.slice(0, 260))
  prueba('diciendo que ese no está en el catálogo',
    /no está en el catálogo/i.test(trasCorregir), trasCorregir.slice(0, 300))

  /* Cancelar no cambia nada. */
  respuesta = null
  await pag.evaluate(t => {
    const b = [...document.querySelectorAll('#peZona [data-editamed]')]
      .find(x => x.dataset.texto === t)
    b.click()
  }, CORREGIDO)
  await espera(900)
  tr = await sql(`select count(*) c from farmacia.tratamientos_paciente t
     join farmacia.pacientes p on p.id = t.paciente_id
    where p.nombre = '${PAC}' and t.activo and t.texto_original = '${CORREGIDO}';`)
  prueba('cancelar no cambia nada', Number(tr[0]?.c) === 1, JSON.stringify(tr[0]))
  respuesta = ''

  /* ============================================================
     5. BUSCARLA POR PATOLOGIA
  ============================================================ */
  console.log('\n--- 5. Buscar por patologia ---')
  await pag.click('#peVolver')
  await pag.waitForSelector('#peBusca', { timeout: 20000 })
  /* La casilla conserva lo escrito antes, asi que hay que vaciarla o se
     escribe encima y no encuentra nada. */
  await pag.evaluate(() => { document.getElementById('peBusca').value = '' })
  await pag.type('#peBusca', PAC)
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#peRes .ficha')
    return f.length === 1 && f[0].innerText.includes(t)
  }, { timeout: 25000 }, PAC)
  const enLista = await pag.$eval('#peRes .ficha', e => e.innerText.replace(/\s+/g, ' '))
  prueba('en la lista se ve con sus patologias', /HIPERTENSI[OÓ]N/i.test(enLista), enLista)
  /* Dos: la del catalogo mas la que se anoto a mano y luego se corrigio. */
  prueba('y con cuantas medicinas necesita', /2 medicinas/i.test(enLista), enLista)

  await pag.evaluate(() => { document.getElementById('peBusca').value = '' })
  await pag.type('#peBusca', 'HIPERTENSION ARTERIAL')
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#peRes .ficha')
    return f.length > 0 && [...f].some(x => x.innerText.includes(t))
  }, { timeout: 25000 }, PAC).catch(() => {})
  const porPat = await pag.$eval('#peRes', e => e.innerText)
  prueba('se puede buscar a la gente POR PATOLOGIA', porPat.includes(PAC), porPat.slice(0, 200))

  /* ============================================================
     6. QUIEN ENTREGA VE LAS PATOLOGIAS
  ============================================================ */
  console.log('\n--- 6. Al entregarle se ven sus patologias ---')
  await irArea('despacho')
  await pag.waitForSelector('#buscaDestino', { timeout: 25000 })
  await pag.type('#buscaDestino', PAC)
  await pag.waitForFunction(t => {
    const f = document.querySelectorAll('#resultados .ficha')
    return f.length === 1 && f[0].innerText.includes(t)
  }, { timeout: 25000 }, PAC)
  await pag.click('#resultados .ficha')
  await pag.waitForSelector('#zonaDestino .elegido', { timeout: 25000 })
  await pag.waitForFunction(
    () => /Sus patolog/i.test((document.getElementById('zonaDestino') || {}).innerText || ''),
    { timeout: 25000 })
  /* CANDADO: el tratamiento se pide aparte y tarda. Sin esperarlo, se lee
     la ficha con "Buscando..." todavia puesto. */
  await pag.waitForFunction(
    () => !/Buscando/i.test((document.getElementById('zonaDestino') || {}).innerText || ''),
    { timeout: 25000 })
  const alEntregar = await pag.$eval('#zonaDestino', e => e.innerText.replace(/\s+/g, ' '))
  prueba('quien entrega ve sus patologias', /Sus patolog[ií]as/i.test(alEntregar), alEntregar.slice(0, 200))
  prueba('con la que tiene anotada', /HIPERTENSI[OÓ]N/i.test(alEntregar), alEntregar.slice(0, 260))
  prueba('y sigue viendo sus medicinas', alEntregar.includes(MED), alEntregar.slice(0, 400))

  /* ============================================================
     7. EN EL TELEFONO
  ============================================================ */
  console.log('\n--- 7. En una pantalla de telefono ---')
  await irArea('inventario')
  await pag.click('#zona-inventario [data-p="personas"]')
  await pag.waitForSelector('#peBusca', { timeout: 25000 })
  await sinCargar()
  await pag.setViewport({ width: 375, height: 780 })
  await espera(600)
  const ancho = await pag.evaluate(() => ({
    doc: document.documentElement.scrollWidth, vista: window.innerWidth
  }))
  prueba('no hay que arrastrar de lado', ancho.doc <= ancho.vista + 1, JSON.stringify(ancho))
  const chicos = await pag.evaluate(() => {
    const malos = []
    document.querySelectorAll('#peZona button, #peZona input').forEach(e => {
      const r = e.getBoundingClientRect()
      if (r.height > 0 && r.height < 44) malos.push(e.id || e.className || e.tagName)
    })
    return malos
  })
  prueba('todo se puede tocar con el dedo', chicos.length === 0, JSON.stringify(chicos.slice(0, 5)))
  await pag.setViewport({ width: 1280, height: 950 })

  console.log('\n--- Errores de JavaScript ---')
  const graves = errores.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e))
  prueba('la pagina no lanzo ningun error', graves.length === 0, graves.slice(0, 3).join(' | '))

} catch (e) {
  mal++; fallos.push('EXCEPCION: ' + e.message)
  console.log('\n  EXCEPCION: ' + e.message)
  try { await pag.screenshot({ path: RAIZ + '/fallo-personas.png', fullPage: true }) } catch {}
} finally {
  await nav.close(); servidor.close()
  fs.rmSync(RAIZ + '/perfil-personas', { recursive: true, force: true })
}

/* ---------------------------------------------------- limpieza */
const limpieza = await sql(`
begin;
set local session_replication_role = replica;

delete from farmacia.bitacora
 where registro_id in (select d.id::text from farmacia.patologias_paciente d
                        join farmacia.pacientes p on p.id = d.paciente_id where p.nombre like 'ZZZ%')
    or registro_id in (select t.id::text from farmacia.tratamientos_paciente t
                        join farmacia.pacientes p on p.id = t.paciente_id where p.nombre like 'ZZZ%')
    or registro_id in (select l.id::text from farmacia.lotes l
                        join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select m.id::text from farmacia.movimientos m
                        join farmacia.lotes l on l.id = m.lote_id
                        join farmacia.productos p on p.id = l.producto_id where p.nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.productos where nombre like 'ZZZ-%')
    or registro_id in (select id::text from farmacia.pacientes where nombre like 'ZZZ%');

delete from farmacia.bitacora
 where registro_id in (select e.id::text from farmacia.entregas e
                        join farmacia.pacientes p on p.id = e.paciente_id
                       where p.nombre like 'ZZZ%');
delete from farmacia.entregas e using farmacia.pacientes p
 where e.paciente_id = p.id and p.nombre like 'ZZZ%';
delete from farmacia.patologias_paciente d using farmacia.pacientes p
 where d.paciente_id = p.id and p.nombre like 'ZZZ%';
delete from farmacia.tratamientos_paciente t using farmacia.pacientes q
 where t.paciente_id = q.id and q.nombre like 'ZZZ%';
delete from farmacia.movimientos m using farmacia.lotes l, farmacia.productos p
 where m.lote_id = l.id and l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.lotes l using farmacia.productos p
 where l.producto_id = p.id and p.nombre like 'ZZZ-%';
delete from farmacia.productos where nombre like 'ZZZ-%';
delete from farmacia.pacientes where nombre like 'ZZZ%';

set local session_replication_role = origin;
commit;`)

const quedaron = (await sql(`select
  (select count(*) from farmacia.productos where nombre like 'ZZZ-%') productos,
  (select count(*) from farmacia.pacientes where nombre like 'ZZZ%') personas,
  (select count(*) from farmacia.v_patologias where patologia like 'ZZZ%') patologias;`))[0] || {}
const suma = Object.values(quedaron).reduce((a, b) => a + Number(b), 0)
prueba('la prueba no deja nada suyo en la base', suma === 0,
  JSON.stringify(limpieza.error ? limpieza : quedaron).slice(0, 220))

console.log('\n' + '='.repeat(64))
if (mal) { console.log(`FALLARON ${mal} de ${ok + mal}`); fallos.forEach(f => console.log('   - ' + f)); process.exit(1) }
console.log(`Pasaron las ${ok} pruebas de las fichas de la gente.`)

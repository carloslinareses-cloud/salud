/* LAS ENTREGAS A CENTROS QUE YA PASARON, ANTES DE ESTE SISTEMA.

   La hoja "REGISTRO DE ENTREGAS C.D.S" del cuaderno anota, entrega por
   entrega: la fecha, a qué centro, qué departamento la recibió, la
   lista de insumos (varios juntos, separados por "/") y UNA sola
   cantidad total para todos ellos, y quién firmó que la recibió.

   Se cargan como entregas de verdad -para que sí aparezcan en el
   análisis por día/semana/mes- pero SIN tocar el inventario: no se
   crea ningún renglón de entrega_detalle, porque eso exigiría un lote
   real y una cantidad POR INSUMO, y la única cantidad que hay es la
   del renglón entero. Repartirla entre los insumos sería inventar
   números.

   La cantidad total y la lista de insumos quedan como texto, en la
   observación -de ahí la pantalla los separa uno por uno para verlos,
   pero no se suman a ninguna cifra de unidades-.

   Todo queda marcado `origen = 'migracion_excel'`, así que se deshace
   entero con:

       delete from farmacia.entregas
        where origen = 'migracion_excel' and tipo_destinatario = 'institucion';

       export SUPABASE_TOKEN=sbp_...
       node migracion/11_entregas_centros_historicas.mjs             (solo mira)
       node migracion/11_entregas_centros_historicas.mjs --aplicar   (escribe)
*/
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')

const REF = process.env.SUPABASE_REF || 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }
const APLICAR = process.argv.includes('--aplicar')

const EXCEL = process.env.EXCEL_CDI ||
  'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/' +
  '84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/insumos_cdi.xlsx'

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(t.slice(0, 500))
  try { return JSON.parse(t) } catch { return [] }
}
const comilla = (t) => "'" + String(t).replace(/'/g, "''") + "'"
const claveCentro = (t) => F.sinAcentos(t).replace(/[.\-_]/g, '').replace(/\s+/g, '')

console.log('='.repeat(64))
console.log('LAS ENTREGAS A CENTROS QUE YA PASARON, DEL CUADERNO')
console.log('='.repeat(64))
console.log(APLICAR ? '\nMODO: se va a ESCRIBIR en la base.\n'
                    : '\nMODO: solo mirar. Nada se escribe. Usa --aplicar para hacerlo.\n')

/* ---- 1. leer el Excel ---- */
let XLSX
try { XLSX = require('xlsx') } catch {
  console.error('Falta la biblioteca para leer Excel:  npm install xlsx'); process.exit(2)
}
const libro = XLSX.readFile(EXCEL)
const hoja = libro.SheetNames.find(h => /REGISTRO DE ENTREGAS/i.test(h))
if (!hoja) { console.error('No está la hoja de entregas en ' + EXCEL); process.exit(2) }

const rejilla = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, defval: '', raw: false })
let colFecha = -1, colCentro = -1, colDepto = -1, colInsumo = -1, colCant = -1, colRecibe = -1, desde = 0
for (let i = 0; i < Math.min(rejilla.length, 12); i++) {
  const f = rejilla[i]
  const cFecha = f.findIndex(x => /^fecha/i.test(String(x).trim()))
  const cCentro = f.findIndex(x => /centro|destino/i.test(String(x)))
  const cDepto = f.findIndex(x => /departamento|servicio/i.test(String(x)))
  const cInsumo = f.findIndex(x => /insumo|descrip/i.test(String(x)))
  const cCant = f.findIndex(x => /cantidad/i.test(String(x)))
  const cRecibe = f.findIndex(x => /recib/i.test(String(x)))
  if (cFecha >= 0 && cCentro >= 0 && cInsumo >= 0) {
    colFecha = cFecha; colCentro = cCentro; colDepto = cDepto; colInsumo = cInsumo
    colCant = cCant; colRecibe = cRecibe; desde = i + 1
    break
  }
}
if (colFecha < 0) {
  console.error('No están las columnas. Primera fila: ' + (rejilla[0] || []).join(' | '))
  process.exit(2)
}

/* dd/m/aaaa o dd/m/aa -> aaaa-mm-dd */
function fechaISO(t) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(t || '').trim())
  if (!m) return null
  let [, d, mo, a] = m
  if (a.length === 2) a = (Number(a) < 50 ? '20' : '19') + a
  const iso = `${a}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return /Invalid|NaN/.test(new Date(iso).toString()) ? null : iso
}

const filas = rejilla.slice(desde)
  .filter(f => f.some(c => String(c).trim() !== '') && String(f[colCentro] || '').trim().length > 2)
  .map(f => ({
    fecha: fechaISO(f[colFecha]),
    fechaCruda: String(f[colFecha] || '').trim(),
    centro: String(f[colCentro] || '').replace(/\s+/g, ' ').trim(),
    departamento: colDepto >= 0 ? (String(f[colDepto] || '').replace(/\s+/g, ' ').trim() || null) : null,
    insumos: String(f[colInsumo] || '').replace(/\s+/g, ' ').trim(),
    cantidad: colCant >= 0 ? Number(f[colCant]) : NaN,
    recibe: colRecibe >= 0 ? (String(f[colRecibe] || '').replace(/\s+/g, ' ').trim() || null) : null,
  }))
  .filter(f => f.insumos.length >= 3)

const sinFecha = filas.filter(f => !f.fecha)
console.log('Renglones con datos               ' + filas.length)
if (sinFecha.length) {
  console.log('Con fecha rara, se descartan       ' + sinFecha.length)
  sinFecha.forEach(f => console.log('  ' + f.fechaCruda + '  ' + f.centro))
}
const usables = filas.filter(f => f.fecha)

/* ---- 2. con quién casa en la base ---- */
const centrosBase = await sql('select id::text, nombre from farmacia.instituciones;')
const idDe = new Map(centrosBase.map(c => [claveCentro(c.nombre), { id: c.id, nombre: c.nombre }]))

const sinCentro = []
const listas = []
for (const f of usables) {
  const destino = idDe.get(claveCentro(f.centro))
  if (!destino) { sinCentro.push(f.centro); continue }

  /* Sin nombre de quien recibe, la base rechaza la fila -exige más de
     2 letras-. Se deja constancia de que no venía, no se inventa un
     nombre. */
  const recibe = (f.recibe && f.recibe.length > 2) ? f.recibe : 'No consta (viene del cuaderno)'

  const piezas = F.piezasTratamiento(f.insumos).filter(x => x.length >= 2)
  const cantidadTxt = Number.isFinite(f.cantidad) && f.cantidad > 0
    ? `Cantidad total anotada en el cuaderno para este renglón: ${f.cantidad} ` +
      `(repartida entre los ${piezas.length} insumos de la lista, sin desglose por unidad).`
    : 'El cuaderno no anota una cantidad para este renglón.'

  listas.push({
    fecha: f.fecha, institucion_id: destino.id, nombreCentro: destino.nombre,
    departamento: f.departamento, recibe_nombre: recibe,
    observacion: f.insumos + '  —  ' + cantidadTxt,
  })
}

console.log('Entregas a crear                  ' + listas.length)
if (sinCentro.length) {
  console.log('\nNo están dados de alta (corre antes 06_centros.mjs):')
  ;[...new Set(sinCentro)].forEach(n => console.log('  ' + n))
}
const porCentro = {}
for (const x of listas) porCentro[x.nombreCentro] = (porCentro[x.nombreCentro] || 0) + 1
console.log('\nPor centro:')
Object.entries(porCentro).sort((a, b) => b[1] - a[1]).forEach(([n, v]) => console.log('  %s  %s', String(v).padStart(3), n))

if (!APLICAR) {
  console.log('\nNada se escribió. Para hacerlo:  node migracion/11_entregas_centros_historicas.mjs --aplicar')
} else if (!listas.length) {
  console.log('\nNo hay nada que crear.')
} else {
  const ya = await sql(`select count(*) n from farmacia.entregas where origen = 'migracion_excel' and tipo_destinatario = 'institucion';`)
  if (Number(ya[0]?.n) > 0) {
    console.log('\nYa hay ' + ya[0].n + ' entregas migradas de centros. Para no duplicar, bórralas primero:')
    console.log("  delete from farmacia.entregas where origen = 'migracion_excel' and tipo_destinatario = 'institucion';")
    process.exit(1)
  }

  const valores = listas.map(x =>
    `(${comilla(x.fecha)}::date, 'institucion', ${comilla(x.institucion_id)}::uuid, ` +
    `${x.departamento ? comilla(x.departamento) : 'null'}, ${comilla(x.recibe_nombre)}, ` +
    `${comilla(x.observacion)}, 'migracion_excel', false)`
  ).join(',\n    ')

  await sql(`insert into farmacia.entregas
      (fecha, tipo_destinatario, institucion_id, departamento, recibe_nombre, observacion, origen, anulada)
    values
    ${valores};`)

  const fin = await sql(`select count(*) n from farmacia.entregas where origen = 'migracion_excel' and tipo_destinatario = 'institucion';`)
  console.log('\nQuedaron ' + fin[0].n + ' entregas históricas cargadas.')
  console.log('No se tocó el inventario: no se creó ningún renglón de entrega_detalle.')
  console.log('Se deshace entero con:')
  console.log("  delete from farmacia.entregas where origen = 'migracion_excel' and tipo_destinatario = 'institucion';")
}

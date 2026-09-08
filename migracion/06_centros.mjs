/* DAR DE ALTA LOS CENTROS DE SALUD DEL CUADERNO.

   La hoja "REGISTRO DE ENTREGAS C.D.S" del Excel de insumos anota a qué
   centro se le entregó cada vez. De ahí salen los centros que ya existen
   de verdad, escritos como los escribe la farmacia.

   Lo que este script SÍ hace: unir lo que es literalmente el mismo
   nombre escrito de otra forma —espacios, puntos, acentos, mayúsculas—.
   "CDI MAMA PANCHA", "CDI MAMAPANCHA" y "C.D.I. MAMAPANCHA" son el mismo
   sitio y se cuentan como uno.

   Lo que NO hace: decidir que dos nombres DISTINTOS son el mismo centro.
   "RAMON FIGUERA HOSPITALITO" y "DR. RAMON FIGUERA AROCHA" se parecen,
   pero eso es cosa de quien conoce el municipio, no del programa. Entran
   como dos y se avisa para que un humano los una si toca.

   El tipo se lee del propio nombre: si dice CDI es CDI, si dice HOSPITAL
   es hospital, y lo demás queda como "Otro" para corregirlo a mano.

       export SUPABASE_TOKEN=sbp_...
       node migracion/06_centros.mjs             (solo mira)
       node migracion/06_centros.mjs --aplicar   (escribe)
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
  if (r.status >= 300) throw new Error(t.slice(0, 400))
  try { return JSON.parse(t) } catch { return [] }
}
const comilla = (t) => "'" + String(t).replace(/'/g, "''") + "'"

/* Para comparar: sin acentos, sin mayusculas, sin puntos y sin espacios.
   Asi "C.D.I. MAMAPANCHA" y "CDI MAMA PANCHA" son la misma clave. */
const clave = (t) => F.sinAcentos(t).replace(/[.\-_]/g, '').replace(/\s+/g, '');

/* El tipo se LEE del nombre, no se adivina. */
function tipoDe(nombre) {
  const n = F.sinAcentos(nombre);
  if (/\bc\.?d\.?i\.?\b/.test(n) || n.includes('cdi')) return 'CDI';
  if (n.includes('hospital')) return 'Hospital';
  if (n.includes('ambulatorio')) return 'Ambulatorio';
  if (n.includes('consultorio')) return 'Consultorio Popular';
  if (n.includes('base de mision')) return 'Base de Misiones';
  return 'Otro';
}

console.log('='.repeat(64))
console.log('CENTROS DE SALUD DEL CUADERNO')
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
/* La hoja no empieza en la primera linea: arriba hay titulos y celdas
   unidas. Se lee como rejilla y se busca el renglon de los encabezados. */
const rejilla = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, defval: '' })
  .filter(f => f.some(c => String(c).trim() !== ''))

let col = -1, desde = 0
for (let i = 0; i < Math.min(rejilla.length, 12); i++) {
  const j = rejilla[i].findIndex(c => /centro|destino/i.test(String(c)))
  if (j >= 0) { col = j; desde = i + 1; break }
}
if (col < 0) { console.error('No está la columna del centro. Primera fila: ' +
  (rejilla[0] || []).join(' | ')); process.exit(2) }
const filas = rejilla.slice(desde)

/* ---- 2. juntar las formas de escribir cada centro ---- */
const grupos = new Map()
for (const f of filas) {
  const bruto = String(f[col] || '').replace(/\s+/g, ' ').trim()
  if (bruto.length < 3) continue
  const k = clave(bruto)
  if (!grupos.has(k)) grupos.set(k, { formas: new Map(), veces: 0 })
  const g = grupos.get(k)
  g.veces++
  g.formas.set(bruto, (g.formas.get(bruto) || 0) + 1)
}

/* De cada grupo se toma la forma que más se repite; a igualdad, la más
   larga, que suele ser la más completa. */
const centros = [...grupos.values()].map(g => {
  const formas = [...g.formas.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
  return {
    nombre: formas[0][0],
    veces: g.veces,
    tipo: tipoDe(formas[0][0]),
    variantes: formas.slice(1).map(x => x[0]),
  }
}).sort((a, b) => b.veces - a.veces)

/* ---- 3. qué falta en la base ---- */
const yaHay = await sql('select nombre from farmacia.instituciones;')
const tengo = new Set(yaHay.map(x => clave(x.nombre)))
const faltan = centros.filter(c => !tengo.has(clave(c.nombre)))

console.log('En el cuaderno hay %d centros distintos (de %d entregas).',
  centros.length, filas.length)
console.log('En la base ya hay %d. Faltan %d.\n', yaHay.length, faltan.length)

console.log('  VECES  TIPO                  NOMBRE')
for (const c of centros) {
  console.log('  %s  %s  %s%s',
    String(c.veces).padStart(5), c.tipo.padEnd(20),
    tengo.has(clave(c.nombre)) ? '(ya está) ' : '', c.nombre)
  for (const v of c.variantes) console.log('         también escrito: %s', v)
}

/* Nombres que se PARECEN pero no son iguales: los une un humano, no esto. */
const parecidos = []
for (let i = 0; i < centros.length; i++) {
  for (let j = i + 1; j < centros.length; j++) {
    const a = F.sinAcentos(centros[i].nombre).split(/\s+/)
    const b = F.sinAcentos(centros[j].nombre).split(/\s+/)
    const comunes = a.filter(p => p.length > 3 && b.includes(p))
    if (comunes.length >= 1) parecidos.push([centros[i].nombre, centros[j].nombre, comunes])
  }
}
if (parecidos.length) {
  console.log('\nOJO — estos se parecen, pero NO los uno yo:')
  for (const [a, b, c] of parecidos) console.log('  «%s»  y  «%s»   (comparten: %s)', a, b, c.join(', '))
  console.log('  Si alguno es el mismo sitio, únelos a mano en Mercancía → Centros.')
}

if (!APLICAR) {
  console.log('\nNada se escribió. Para hacerlo:  node migracion/06_centros.mjs --aplicar')
  process.exit(0)
}
if (!faltan.length) { console.log('\nNo falta ninguno.'); process.exit(0) }

/* ---- 4. darlos de alta ---- */
const valores = faltan.map(c =>
  `(${comilla(c.nombre)}, ${comilla(c.tipo)}, true)`).join(',\n    ')
await sql(`insert into farmacia.instituciones (nombre, tipo, activo)
  values
    ${valores};`)

const fin = await sql(`select tipo, count(*) n from farmacia.instituciones
                        group by tipo order by n desc;`)
console.log('\nDados de alta %d centros. En la base, ahora:', faltan.length)
for (const x of fin) console.log('  %s  %s', String(x.n).padStart(3), x.tipo)

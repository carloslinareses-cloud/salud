/* ARMARLE A CADA CENTRO SU LISTA DE INSUMOS, CON LO QUE YA SE LE HA DADO.

   La hoja "REGISTRO DE ENTREGAS C.D.S" anota, entrega por entrega, qué se
   le mandó a cada centro. De ahí sale su lista: si a Mamá Pancha se le han
   mandado nueve veces dipirona y jeringas, eso es lo que pide.

   Cómo parte la descripción: con la MISMA función que usa la pantalla
   (comunes.js), la que tiene sus pruebas. Respeta lo que no se puede
   partir: "LIDOCAINA 1 %", "SOL 0.9/HIDRATANTE".

   Lo que enlaza al catálogo: solo cuando el nombre COINCIDE EXACTO con un
   medicamento cargado. Enlazado sirve para entregarlo de un toque; lo
   demás queda como texto y la pantalla lo dice.

   La CANTIDAD queda vacía a propósito. El Excel anota una sola cantidad
   para los diez insumos del renglón: repartirla entre ellos sería
   inventar números. Se pone a mano en la ficha del centro, que es donde
   se sabe.

   Todo queda marcado `origen = 'cuaderno'`, así que se deshace entero:

       delete from farmacia.requerimientos_institucion where origen = 'cuaderno';

       export SUPABASE_TOKEN=sbp_...
       node migracion/07_insumos_centros.mjs             (solo mira)
       node migracion/07_insumos_centros.mjs --aplicar   (escribe)
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

/* Para el CENTRO: sin acentos, sin puntos y sin espacios, que es como se
   dieron de alta ("C.D.I. MAMAPANCHA" = "CDI MAMA PANCHA"). */
const claveCentro = (t) => F.sinAcentos(t).replace(/[.\-_]/g, '').replace(/\s+/g, '')
/* Para el INSUMO: sin acentos ni espacios, para no repetir "GASA 5X5" y
   "GASA 5 X 5". Ojo: 5x5 y 3x3 siguen siendo distintos, que es lo suyo. */
const claveInsumo = (t) => F.sinAcentos(t).replace(/\s+/g, '')

console.log('='.repeat(64))
console.log('LA LISTA DE INSUMOS DE CADA CENTRO')
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

const rejilla = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, defval: '' })
  .filter(f => f.some(c => String(c).trim() !== ''))

let colCentro = -1, colInsumo = -1, desde = 0
for (let i = 0; i < Math.min(rejilla.length, 12); i++) {
  const c = rejilla[i].findIndex(x => /centro|destino/i.test(String(x)))
  const s = rejilla[i].findIndex(x => /insumo|descrip/i.test(String(x)))
  if (c >= 0 && s >= 0) { colCentro = c; colInsumo = s; desde = i + 1; break }
}
if (colCentro < 0) {
  console.error('No están las columnas. Primera fila: ' + (rejilla[0] || []).join(' | '))
  process.exit(2)
}

/* ---- 2. qué pide cada centro ---- */
const porCentro = new Map()
for (const f of rejilla.slice(desde)) {
  const centro = String(f[colCentro] || '').replace(/\s+/g, ' ').trim()
  const insumos = String(f[colInsumo] || '').replace(/\s+/g, ' ').trim()
  if (centro.length < 3 || insumos.length < 3) continue
  const k = claveCentro(centro)
  if (!porCentro.has(k)) porCentro.set(k, { nombre: centro, textos: [] })
  porCentro.get(k).textos.push(insumos)
}

/* ---- 3. con quién casa en la base ---- */
const centrosBase = await sql('select id::text, nombre from farmacia.instituciones;')
const idDe = new Map(centrosBase.map(c => [claveCentro(c.nombre), { id: c.id, nombre: c.nombre }]))

const catalogo = await sql('select producto_id::text, producto from farmacia.v_catalogo;')
const enCatalogo = new Map(catalogo.map(c => [claveInsumo(c.producto), c.producto_id]))

const yaTiene = await sql(`select institucion_id::text pid,
       coalesce(p.nombre, r.texto_original) texto
  from farmacia.requerimientos_institucion r
  left join farmacia.productos p on p.id = r.producto_id
 where r.activo;`)
const tengo = new Map()
for (const x of yaTiene) {
  if (!tengo.has(x.pid)) tengo.set(x.pid, new Set())
  if (x.texto) tengo.get(x.pid).add(claveInsumo(x.texto))
}

/* ---- 4. qué habría que crear ---- */
const nuevos = []
const sinCentro = []
let enlazados = 0
for (const [k, c] of porCentro) {
  const destino = idDe.get(k)
  if (!destino) { sinCentro.push(c.nombre); continue }
  const suyos = tengo.get(destino.id) || new Set()
  const vistos = new Set()
  const piezas = F.piezasTratamiento(c.textos)
    .filter(x => x.length >= 3 && x.length <= 120)
    .filter(x => {
      const ki = claveInsumo(x)
      if (suyos.has(ki) || vistos.has(ki)) return false
      vistos.add(ki); return true
    })
  for (const p of piezas) {
    const pid = enCatalogo.get(claveInsumo(p)) || null
    if (pid) enlazados++
    nuevos.push({ centro: destino.id, nombreCentro: destino.nombre, texto: p, producto: pid })
  }
}

console.log('Centros en el cuaderno            ' + porCentro.size)
console.log('Renglones de lista a crear        ' + nuevos.length)
console.log('  ya enlazados al catálogo        ' + enlazados)
console.log('  como texto, sin enlazar         ' + (nuevos.length - enlazados))
if (sinCentro.length) {
  console.log('\nNo están dados de alta (corre antes 06_centros.mjs):')
  for (const n of sinCentro) console.log('  ' + n)
}

const porNombre = {}
for (const n of nuevos) porNombre[n.nombreCentro] = (porNombre[n.nombreCentro] || 0) + 1
console.log('\nInsumos por centro:')
for (const [n, v] of Object.entries(porNombre).sort((a, b) => b[1] - a[1])) {
  console.log('  %s  %s', String(v).padStart(4), n)
}

if (!APLICAR) {
  console.log('\nNada se escribió. Para hacerlo:  node migracion/07_insumos_centros.mjs --aplicar')
} else if (!nuevos.length) {
  console.log('\nNo falta ninguno.')
} else {
  /* ---- 5. escribirlo ---- */
  for (let i = 0; i < nuevos.length; i += 400) {
    const trozo = nuevos.slice(i, i + 400)
    const valores = trozo.map(n =>
      `('${n.centro}'::uuid, ${n.producto ? "'" + n.producto + "'::uuid" : 'null'}, ` +
      `${n.producto ? 'null' : comilla(n.texto)}, true, 'cuaderno')`).join(',\n    ')
    await sql(`insert into farmacia.requerimientos_institucion
        (institucion_id, producto_id, texto_original, activo, origen)
      values
      ${valores};`)
    process.stdout.write('\r  guardados ' + Math.min(i + 400, nuevos.length) + ' de ' + nuevos.length)
  }
  console.log('')

  const fin = await sql(`select i.nombre, count(*) n
      from farmacia.requerimientos_institucion r
      join farmacia.instituciones i on i.id = r.institucion_id
     where r.activo group by i.nombre order by n desc;`)
  console.log('\nEn la base, ahora:')
  for (const x of fin) console.log('  %s  %s', String(x.n).padStart(4), x.nombre)
  console.log('\nLa CANTIDAD de cada uno queda vacía: se pone en Mercancía → Centros.')
  console.log('Se deshace entero con:')
  console.log("  delete from farmacia.requerimientos_institucion where origen = 'cuaderno';")
}

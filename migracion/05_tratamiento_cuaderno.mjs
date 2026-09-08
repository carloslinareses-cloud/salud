/* PASAR AL TRATAMIENTO LO QUE DICE EL CUADERNO.

   El cuaderno de la farmacia anotaba el tratamiento en la casilla
   TRATAMIENTO de cada entrega. Al migrar, eso entró como el texto de la
   entrega —que es lo que era—, y por eso la ficha de 2.734 personas salía
   vacía teniendo el dato justo al lado.

   Este script lo pasa al tratamiento de cada quien, para que todo se vea
   y se corrija en un solo sitio.

   Cómo parte el texto: con la MISMA función que usa la pantalla
   (comunes.js), que tiene sus propias pruebas. Así lo que se guarda es
   exactamente lo que la persona veía antes en pantalla, ni más ni menos.

   Todo lo que crea queda marcado `origen = 'cuaderno'`, así que se
   deshace entero con una sola orden:

       delete from farmacia.tratamientos_paciente where origen = 'cuaderno';

   Se puede correr varias veces: no duplica lo que ya está.

       export SUPABASE_TOKEN=sbp_...
       node migracion/05_tratamiento_cuaderno.mjs            (solo mira)
       node migracion/05_tratamiento_cuaderno.mjs --aplicar  (escribe)
*/
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')

const REF = process.env.SUPABASE_REF || 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }
const APLICAR = process.argv.includes('--aplicar')

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

/* Para comparar y no duplicar: sin acentos, sin mayúsculas y SIN ESPACIOS.
   "VALSARTAN 80MG" y "VALSARTAN 80 MG" son el mismo renglón escrito de dos
   formas. OJO: 80MG y 50MG siguen siendo distintos, que es lo que importa. */
const clave = (t) => F.sinAcentos(t).replace(/\s+/g, '')
const comilla = (t) => "'" + String(t).replace(/'/g, "''") + "'"

/* Se trae de mil en mil: la API corta y no avisa. */
async function todo(consulta, orden) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const t = await sql(`${consulta} order by ${orden} limit 1000 offset ${desde};`)
    filas.push(...t)
    if (t.length < 1000) break
    if (filas.length > 200000) throw new Error('demasiadas filas, algo va mal')
  }
  return filas
}

console.log('='.repeat(64))
console.log('PASAR AL TRATAMIENTO LO QUE DICE EL CUADERNO')
console.log('='.repeat(64))
console.log(APLICAR ? '\nMODO: se va a ESCRIBIR en la base.\n'
                    : '\nMODO: solo mirar. Nada se escribe. Usa --aplicar para hacerlo.\n')

/* ---- 1. lo que dice el cuaderno ---- */
const entregas = await todo(
  `select e.paciente_id::text pid, e.observacion
     from farmacia.entregas e
    where e.paciente_id is not null
      and not coalesce(e.anulada, false)
      and e.observacion is not null
      and length(trim(e.observacion)) > 2`,
  'e.paciente_id, e.fecha desc nulls last, e.id')

/* ---- 2. lo que ya tiene anotado cada quien ---- */
const yaTiene = await todo(
  `select t.paciente_id::text pid,
          coalesce(p.nombre, t.texto_original) texto
     from farmacia.tratamientos_paciente t
     left join farmacia.productos p on p.id = t.producto_id
    where t.activo`,
  't.paciente_id, t.id')

const tengo = new Map()
for (const x of yaTiene) {
  if (!tengo.has(x.pid)) tengo.set(x.pid, new Set())
  if (x.texto) tengo.get(x.pid).add(clave(x.texto))
}

/* ---- 3. qué habría que agregarle a cada quien ---- */
const porPaciente = new Map()
for (const e of entregas) {
  if (!porPaciente.has(e.pid)) porPaciente.set(e.pid, [])
  porPaciente.get(e.pid).push(e.observacion)
}

const nuevos = []
let sinNada = 0, tope = 0
for (const [pid, textos] of porPaciente) {
  const suyas = tengo.get(pid) || new Set()
  let piezas = F.piezasTratamiento(textos).filter(x => !suyas.has(clave(x)))
  /* Un renglón de más de 120 letras no es un medicamento: es una frase
     que no se pudo partir. Se deja fuera y se cuenta, no se esconde. */
  piezas = piezas.filter(x => x.length <= 120)
  if (piezas.length > 40) { tope++; piezas = piezas.slice(0, 40) }
  if (!piezas.length) { sinNada++; continue }
  for (const p of piezas) nuevos.push([pid, p])
}

const personas = new Set(nuevos.map(x => x[0])).size
console.log('Entregas con texto del cuaderno   ' + entregas.length.toLocaleString('es-VE'))
console.log('Personas con algo que decir       ' + porPaciente.size.toLocaleString('es-VE'))
console.log('  ya lo tenían todo anotado       ' + sinNada.toLocaleString('es-VE'))
console.log('  se les agregaría algo           ' + personas.toLocaleString('es-VE'))
console.log('Renglones a crear                 ' + nuevos.length.toLocaleString('es-VE'))
if (tope) console.log('  (' + tope + ' personas con más de 40: se toman los 40 primeros)')

const cuantos = {}
for (const [, p] of nuevos) cuantos[p] = (cuantos[p] || 0) + 1
const top = Object.entries(cuantos).sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('\nLo que más se repite:')
for (const [p, n] of top) console.log('  %s  %s', String(n).padStart(5), p)

if (!APLICAR) {
  console.log('\nNada se escribió. Para hacerlo:  node migracion/05_tratamiento_cuaderno.mjs --aplicar')
  process.exit(0)
}

/* ---- 4. escribirlo, de 500 en 500 ---- */
let hechos = 0
for (let i = 0; i < nuevos.length; i += 500) {
  const trozo = nuevos.slice(i, i + 500)
  const valores = trozo.map(([pid, p]) =>
    `('${pid}'::uuid, ${comilla(p)}, true, 'cuaderno')`).join(',\n    ')
  await sql(`insert into farmacia.tratamientos_paciente
      (paciente_id, texto_original, activo, origen)
    values
    ${valores};`)
  hechos += trozo.length
  process.stdout.write('\r  guardados ' + hechos.toLocaleString('es-VE') + ' de ' +
                       nuevos.length.toLocaleString('es-VE'))
}
console.log('')

/* ---- 5. comprobar de verdad, leyendo otra vez ---- */
const fin = (await sql(`select
    count(*) filter (where origen = 'cuaderno')  del_cuaderno,
    count(*) filter (where origen = 'migracion') de_los_excel,
    count(*) filter (where origen = 'sistema')   escritos_aqui,
    count(distinct paciente_id)                  personas
  from farmacia.tratamientos_paciente where activo;`))[0]

console.log('\nEn la base, ahora:')
console.log('  renglones del cuaderno          ' + Number(fin.del_cuaderno).toLocaleString('es-VE'))
console.log('  renglones de los Excel          ' + Number(fin.de_los_excel).toLocaleString('es-VE'))
console.log('  escritos en el sistema          ' + Number(fin.escritos_aqui).toLocaleString('es-VE'))
console.log('  personas con tratamiento        ' + Number(fin.personas).toLocaleString('es-VE'))
console.log('\nSe deshace entero con:')
console.log("  delete from farmacia.tratamientos_paciente where origen = 'cuaderno';")

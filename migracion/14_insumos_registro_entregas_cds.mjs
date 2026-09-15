/* INSUMOS: CARGAR UNA SOLA VEZ LA HOJA "REGISTRO DE ENTREGAS C.D.S".

   De cada renglón del Excel se guarda: Fecha, Centro de Salud / Destino,
   Departamento / Servicio, Recibido Por (Responsable), la celda
   "Descripción del Insumo" tal cual, y cada insumo en su propio renglón
   (separados por "/" con farmacia.piezasInsumos, la misma función de la
   pantalla y de las pruebas).

   La cantidad: el Excel anota UNA sola "Cantidad Entregada" para todos
   los insumos de su renglón. Se guarda como total de la entrega y los
   insumos quedan sin cantidad propia: repartirla sería inventar números.

   Lo dudoso de la separación queda marcado "revisar", con el motivo.

   Cada fila entra una sola vez (índice único por fila del Excel). Se
   deshace entero con:
       delete from farmacia.insumos_entregas_cds where origen = 'excel';

       export SUPABASE_TOKEN=sbp_...
       node migracion/14_insumos_registro_entregas_cds.mjs             (solo mira)
       node migracion/14_insumos_registro_entregas_cds.mjs --aplicar   (escribe)
*/
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')

const REF = process.env.SUPABASE_REF || 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }
const APLICAR = process.argv.includes('--aplicar')
const EXCEL = process.env.EXCEL_INSUMOS ||
  'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/' +
  '84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/insumos_cdi.xlsx'

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(t.slice(0, 800))
  try { return JSON.parse(t) } catch { return [] }
}
const lit = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'"
const limpio = (v) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t || null }

/* Excel guarda las fechas como número de días desde 1899-12-30. Se
   convierte en UTC para que la zona horaria de la PC no mueva el día. */
function fechaDeExcel(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10)
  }
  return F.leeFecha(v)
}

export function leerHoja(ruta) {
  const XLSX = require('xlsx')
  const libro = XLSX.readFile(ruta)
  const nombre = libro.SheetNames.find(h => /REGISTRO DE ENTREGAS/i.test(h))
  if (!nombre) throw new Error('No está la hoja REGISTRO DE ENTREGAS C.D.S')
  const rejilla = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: null, raw: true })
  const iEnc = rejilla.findIndex(f => f && f.some(c => /^fecha$/i.test(String(c || '').trim())))
  if (iEnc < 0) throw new Error('No se encontró la fila de encabezados')
  const enc = rejilla[iEnc].map(c => F.sinAcentos(c || ''))
  const col = (re) => enc.findIndex(c => re.test(c))
  const C = {
    fecha: col(/^fecha$/), destino: col(/centro de salud|destino/), departamento: col(/departamento|servicio/),
    insumo: col(/descripcion del insumo/), cantidad: col(/cantidad/), recibe: col(/recibido/)
  }
  if (Object.values(C).some(x => x < 0)) throw new Error('Faltan columnas: ' + JSON.stringify(C))

  const filas = []
  for (let i = iEnc + 1; i < rejilla.length; i++) {
    const f = rejilla[i] || []
    const fecha = fechaDeExcel(f[C.fecha])
    const destino = limpio(f[C.destino]), insumos = limpio(f[C.insumo])
    // La fila de totales del final (sin fecha, sin destino, sin insumos) no es una entrega.
    if (!fecha && !destino && !insumos) continue
    const cantidad = f[C.cantidad] == null || f[C.cantidad] === '' ? null : Number(String(f[C.cantidad]).replace(/,/g, ''))
    filas.push({
      fila: i + 1, fecha, fechaCruda: f[C.fecha], destino, departamento: limpio(f[C.departamento]),
      recibido_por: limpio(f[C.recibe]), texto: insumos,
      cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : null,
      cantidadCruda: f[C.cantidad],
      items: insumos ? F.piezasInsumos(insumos) : []
    })
  }
  const totalExcel = rejilla.slice(iEnc + 1).map(f => f || [])
    .filter(f => !fechaDeExcel(f[C.fecha]) && !limpio(f[C.destino]) && typeof f[C.cantidad] === 'number')
    .map(f => f[C.cantidad])[0] ?? null
  return { filas, totalExcel }
}

if (process.argv[1] && process.argv[1].endsWith('14_insumos_registro_entregas_cds.mjs')) {
  console.log('='.repeat(70))
  console.log('INSUMOS: REGISTRO DE ENTREGAS C.D.S (carga única del Excel)')
  console.log('='.repeat(70))
  console.log(APLICAR ? 'MODO: se va a ESCRIBIR en la base.\n' : 'MODO: solo mirar. Nada se escribe. Usa --aplicar para hacerlo.\n')

  const { filas, totalExcel } = leerHoja(EXCEL)
  const malas = filas.filter(f => !f.fecha || (f.cantidadCruda != null && f.cantidadCruda !== '' && f.cantidad == null))
  const suma = filas.reduce((a, f) => a + (f.cantidad || 0), 0)
  const items = filas.reduce((a, f) => a + f.items.length, 0)
  const revisar = filas.flatMap(f => f.items.filter(x => x.revisar).map(x => ({ fila: f.fila, ...x })))

  console.log('Entregas (renglones con datos)   ' + filas.length)
  console.log('Insumos separados                ' + items)
  console.log('Suma de "Cantidad Entregada"     ' + suma + '   (el Excel dice en su total: ' + totalExcel + ')')
  console.log('Sin destino                      ' + filas.filter(f => !f.destino).map(f => 'fila ' + f.fila).join(', '))
  console.log('Sin insumos                      ' + filas.filter(f => !f.texto).map(f => 'fila ' + f.fila).join(', '))
  console.log('Sin quien recibe                 ' + filas.filter(f => !f.recibido_por).length)
  console.log('Insumos marcados para revisar    ' + revisar.length)
  revisar.forEach(x => console.log('   fila ' + String(x.fila).padStart(2) + '  ' + x.texto.padEnd(32) + ' ' + x.motivo))
  if (malas.length) {
    console.log('\nFilas con fecha o cantidad que no se pudo leer (NO se carga nada):')
    malas.forEach(f => console.log('   fila ' + f.fila + ': fecha=' + f.fechaCruda + ' cantidad=' + f.cantidadCruda))
    process.exit(1)
  }
  if (totalExcel != null && Math.abs(suma - totalExcel) > 0.001) {
    console.log('\nLa suma no cuadra con el total del propio Excel. NO se carga nada.'); process.exit(1)
  }
  if (process.argv.includes('--detalle')) {
    for (const f of filas) {
      console.log(`\nfila ${f.fila} · ${f.fecha} · ${f.destino || '(sin destino)'} · total ${f.cantidad ?? '—'}`)
      f.items.forEach((x, k) => console.log(`   ${String(k + 1).padStart(2)}. ${x.texto}${x.revisar ? '   ⚠ ' + x.motivo : ''}`))
    }
  }

  if (!APLICAR) {
    console.log('\nNada se escribió. Para hacerlo:  node migracion/14_insumos_registro_entregas_cds.mjs --aplicar')
  } else {
    const ya = await sql(`select count(*) n from farmacia.insumos_entregas_cds where origen = 'excel';`)
    if (Number(ya[0]?.n) > 0) {
      console.log('\nYa hay ' + ya[0].n + ' entregas cargadas del Excel. Para no duplicar, no se hace nada.')
      console.log("Si de verdad hay que repetirla:  delete from farmacia.insumos_entregas_cds where origen = 'excel';")
      process.exit(1)
    }
    const clave = (v) => `regexp_replace(farmacia.sin_acentos(upper(${v})), '[\\s.\\-_]', '', 'g')`
    const partes = ['begin;']
    for (const f of filas) {
      const id = randomUUID()
      partes.push(`insert into farmacia.insumos_entregas_cds
        (id, fecha, destino, institucion_id, departamento, recibido_por, cantidad_total_excel, texto_original, origen, fila_excel)
        values (${lit(id)}, ${lit(f.fecha)}, ${lit(f.destino)},
          ${f.destino ? `(select i.id from farmacia.instituciones i where ${clave('i.nombre')} = ${clave(lit(f.destino))} limit 1)` : 'null'},
          ${lit(f.departamento)}, ${lit(f.recibido_por)}, ${f.cantidad ?? 'null'}, ${lit(f.texto)}, 'excel', ${f.fila});`)
      if (f.items.length) {
        partes.push(`insert into farmacia.insumos_entregas_cds_items (entrega_id, orden, descripcion, cantidad, revisar, revisar_motivo) values ` +
          f.items.map((x, k) => `(${lit(id)}, ${k + 1}, ${lit(x.texto)}, null, ${x.revisar}, ${lit(x.motivo)})`).join(', ') + ';')
      }
    }
    partes.push('commit;')
    await sql(partes.join('\n'))

    const fin = await sql(`select count(*) entregas, sum(cantidad_total_excel) suma,
        (select count(*) from farmacia.insumos_entregas_cds_items it join farmacia.insumos_entregas_cds e on e.id = it.entrega_id where e.origen = 'excel') insumos,
        (select count(*) from farmacia.insumos_entregas_cds_items it join farmacia.insumos_entregas_cds e on e.id = it.entrega_id where e.origen = 'excel' and it.revisar) revisar
      from farmacia.insumos_entregas_cds where origen = 'excel';`)
    console.log('\nQuedó en la base: ' + JSON.stringify(fin[0]))
    const ok = Number(fin[0].entregas) === filas.length && Number(fin[0].insumos) === items &&
               Math.abs(Number(fin[0].suma) - suma) < 0.001 && Number(fin[0].revisar) === revisar.length
    console.log(ok ? 'Comprobado: coincide con el Excel.' : '¡NO COINCIDE con el Excel! Revisar.')
    if (!ok) process.exit(1)
  }
}

/* INSUMOS: CARGAR UNA SOLA VEZ LA HOJA "CONTROL DE INSUMOS ENTREGADOS".

   De cada renglón del Excel se guarda: FECHA, NOMBRE Y APELLIDO (solo
   en la base: es un dato personal), la celda de insumos tal cual,
   cada insumo en su propio renglón (separados por "/" con
   F.piezasInsumos), Categoría / Tipo, Total Entregado (sin repartir),
   Última Entrega, Estado Inventario y OBSERVACION.

   El Total Entregado del Excel NO trae cantidad por insumo: se guarda
   aparte y los insumos quedan con cantidad en blanco.

   Fechas raras ("31/01/0202", "3 TRIMESTRE"): NO se inventan. Se
   guarda el texto original y el registro queda marcado para revisar.

   Filas que no son una entrega (totales, subtítulos de trimestre,
   números sueltos) se saltan y se anotan en el resumen.

   En modo "solo mirar" NO hace falta token: solo lee el Excel.
   Para escribir en la base sí:

        export SUPABASE_TOKEN=sbp_...
        node migracion/15_insumos_control_entregas.mjs             (solo mira)
        node migracion/15_insumos_control_entregas.mjs --aplicar   (escribe)

   Se deshace entero con:
        delete from farmacia.insumos_control_entregas where origen = 'excel';
*/
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')

const REF = process.env.SUPABASE_REF || 'tfbzghjjfcaqmkzsxrrs'
const APLICAR = process.argv.includes('--aplicar')
const EXCEL = process.env.EXCEL_INSUMOS ||
  'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/' +
  '84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/insumos_cdi.xlsx'

const TOKEN = process.env.SUPABASE_TOKEN
if (APLICAR && !TOKEN) {
  console.error('Para --aplicar hace falta SUPABASE_TOKEN.')
  process.exit(2)
}

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

/* Excel guarda las fechas como número de días desde 1899-12-30. */
function fechaDeExcel(v) {
  if (v == null || v === '') return { fecha: null, texto: null, ok: false, vacio: true }
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getUTCFullYear(), m = v.getUTCMonth() + 1, d = v.getUTCDate()
    const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    return { fecha: iso, texto: iso, ok: true, vacio: false }
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Número de serie de Excel razonable → fecha.
    if (v > 20000 && v < 80000) {
      const iso = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10)
      return { fecha: iso, texto: iso, ok: true, vacio: false }
    }
    // Un número suelto en la celda FECHA no es una fecha.
    return { fecha: null, texto: String(v), ok: false, vacio: false, motivo: 'La FECHA no es una fecha' }
  }
  const texto = limpio(v)
  if (!texto) return { fecha: null, texto: null, ok: false, vacio: true }
  const leida = F.leeFecha(texto)
  if (leida) return { fecha: leida, texto, ok: true, vacio: false }
  return { fecha: null, texto, ok: false, vacio: false, motivo: 'La FECHA no se pudo leer como fecha' }
}

function esFilaDeTotales(f, C) {
  const persona = limpio(f[C.persona]) || ''
  const cat = limpio(f[C.categoria]) || ''
  const desc = limpio(f[C.insumo])
  const fecha = f[C.fecha]
  const total = f[C.total]
  const marca = (persona + ' ' + cat).toUpperCase()
  if (/\bTOTAL\b/.test(marca) && !desc) return 'Fila de totales (no es una entrega)'
  if (/TRIMESTRE/i.test(String(fecha == null ? '' : fecha)) && !persona && !desc)
    return 'Subtítulo de trimestre (no es una entrega)'
  // Número suelto en FECHA, sin persona ni insumos: basura del Excel.
  if (typeof fecha === 'number' && !persona && !desc) return 'Número suelto en FECHA (no es una entrega)'
  // Solo un total en la columna Total y nada más.
  if (!persona && !desc && fecha == null && total != null) return 'Celda de total suelta (no es una entrega)'
  return null
}

export function leerHoja(ruta) {
  const XLSX = require('xlsx')
  if (!fs.existsSync(ruta)) throw new Error('No está el Excel: ' + ruta)
  const libro = XLSX.readFile(ruta)
  const nombre = libro.SheetNames.find(h => /CONTROL DE INSUMOS/i.test(h))
  if (!nombre) throw new Error('No está la hoja CONTROL DE INSUMOS ENTREGADOS')
  const rejilla = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: null, raw: true })
  const iEnc = rejilla.findIndex(f => f && f.some(c => /^fecha$/i.test(String(c == null ? '' : c).trim())))
  if (iEnc < 0) throw new Error('No se encontró la fila de encabezados')
  const enc = rejilla[iEnc].map(c => F.sinAcentos(c || ''))
  const col = (re) => enc.findIndex(c => re.test(c))
  const C = {
    fecha: col(/^fecha$/),
    persona: col(/nombre y apellido/),
    insumo: col(/descripcion del insumo/),
    categoria: col(/categoria|tipo/),
    total: col(/^total entregado/),
    ultima: col(/ultima entrega/),
    estado: col(/estado inventario/),
    observacion: col(/^observacion/)
  }
  if (Object.values(C).some(x => x < 0)) throw new Error('Faltan columnas: ' + JSON.stringify(C))

  const filas = []
  const saltadas = []
  for (let i = iEnc + 1; i < rejilla.length; i++) {
    const f = rejilla[i] || []
    const persona = limpio(f[C.persona])
    const desc = limpio(f[C.insumo])
    const cat = limpio(f[C.categoria])
    const total = f[C.total]
    const estado = limpio(f[C.estado])
    const obs = limpio(f[C.observacion])
    const fechaCell = f[C.fecha]
    const ultimaCell = f[C.ultima]
    const vacio = fechaCell == null && !persona && !desc && total == null && !cat && !estado && !obs
    if (vacio) continue

    const motivoSkip = esFilaDeTotales(f, C)
    if (motivoSkip) {
      saltadas.push({ fila: i + 1, motivo: motivoSkip })
      continue
    }

    const fr = fechaDeExcel(fechaCell)
    const ul = fechaDeExcel(ultimaCell)
    const totalN = total == null || total === '' ? null : Number(String(total).replace(/,/g, ''))
    const marcasEntrega = []
    if (!fr.vacio && !fr.ok) marcasEntrega.push(fr.motivo || 'La FECHA no se pudo leer')
    if (!persona) marcasEntrega.push('Falta el NOMBRE Y APELLIDO')
    if (!desc) marcasEntrega.push('Falta la Descripción del Insumo')
    if (ul.vacio === false && !ul.ok && ul.motivo) marcasEntrega.push('La ÚLTIMA ENTREGA no se pudo leer')
    // Un Total escrito como texto no se pierde en silencio: se marca (el texto queda en la observación del resumen).
    if (total != null && String(total).trim() !== '' && !(Number.isFinite(totalN) && totalN > 0))
      marcasEntrega.push('El TOTAL ENTREGADO no es un número: «' + String(total).trim().slice(0, 40) + '»')

    filas.push({
      fila: i + 1,
      fecha: fr.fecha,
      fechaTexto: fr.texto,
      persona,                       // NO se imprime: dato personal
      tienePersona: !!persona,
      categoria: cat,
      total: Number.isFinite(totalN) && totalN > 0 ? totalN : null,
      totalCrudo: total,
      ultima: ul.fecha,
      ultimaTexto: ul.texto,
      estado,
      observacion: obs,
      texto: desc,
      items: desc ? F.piezasInsumos(desc) : [],
      revisar: marcasEntrega.length > 0,
      revisarMotivo: marcasEntrega.length ? marcasEntrega.join(' · ') : null
    })
  }
  return { filas, saltadas, hoja: nombre }
}

/* ---------------------------------------------------------------
   Trimestres (lo usan las pruebas y la pantalla).
--------------------------------------------------------------- */
export function trimestreDe(iso) {
  if (!iso) return null
  const p = String(iso).slice(0, 10).split('-')
  if (p.length !== 3) return null
  const anio = +p[0], mes = +p[1]
  if (!anio || mes < 1 || mes > 12) return null
  let nombre, inicioMes, finMes
  if (mes <= 3) { nombre = 'ENERO A MARZO'; inicioMes = 1; finMes = 3 }
  else if (mes <= 6) { nombre = 'ABRIL A JUNIO'; inicioMes = 4; finMes = 6 }
  else if (mes <= 9) { nombre = 'JULIO A SEPTIEMBRE'; inicioMes = 7; finMes = 9 }
  else { nombre = 'OCTUBRE A DICIEMBRE'; inicioMes = 10; finMes = 12 }
  const dos = (n) => String(n).padStart(2, '0')
  return {
    clave: anio + '-T' + Math.ceil(mes / 3),
    nombre: nombre + ' ' + anio,
    anio,
    inicio: anio + '-' + dos(inicioMes) + '-01',
    fin: anio + '-' + dos(finMes) + '-' + dos(new Date(Date.UTC(anio, finMes, 0)).getUTCDate())
  }
}

if (process.argv[1] && process.argv[1].endsWith('15_insumos_control_entregas.mjs')) {
  console.log('='.repeat(70))
  console.log('INSUMOS: CONTROL DE INSUMOS ENTREGADOS (carga única del Excel)')
  console.log('='.repeat(70))
  console.log(APLICAR ? 'MODO: se va a ESCRIBIR en la base.\n' : 'MODO: solo mirar. Nada se escribe. Usa --aplicar para escribir.\n')

  const { filas, saltadas, hoja } = leerHoja(EXCEL)
  const items = filas.reduce((a, f) => a + f.items.length, 0)
  const suma = filas.reduce((a, f) => a + (f.total || 0), 0)
  const conCant = filas.filter(f => f.items.some(x => x.cantidad != null)).length
  const revisarItems = filas.flatMap(f => f.items.filter(x => x.revisar).map(x => ({ fila: f.fila, texto: x.texto, motivo: x.motivo })))
  const revisarEntregas = filas.filter(f => f.revisar)
  const fechasRaras = filas.filter(f => f.fechaTexto && !f.fecha).map(f => ({ fila: f.fila, texto: f.fechaTexto }))
  const sinFecha = filas.filter(f => !f.fecha && !f.fechaTexto).length
  const ultimasRaras = filas.filter(f => f.ultimaTexto && !f.ultima).map(f => ({ fila: f.fila, texto: f.ultimaTexto }))

  console.log('Hoja                              ' + JSON.stringify(hoja))
  console.log('Registros (entregas)              ' + filas.length)
  console.log('Insumos separados                 ' + items)
  console.log('Con cantidad por insumo           ' + conCant + '   (el Excel no trae cantidades por insumo)')
  console.log('Suma de "Total Entregado"         ' + suma)
  console.log('Filas saltadas (no son entrega)   ' + saltadas.length)
  saltadas.forEach(s => console.log('   fila ' + String(s.fila).padStart(3) + '  ' + s.motivo))
  console.log('Registros por revisar (entrega)   ' + revisarEntregas.length)
  revisarEntregas.forEach(f => console.log('   fila ' + String(f.fila).padStart(3) + '  ' + (f.revisarMotivo || '')))
  console.log('Insumos marcados para revisar     ' + revisarItems.length)
  revisarItems.slice(0, 40).forEach(x => console.log('   fila ' + String(x.fila).padStart(3) + '  ' + String(x.texto).padEnd(36) + ' ' + x.motivo))
  if (revisarItems.length > 40) console.log('   … y ' + (revisarItems.length - 40) + ' más')
  console.log('Fechas raras (texto original)     ' + fechasRaras.length)
  fechasRaras.forEach(x => console.log('   fila ' + String(x.fila).padStart(3) + '  ' + x.texto))
  console.log('Sin fecha ni texto de fecha       ' + sinFecha)
  console.log('Última entrega no legible         ' + ultimasRaras.length)
  ultimasRaras.forEach(x => console.log('   fila ' + String(x.fila).padStart(3) + '  ' + x.texto))

  if (process.argv.includes('--detalle')) {
    for (const f of filas) {
      // OJO: no se imprime el nombre de la persona (dato personal).
      console.log(`\nfila ${f.fila} · fecha=${f.fecha || f.fechaTexto || '(sin fecha)'} · cat=${f.categoria || '—'} · total=${f.total ?? '—'}` +
        (f.revisar ? ' · REVISAR: ' + f.revisarMotivo : ''))
      f.items.forEach((x, k) => console.log(`   ${String(k + 1).padStart(2)}. ${x.texto}${x.revisar ? '   ⚠ ' + x.motivo : ''}`))
    }
  }

  if (!APLICAR) {
    console.log('\nNada se escribió (modo solo mirar).')
    console.log('Para escribir:  export SUPABASE_TOKEN=sbp_... && node migracion/15_insumos_control_entregas.mjs --aplicar')
  } else {
    const ya = await sql(`select count(*) n from farmacia.insumos_control_entregas where origen = 'excel';`)
    if (Number(ya[0]?.n) > 0) {
      console.log('\nYa hay ' + ya[0].n + ' registros cargados del Excel. Para no duplicar, no se hace nada.')
      console.log("Si de verdad hay que repetirla:  delete from farmacia.insumos_control_entregas where origen = 'excel';")
      process.exit(1)
    }
    const partes = ['begin;']
    for (const f of filas) {
      const id = randomUUID()
      partes.push(`insert into farmacia.insumos_control_entregas
        (id, fecha, fecha_texto, persona, categoria, total_entregado_excel,
         ultima_entrega, ultima_entrega_texto, estado_inventario, observacion,
         texto_original, origen, fila_excel, revisar, revisar_motivo)
        values (${lit(id)}, ${f.fecha ? lit(f.fecha) : 'null'}, ${lit(f.fechaTexto)},
          ${lit(f.persona)}, ${lit(f.categoria)}, ${f.total ?? 'null'},
          ${f.ultima ? lit(f.ultima) : 'null'}, ${lit(f.ultimaTexto)},
          ${lit(f.estado)}, ${lit(f.observacion)},
          ${lit(f.texto)}, 'excel', ${f.fila},
          ${f.revisar}, ${lit(f.revisarMotivo)});`)
      if (f.items.length) {
        partes.push(`insert into farmacia.insumos_control_entregas_items
          (entrega_id, orden, descripcion, cantidad, revisar, revisar_motivo) values ` +
          f.items.map((x, k) => `(${lit(id)}, ${k + 1}, ${lit(x.texto)}, null, ${x.revisar}, ${lit(x.motivo)})`).join(', ') + ';')
      }
    }
    partes.push('commit;')
    await sql(partes.join('\n'))

    const fin = await sql(`select count(*) entregas, sum(total_entregado_excel) suma,
        (select count(*) from farmacia.insumos_control_entregas_items it
           join farmacia.insumos_control_entregas e on e.id = it.entrega_id
          where e.origen = 'excel') insumos,
        (select count(*) from farmacia.insumos_control_entregas_items it
           join farmacia.insumos_control_entregas e on e.id = it.entrega_id
          where e.origen = 'excel' and it.revisar) revisar,
        (select count(*) from farmacia.insumos_control_entregas
          where origen = 'excel' and revisar) revisar_entregas
      from farmacia.insumos_control_entregas where origen = 'excel';`)
    console.log('\nQuedó en la base: ' + JSON.stringify(fin[0]))
    const ok = Number(fin[0].entregas) === filas.length &&
               Number(fin[0].insumos) === items &&
               Math.abs(Number(fin[0].suma || 0) - suma) < 0.001 &&
               Number(fin[0].revisar) === revisarItems.length &&
               Number(fin[0].revisar_entregas) === revisarEntregas.length
    console.log(ok ? 'Comprobado: coincide con el Excel.' : '¡NO COINCIDE con el Excel! Revisar.')
    if (!ok) process.exit(1)
  }
}

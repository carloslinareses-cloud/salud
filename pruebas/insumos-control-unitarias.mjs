/* CONTROL DE INSUMOS ENTREGADOS: LA LÓGICA, SIN NAVEGADOR NI BASE.

   Usa los archivos REALES (comunes.js, insumos.js y la migración 15):
     · separar la celda de insumos por "/" sin romper "JERINGA#20";
     · el Total Entregado NO se reparte entre los insumos;
     · fechas raras: texto original + marca de revisión, sin inventar;
     · trimestres y balance;
     · filas del Excel/PDF cuadradas.

   Sin nombres de personas reales en este archivo.

       node pruebas/insumos-control-unitarias.mjs
*/
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')
globalThis.FARM = F
const L = require('../insumos.js')
const { leerHoja, trimestreDe } = await import('../migracion/15_insumos_control_entregas.mjs')

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) } else { mal++; fallos.push(n); console.log('  FALLA ' + n + '   ' + d) }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const textos = (s) => F.piezasInsumos(s).map(x => x.texto)

console.log('\n--- Separar insumos de la hoja control ---')
{
  const r = textos('K-50/EQUIPO DE INFUCION/JERINGA#20/JELCO#22/JERINGA#10/RANITIDINA AMPOLLA/ONDASETRON 8MG/SOL 0.9')
  prueba('el ejemplo del usuario sale en 8 insumos, cada uno completo',
    igual(r, ['K-50', 'EQUIPO DE INFUCION', 'JERINGA#20', 'JELCO#22', 'JERINGA#10',
              'RANITIDINA AMPOLLA', 'ONDASETRON 8MG', 'SOL 0.9']), JSON.stringify(r))
  prueba('"JERINGA#20" y "JELCO#22" quedan tal cual (el # es el tamaño)',
    r.includes('JERINGA#20') && r.includes('JELCO#22'))
  prueba('"K-50" queda completo (no se parte por el guion)', r[0] === 'K-50')
  prueba('no se corrige la ortografía ("INFUCION" queda como vino)', r[1] === 'EQUIPO DE INFUCION')
  const g = textos('GUANTES#7.5/GUANTES#8/SUTURA #3-0/SUTURA#2-0')
  prueba('tallas y suturas con #', igual(g, ['GUANTES#7.5', 'GUANTES#8', 'SUTURA #3-0', 'SUTURA#2-0']), JSON.stringify(g))
}

console.log('\n--- El formulario de control ---')
{
  const base = {
    fecha: '2026-09-10', persona: '  PERSONA  DE  PRUEBA  ', categoria: ' INSUMO PREOPERATORIO ',
    observacion: ' nota ', estado_inventario: ' ENTREGADO ', ultima_entrega: '2026-09-10',
    items: [{ descripcion: 'JERINGA#20', cantidad: '5' }, { descripcion: 'JELCO#22', cantidad: '3' }, { descripcion: '', cantidad: '' }]
  }
  const r = L.revisaFormularioControl(base, '2026-09-15', true)
  prueba('bien lleno: pasa y limpia espacios', !r.error && r.datos.persona === 'PERSONA DE PRUEBA', JSON.stringify(r))
  prueba('cada insumo con SU cantidad', r.datos && igual(r.datos.items.map(x => [x.descripcion, x.cantidad]),
    [['JERINGA#20', 5], ['JELCO#22', 3]]))
  prueba('la suma de cantidades es el Total Entregado calculado', L.sumaCantidades(r.datos.items) === 8)
  prueba('sin persona: no pasa', /nombre y apellido/.test(
    L.revisaFormularioControl({ ...base, persona: '' }, '2026-09-15', true).error || ''))
  prueba('sin fecha: no pasa', /Falta la fecha/.test(
    L.revisaFormularioControl({ ...base, fecha: '' }, '2026-09-15', true).error || ''))
  prueba('fecha futura: no pasa', /futura/.test(
    L.revisaFormularioControl({ ...base, fecha: '2026-09-16' }, '2026-09-15', true).error || ''))
  const excel = L.revisaFormularioControl({
    fecha: '', persona: '', categoria: 'X', items: [{ descripcion: 'ALGODON', cantidad: '' }]
  }, '2026-09-15', false)
  prueba('al corregir algo del Excel, la cantidad puede quedar vacía', !excel.error && excel.datos.items[0].cantidad === null, JSON.stringify(excel))
  prueba('al corregir algo del Excel, puede quedar sin fecha (no se inventa)', !excel.error && !excel.datos.fecha)
  const sinCant = L.revisaFormularioControl({
    ...base, items: [{ descripcion: 'ALGODON', cantidad: '' }]
  }, '2026-09-15', true)
  prueba('un insumo sin cantidad en manual: no pasa', /Falta la cantidad de ALGODON/.test(sinCant.error || ''))
}

console.log('\n--- Trimestres ---')
{
  const t = trimestreDe('2026-01-15')
  prueba('15/01 → ENERO A MARZO 2026', t.nombre === 'ENERO A MARZO 2026' && t.inicio === '2026-01-01' && t.fin === '2026-03-31')
  prueba('01/04 → ABRIL A JUNIO', trimestreDe('2026-04-01').nombre === 'ABRIL A JUNIO 2026')
  prueba('30/06 → ABRIL A JUNIO', trimestreDe('2026-06-30').nombre === 'ABRIL A JUNIO 2026')
  prueba('01/07 → JULIO A SEPTIEMBRE', trimestreDe('2026-07-01').nombre === 'JULIO A SEPTIEMBRE 2026')
  prueba('28/08 → JULIO A SEPTIEMBRE', trimestreDe('2026-08-28').nombre === 'JULIO A SEPTIEMBRE 2026')
  prueba('01/10 → OCTUBRE A DICIEMBRE', trimestreDe('2026-10-01').nombre === 'OCTUBRE A DICIEMBRE 2026')
  prueba('31/12 → OCTUBRE A DICIEMBRE, fin 31/12', trimestreDe('2026-12-31').fin === '2026-12-31')
  prueba('sin fecha: null', trimestreDe(null) === null && trimestreDe('') === null)

  const entregas = [
    { fecha: '2026-01-15', suma_cantidades: 10, total_entregado_excel: 50, por_revisar: 0, revisar: false, insumos: 2, categoria: 'A',
      items: [{ descripcion: 'JERINGA#20' }, { descripcion: 'JELCO#22' }] },
    { fecha: '2026-02-10', suma_cantidades: null, total_entregado_excel: 30, por_revisar: 1, revisar: false, insumos: 3, categoria: 'A',
      items: [{ descripcion: 'JERINGA#20' }, { descripcion: 'SOL 0.9' }] },
    { fecha: '2026-07-01', suma_cantidades: 5, total_entregado_excel: null, por_revisar: 0, revisar: true, insumos: 1, categoria: 'B',
      items: [{ descripcion: 'ALGODON' }] }
  ]
  const bal = L.armaBalance(entregas, 'control')
  prueba('dos trimestres con datos', bal.trimestres.length === 2, JSON.stringify(bal.trimestres.map(t => t.clave)))
  prueba('ene-mar: 2 entregas, 10 unidades con cantidad, 80 del Excel',
    bal.trimestres[0].entregas === 2 && bal.trimestres[0].unidadesConCantidad === 10 && bal.trimestres[0].totalesExcel === 80)
  prueba('jul-sep: 1 entrega, 5 unidades, 0 del Excel, 1 por revisar',
    bal.trimestres[1].entregas === 1 && bal.trimestres[1].unidadesConCantidad === 5 &&
    bal.trimestres[1].totalesExcel === 0 && bal.trimestres[1].porRevisar === 1)
  const filas = L.filasBalance(bal, 'control')
  prueba('filas de balance cuadradas con los encabezados', filas.every(f => f.length === L.ENCABEZADOS_BALANCE.length))
  prueba('los nombres de trimestre son los fijos', filas[0][0] === 'ENERO A MARZO 2026' && filas[1][0] === 'JULIO A SEPTIEMBRE 2026')
}

console.log('\n--- Excel y PDF del control ---')
{
  const registros = [
    {
      fecha: '2026-01-15', fecha_texto: '15/01/2026', persona: 'PERSONA UNO', categoria: 'INSUMO PREOPERATORIO',
      total_entregado_excel: 58, ultima_entrega: '2026-01-15', ultima_entrega_texto: null,
      estado_inventario: 'ENTREGADO', observacion: null, origen: 'excel', revisar: false, revisar_motivo: null,
      items: [{ descripcion: 'JERINGA#20', cantidad: null }, { descripcion: 'JELCO#22', cantidad: null, revisar: true, revisar_motivo: 'prueba' }]
    },
    {
      fecha: null, fecha_texto: '31/01/0202', persona: 'PERSONA DOS', categoria: 'A',
      total_entregado_excel: 68, ultima_entrega: null, ultima_entrega_texto: '31/01/2026',
      estado_inventario: 'ENTREGADO', observacion: 'obs', origen: 'excel', revisar: true, revisar_motivo: 'La FECHA no se pudo leer',
      items: [{ descripcion: 'SUTURA #3-0', cantidad: null }]
    },
    {
      fecha: '2026-09-10', persona: 'PERSONA TRES', categoria: 'B',
      total_entregado_excel: null, origen: 'manual', revisar: false,
      items: [{ descripcion: 'ALGODON', cantidad: 7 }]
    }
  ]
  const filas = L.filasReporteControl(registros)
  prueba('una fila por insumo', filas.length === 4, filas.length)
  prueba('encabezados y filas del mismo ancho', filas.every(f => f.length === L.ENCABEZADOS_CONTROL.length))
  prueba('lo del Excel NO reparte la cantidad', filas[0][4] === '' && filas[1][4] === '')
  prueba('el Total Entregado del Excel sale una sola vez por registro', filas[0][5] === 58 && filas[1][5] === '')
  prueba('lo registrado aquí lleva la cantidad del insumo', filas[3][4] === 7)
  prueba('fecha legible o el texto original', filas[0][0] === '15/01/2026' && filas[2][0] === '31/01/0202')
  prueba('la marca de revisión del registro va en la observación', /Registro por revisar: La FECHA/.test(filas[2][8]))
  prueba('la marca de revisión del insumo va en la observación', /Por revisar: prueba/.test(filas[1][8]))
  prueba('los encabezados son los de la hoja control',
    L.ENCABEZADOS_CONTROL.slice(0, 5).join('|') === 'Fecha|Nombre y Apellido|Descripción del Insumo / Medicamento|Categoría / Tipo|Cantidad')
}

console.log('\n--- Ajustes pedidos por el usuario (balance) ---')
{
  const bal = L.armaBalance([
    { fecha: '2026-02-10', persona: 'ZZZ Uno', suma_cantidades: 5, items: [] },
    { fecha: '2026-02-11', persona: 'zzz  uno', items: [] },
    { fecha: '2026-02-12', persona: 'ZZZ Dos', items: [] },
    { fecha: null, persona: 'ZZZ Tres', total_entregado_excel: 7, items: [] }
  ], 'control')
  prueba('cuenta personas distintas por trimestre (la misma escrita distinto cuenta una)', bal.trimestres[0].personas === 2, JSON.stringify(bal.trimestres[0]))
  const filas = L.filasBalance(bal, 'control')
  prueba('lo que no tiene fecha válida va a «Sin fecha válida», no se pierde', filas[filas.length - 1][0] === 'Sin fecha válida' && bal.sinFecha.totalesExcel === 7)
  prueba('la columna «Personas distintas» está y todo cuadra', L.ENCABEZADOS_BALANCE.includes('Personas distintas') && filas.every(f => f.length === L.ENCABEZADOS_BALANCE.length))
  prueba('en la hoja 1 no se cuentan personas (celda vacía)', L.filasBalance(L.armaBalance([{ fecha: '2026-02-10', destino: 'ZZZ', items: [] }], 'registro'), 'registro')[0][2] === '')
}

const EXCEL = process.env.EXCEL_INSUMOS ||
  'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/insumos_cdi.xlsx'
if (fs.existsSync(EXCEL)) {
  console.log('\n--- La hoja real del Excel control ---')
  const { filas, saltadas } = leerHoja(EXCEL)
  const items = filas.reduce((a, f) => a + f.items.length, 0)
  const suma = filas.reduce((a, f) => a + (f.total || 0), 0)
  prueba('hay registros leídos (más de 150)', filas.length > 150, filas.length)
  prueba('hay insumos separados (más de 400)', items > 400, items)
  prueba('la suma del Total Entregado es positiva', suma > 0, suma)
  prueba('se saltaron las filas de totales/subtítulos (al menos 3)', saltadas.length >= 3, JSON.stringify(saltadas))
  prueba('ninguna fila saltada se cargó como entrega', saltadas.every(s => !filas.some(f => f.fila === s.fila)))
  prueba('las cantidades por insumo vienen vacías del Excel', filas.every(f => f.items.every(x => x.cantidad == null)))
  prueba('el ejemplo del usuario se separa bien en la fila 6', (() => {
    const f6 = filas.find(f => f.fila === 6)
    return f6 && f6.items.length === 8 && f6.items.some(x => x.texto === 'JERINGA#20') &&
           f6.items.some(x => x.texto === 'JELCO#22') && f6.items.some(x => x.texto === 'K-50')
  })())
  prueba('la fecha rara "31/01/0202" queda con texto y sin fecha legible', (() => {
    const f = filas.find(x => x.fila === 40)
    return f && f.fechaTexto === '31/01/0202' && !f.fecha && f.revisar
  })())
  prueba('no se inventa la fecha de la fila rara', filas.every(f => f.fecha || f.revisar))
} else {
  console.log('\n(No está la copia del Excel en esta PC: se saltan las pruebas contra la hoja real.)')
}

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}:\n  - ` + fallos.join('\n  - ') : `Pasaron las ${ok} pruebas de control de insumos.`))
process.exit(mal ? 1 : 0)

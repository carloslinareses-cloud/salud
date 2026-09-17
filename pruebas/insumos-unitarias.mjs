/* INSUMOS: LA LÓGICA, SIN NAVEGADOR NI BASE.

   Usa los archivos REALES (comunes.js e insumos.js), no copias:
     · separar la celda "Descripción del Insumo" por "/" sin romper
       "AIRON 60/400 MG" ni "SUTURA 5/0", y marcando lo dudoso;
     · revisar el formulario (cada insumo con su cantidad);
     · las filas del Excel/PDF: cuadradas y sin repartir la cantidad del Excel;
     · y la carga del Excel: 31 entregas, 265 insumos y el total de 7.091.

       node pruebas/insumos-unitarias.mjs
*/
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const F = require('../comunes.js')
globalThis.FARM = F
const L = require('../insumos.js')

let ok = 0, mal = 0
const fallos = []
const prueba = (n, c, d = '') => {
  if (c) { ok++; console.log('  OK    ' + n) } else { mal++; fallos.push(n); console.log('  FALLA ' + n + '   ' + d) }
}
const textos = (s) => F.piezasInsumos(s).map(x => x.texto)
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n--- Separar los insumos por "/" ---')
{
  const r = textos('ACETMINOFEN 500 MG / CAPTOPRIL 50 MG / SALBUTAMOL INHALADOR / ENALALPRIL 20 MG / LOSARTAN POTASICO 100 MG / AIRON 60/400 MG / MULTIVITAMNICO ')
  prueba('el ejemplo del usuario sale en 7 insumos, cada uno aparte', igual(r,
    ['ACETMINOFEN 500MG', 'CAPTOPRIL 50MG', 'SALBUTAMOL INHALADOR', 'ENALALPRIL 20MG', 'LOSARTAN POTASICO 100MG', 'AIRON 60/400MG', 'MULTIVITAMNICO']), JSON.stringify(r))
  prueba('"AIRON 60/400 MG" NO se parte (barra entre números)', r.includes('AIRON 60/400MG'))
  prueba('no se corrige la ortografía ("ACETMINOFEN" queda como vino)', r[0] === 'ACETMINOFEN 500MG')
  prueba('"SUTURA 5/0" y "GUANTES # 6/2" quedan enteros', igual(textos('SUTURA 5/0 / GUANTES # 6/2'), ['SUTURA 5/0', 'GUANTES # 6/2']))
  prueba('"0,5MG/ML" (barra entre unidades) queda entero', igual(textos('DESLORATADINA 0,5MG/ML SUSP / ADHESIVO'), ['DESLORATADINA 0,5MG/ML SUSP', 'ADHESIVO']))
  prueba('la coma NO separa ("10 MG , 2 ML AMPOLLA" es uno)', igual(textos('METOCLOPRAMIDA 10 MG , 2 ML AMPOLLA / OMEPRAZOL 40 MG'), ['METOCLOPRAMIDA 10MG, 2ML AMPOLLA', 'OMEPRAZOL 40MG']))
  prueba('sin espacios alrededor de la barra también separa', igual(textos('DEXAMETASONA 8MG/SOL 0.9/HIOSCINA 20MG'), ['DEXAMETASONA 8MG', 'SOL 0.9', 'HIOSCINA 20MG']))
  prueba('las barras de más al final no crean insumos vacíos', igual(textos('ALGODON / JERINGA # 5 /  / '), ['ALGODON', 'JERINGA # 5']))
  prueba('"1 %" queda "1%"', igual(textos('LIDOCAINA 1 %'), ['LIDOCAINA 1%']))
  prueba('un insumo repetido NO se borra (se respeta lo anotado)', igual(textos('JERINGA*5/JERINGA*5'), ['JERINGA*5', 'JERINGA*5']))
  prueba('vacío o nulo: ningún insumo', F.piezasInsumos('').length === 0 && F.piezasInsumos(null).length === 0)
}

console.log('\n--- Lo dudoso sale marcado, no adivinado ---')
{
  const marca = (s) => F.piezasInsumos(s).filter(x => x.revisar).map(x => x.texto + ' → ' + x.motivo)
  prueba('"*22" suelto: sin nombre, y se deja tal cual venía', igual(marca('PERICRANEAL*25/*22'), ['*22 → No trae el nombre de un insumo']), JSON.stringify(marca('PERICRANEAL*25/*22')))
  prueba('"PEDIATRICO" suelto: parece continuación del anterior', /PEDIATRICO → Parece la continuación/.test(marca('NEBULIZADOR ADULDO/PEDIATRICO').join()))
  prueba('"JERINGA*10GUANTES*7.5": dos insumos pegados', /JERINGA\*10GUANTES\*7\.5 → Parecen dos insumos pegados/.test(marca('JERINGA*10GUANTES*7.5').join()))
  prueba('"JELCO *24*22*20": varias medidas juntas', /JELCO \*24\*22\*20 → Trae varias medidas/.test(marca('JELCO *24*22*20').join()))
  prueba('lo normal NO sale marcado', marca('JERINGA*5/GUANTES*7.5/CATETER 22 G/SOL 0.9/ALGODON').length === 0, JSON.stringify(marca('JERINGA*5/GUANTES*7.5/CATETER 22 G/SOL 0.9/ALGODON')))
}

console.log('\n--- La cantidad ---')
{
  prueba('"30" es 30', L.leeCantidad('30').valor === 30)
  prueba('"1,5" es 1,5', L.leeCantidad('1,5').valor === 1.5)
  prueba('vacío es sin cantidad (no cero)', L.leeCantidad('').valor === null && !L.leeCantidad('').error)
  prueba('"2.339" se rechaza (¿puntos de miles?) en vez de leerse 2,339', /sin puntos de miles/.test(L.leeCantidad('2.339').error || ''))
  prueba('"0" se rechaza', /mayor que cero/.test(L.leeCantidad('0').error || ''))
  prueba('"diez" se rechaza', /número/.test(L.leeCantidad('diez').error || ''))
  prueba('"-5" se rechaza', !!L.leeCantidad('-5').error)
}

console.log('\n--- El formulario ---')
{
  const base = { fecha: '2026-09-10', destino: ' CDI  MAMA PANCHA ', recibido_por: 'Responsable de prueba',
    items: [{ descripcion: 'ACETAMINOFEN 500 MG', cantidad: '30' }, { descripcion: 'JERINGA # 5', cantidad: '100' }, { descripcion: '', cantidad: '' }] }
  const r = L.revisaFormulario(base, '2026-09-15', true)
  prueba('bien lleno: pasa, con los espacios limpios', !r.error && r.datos.destino === 'CDI MAMA PANCHA', JSON.stringify(r))
  prueba('cada insumo lleva SU cantidad', r.datos && igual(r.datos.items.map(x => [x.descripcion, x.cantidad]), [['ACETAMINOFEN 500MG', 30], ['JERINGA # 5', 100]]))
  prueba('el renglón vacío del final (el último "Agregar +") se ignora', r.datos && r.datos.items.length === 2)
  /* Lo que hace que la entrega salga del inventario: el renglón tiene que
     llevar consigo con qué producto quedó enlazado, y los renglones
     vacíos no pueden correr esa numeración. */
  const conEnlace = L.revisaFormulario({ ...base, items: [
    { descripcion: '', cantidad: '' },
    { descripcion: 'ALGODON', cantidad: '3', producto_id: 'aaaaaaaa-1111-2222-3333-444444444444' },
    { descripcion: 'GASA 5X5', cantidad: '2' }
  ] }, '2026-09-15', true)
  prueba('el renglon enlazado lleva su producto', conEnlace.datos.items[0].producto_id === 'aaaaaaaa-1111-2222-3333-444444444444', JSON.stringify(conEnlace.datos.items[0]))
  prueba('el que no se enlazo va sin producto (no descuenta)', conEnlace.datos.items[1].producto_id === null, JSON.stringify(conEnlace.datos.items[1]))
  prueba('los renglones vacios no corren la numeracion', conEnlace.datos.items.length === 2)

  const sinCant = L.revisaFormulario({ ...base, items: [{ descripcion: 'ALGODON', cantidad: '' }] }, '2026-09-15', true)
  prueba('un insumo sin cantidad: no pasa y dice cuál', /Falta la cantidad entregada de ALGODON/.test(sinCant.error || ''), JSON.stringify(sinCant))
  const sinDesc = L.revisaFormulario({ ...base, items: [{ descripcion: 'ALGODON', cantidad: '3' }, { descripcion: '', cantidad: '5' }] }, '2026-09-15', true)
  prueba('una cantidad sin insumo: no pasa', /insumo número 2 le falta la descripción/.test(sinDesc.error || ''), JSON.stringify(sinDesc))
  prueba('sin insumos: no pasa', /al menos un insumo/.test(L.revisaFormulario({ ...base, items: [{ descripcion: '', cantidad: '' }] }, '2026-09-15', true).error || ''))
  prueba('fecha futura: no pasa', /futura/.test(L.revisaFormulario({ ...base, fecha: '2026-09-16' }, '2026-09-15', true).error || ''))
  prueba('sin destino: no pasa', /centro de salud o destino/.test(L.revisaFormulario({ ...base, destino: '' }, '2026-09-15', true).error || ''))
  prueba('sin quien recibe: no pasa', /quién lo recibió/.test(L.revisaFormulario({ ...base, recibido_por: ' ' }, '2026-09-15', true).error || ''))
  const excel = L.revisaFormulario({ fecha: '2026-02-10', destino: '', recibido_por: '', items: [{ descripcion: 'ALGODON', cantidad: '' }] }, '2026-09-15', false)
  prueba('al corregir algo del Excel, la cantidad puede quedar vacía', !excel.error && excel.datos.items[0].cantidad === null, JSON.stringify(excel))
  prueba('la suma de cantidades', L.sumaCantidades([{ cantidad: '30' }, { cantidad: 12.5 }, { cantidad: '' }]) === 42.5)
  prueba('sin ninguna cantidad, la suma es "no hay" (no cero)', L.sumaCantidades([{ cantidad: '' }]) === null)
}

console.log('\n--- Excel y PDF ---')
{
  const entregas = [
    { fecha: '2026-01-15', destino: 'PRONTO SOCORRO', recibido_por: null, cantidad_total_excel: 630, origen: 'excel',
      items: [{ descripcion: 'ALGODON', cantidad: null }, { descripcion: '*22', cantidad: null, revisar: true, revisar_motivo: 'No trae el nombre de un insumo' }] },
    { fecha: '2026-09-10', destino: 'CDI', recibido_por: 'R', cantidad_total_excel: null, origen: 'manual',
      items: [{ descripcion: 'JERINGA', cantidad: 100 }] },
    { fecha: '2026-07-31', destino: 'CAMPAMENTO', recibido_por: null, cantidad_total_excel: null, origen: 'excel', items: [] }
  ]
  const filas = L.filasReporte(entregas)
  prueba('una fila por insumo (y una para la entrega sin insumos)', filas.length === 4, filas.length)
  prueba('encabezados y filas del mismo ancho (el Excel no se descuadra)', filas.every(f => f.length === L.ENCABEZADOS.length))
  prueba('lo del Excel NO reparte la cantidad: la celda del insumo va vacía', filas[0][3] === '' && filas[1][3] === '')
  prueba('la cantidad total del Excel sale una sola vez por entrega', filas[0][5] === 630 && filas[1][5] === '')
  prueba('lo registrado aquí lleva la cantidad del insumo', filas[2][3] === 100)
  prueba('fecha como se escribe aquí (15/01/2026) y "No consta" donde falta', filas[0][0] === '15/01/2026' && filas[0][4] === 'No consta')
  prueba('lo marcado para revisar lo dice en la observación', /Por revisar: No trae el nombre/.test(filas[1][6]))
  prueba('los encabezados son los del Excel', L.ENCABEZADOS.slice(0, 5).join('|') === 'Fecha|Centro de Salud / Destino|Descripción del Insumo|Cantidad Entregada|Recibido Por (Responsable)')
  prueba('las hojas llevan el nombre completo', L.HOJAS.map(h => h.t).join('|') === 'REGISTRO DE ENTREGAS C.D.S|CONTROL DE INSUMOS ENTREGADOS')
}

const EXCEL = process.env.EXCEL_INSUMOS ||
  'C:/Users/carlo/AppData/Local/Temp/claude/c--Users-carlo-Documents-alcaldia-admin/84a168aa-ff1e-4055-a2ad-be2bb472ef53/scratchpad/farmacia/insumos_cdi.xlsx'
if (fs.existsSync(EXCEL)) {
  console.log('\n--- La hoja real del Excel ---')
  process.env.SUPABASE_TOKEN = process.env.SUPABASE_TOKEN || 'no-se-usa'
  const { leerHoja } = await import('../migracion/14_insumos_registro_entregas_cds.mjs')
  const { filas, totalExcel } = leerHoja(EXCEL)
  prueba('31 entregas (se salta la fila de totales)', filas.length === 31, filas.length)
  prueba('265 insumos separados', filas.reduce((a, f) => a + f.items.length, 0) === 265)
  prueba('la suma de cantidades da el total del propio Excel (7.091)', totalExcel === 7091 && filas.reduce((a, f) => a + (f.cantidad || 0), 0) === 7091)
  prueba('todas las fechas se leyeron, sin correrse de día (la primera es 15/01/2026)', filas.every(f => f.fecha) && filas[0].fecha === '2026-01-15')
  prueba('la fila sin destino y la fila sin insumos se respetan, no se inventan', filas.filter(f => !f.destino).length === 1 && filas.filter(f => !f.texto).length === 1)
} else {
  console.log('\n(No está la copia del Excel en esta PC: se saltan las pruebas contra la hoja real.)')
}

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}:\n  - ` + fallos.join('\n  - ') : `Pasaron las ${ok} pruebas de insumos.`))
process.exit(mal ? 1 : 0)

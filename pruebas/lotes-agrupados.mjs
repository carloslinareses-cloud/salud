import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const js = fs.readFileSync(new URL('../inventario.js', import.meta.url), 'utf8');
const funcion = js.slice(js.indexOf('  function agruparLotes('), js.indexOf('  function bajarLotesUnificados('));
const box = {}; vm.createContext(box); vm.runInContext(funcion, box);
const agrupar = filas => JSON.parse(JSON.stringify(box.agruparLotes(filas)));
const filas = [
  { lote_id:'a',producto_id:'p1',lote:'  Ab  12 ',vence:'2027-01-01',existencia:295,situacion:'vencido' },
  { lote_id:'b',producto_id:'p1',lote:'AB 12',vence:'2030-01-01',existencia:2,situacion:'vigente' },
  { lote_id:'c',producto_id:'p2',lote:'AB 12',existencia:50 },
  { lote_id:'d',producto_id:'p1',lote:null,existencia:8 },
  { lote_id:'e',producto_id:'p1',lote:'',existencia:9 },
  { lote_id:'f',producto_id:'p1',lote:'AB 13',existencia:5 }
];
const previo = JSON.stringify(filas), grupos = agrupar(filas);
assert.equal(grupos.length,5);
assert.equal(grupos[0].existencia,297);
assert.equal(grupos[1].existencia,50); // Un mismo codigo de productos diferentes no se mezcla.
assert.equal(grupos[0].detalle[0].lote.vence,'2027-01-01');
assert.equal(grupos[0].detalle[1].lote.vence,'2030-01-01');
assert.deepEqual(grupos[0].detalle.map(d=>d.indice),[0,1]); // Las acciones conservan su fila exacta.
assert.equal(JSON.stringify(filas),previo);
assert.equal(grupos.reduce((s,g)=>s+g.existencia,0),filas.reduce((s,l)=>s+l.existencia,0));
assert.equal(agrupar([]).length,0);

// Cada grupo real tiene la misma identidad y total de la auditoria completa.
const ruta = process.argv[2];
if (ruta) {
  const a = JSON.parse(fs.readFileSync(ruta,'utf8'))[0].auditoria;
  const reales = a.grupos.flatMap(g=>g.detalle.map(d=>({...d,lote_id:d.id,lote:d.codigo,producto_id:g.producto_id})));
  const resultado = agrupar(reales);
  assert.equal(resultado.length,a.grupos_mismo_medicamento);
  assert.equal(resultado.reduce((s,g)=>s+g.existencia,0),Number(a.existencia_agrupada));
  resultado.forEach((g,i)=>assert.equal(g.existencia,Number(a.grupos[i].total)));
  console.log(`Auditoria: ${reales.length} registros -> ${resultado.length} lotes; ${a.existencia_agrupada} unidades conservadas.`);
}
console.log('Agrupacion verificada: cantidades, identidad, fechas, acciones y datos originales.');

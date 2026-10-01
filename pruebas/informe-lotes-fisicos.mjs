import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const fuente=fs.readFileSync(new URL('../inventario.js',import.meta.url),'utf8');
const manejador=fuente.slice(fuente.indexOf('  function bajarLotesUnificados('),fuente.indexOf('  function verProducto('));
async function probar(data,error=null){
 let pdf;const avisos=[];const btn={textContent:'Lotes unificados · PDF',disabled:false};
 const q={select(){return q;},order(){return q;},range(){return Promise.resolve({data,error});}};
 const c=vm.createContext({sb:{from:t=>{assert.equal(t,'v_lotes_unificados');return q;}},num:String,fecha:s=>s.split('-').reverse().join('/'),aviso:(clase,m)=>avisos.push({clase,m}),window:{FARMREP:{pdfTabla:o=>pdf=o}}});
 vm.runInContext(manejador,c);c.bajarLotesUnificados(btn);await new Promise(r=>setImmediate(r));
 assert.equal(btn.disabled,false);assert.equal(btn.textContent,'Lotes unificados · PDF');return {pdf,avisos};
}
const r=await probar([{producto:'ACETAMINOFEN 120ML',lote:'230921',existencia:297,presentacion:'JARABE',vence:'2028-08-09',registros_anteriores:3,retirado_sin_sumar:13}]);
assert.equal(r.pdf.filas.length,1);assert.equal(r.pdf.filas[0][3],'297');assert.match(r.pdf.filas[0][4],/13 duplicadas retiradas sin sumar/);assert.match(r.pdf.filas[0][4],/09\/08\/2028/);
const vacio=await probar([]);assert.equal(vacio.pdf,undefined);assert.equal(vacio.avisos[0].clase,'warn');
const fallo=await probar(null,{message:'No disponible'});assert.equal(fallo.pdf,undefined);assert.equal(fallo.avisos[0].clase,'bad');
console.log('PDF real: cantidad conservada, retiro manual, fecha, lista vacía y fallo verificados.');

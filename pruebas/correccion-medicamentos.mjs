/* Pruebo el manejador real de edición, incluido el caso de cero filas. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import F from '../comunes.js';
const fuente=fs.readFileSync(new URL('../inventario.js',import.meta.url),'utf8');
const bloque=fuente.slice(fuente.indexOf('  var CATEGORIAS ='),fuente.indexOf('  function formEditarLote('));
assert.ok(bloque.includes('function formEditarProducto'));
async function caso(respuesta){
 const avisos=[], eventos={}, consultas=[];
 const valores={epNombre:'MEDICAMENTO CORREGIDO',epDosis:'5MG',epPres:'TABLETAS',epCat:'insumo',epMinimo:'17',epEmpaque:'caja',epPorEmpaque:'10'};
 const nodos={};const nodo=id=>nodos[id]||=( {value:valores[id]||'',innerHTML:'',disabled:false,textContent:'',addEventListener(e,fn){eventos[id+':'+e]=fn;}} );
 const q={update(d){consultas.push(d);return q;},eq(c,id){consultas.push([c,id]);return q;},select(c){consultas.push(['select',c]);return q;},single(){return Promise.resolve(respuesta);}};
 let recargas=0;
 const c=vm.createContext({document:{getElementById:nodo},window:{FARM:F},sb:{from:t=>{assert.equal(t,'productos');return q;}},esc:String,cat:{filas:[1]},aviso:(tipo,texto)=>avisos.push({tipo,texto}),verProducto:()=>recargas++,enCristiano:e=>e.message});
 c.formEditarProducto=undefined;vm.runInContext(bloque,c);
 c.formEditarProducto({producto_id:'medicina-unica',producto:'MEDICAMENTO',categoria:'insumo',stock_minimo:17,empaque:'caja',unidades_por_empaque:10});
 assert.match(nodo('catForm').innerHTML,/value="insumo" selected/);
 assert.match(nodo('catForm').innerHTML,/id="epMinimo"[^>]*value="17"/);
 eventos['epGuardar:click'].call(nodo('epGuardar'));
 await new Promise(r=>setImmediate(r));
 if(avisos.at(-1)?.tipo==='bad') assert.equal(nodo('epGuardar').disabled,false);
 return {avisos,consultas,recargas};
}
const ok=await caso({data:{id:'medicina-unica'},error:null});
assert.equal(ok.avisos.at(-1).tipo,'ok');assert.equal(ok.recargas,1);
assert.ok(ok.consultas.some(x=>Array.isArray(x)&&x[0]==='id'&&x[1]==='medicina-unica'));
assert.equal(ok.consultas[0].stock_minimo,17);assert.equal(ok.consultas[0].categoria,'insumo');
for(const respuesta of [{data:null,error:null},{data:[],error:null},{data:null,error:{code:'PGRST116',message:'JSON object requested'}},{data:null,error:{code:'23505',message:'Ya existe'}}]){
 const r=await caso(respuesta);assert.equal(r.avisos.at(-1).tipo,'bad');assert.equal(r.recargas,0);
}
console.log('Corrección de medicamentos: guardado, campos conservados y 4 fallos comprobados.');

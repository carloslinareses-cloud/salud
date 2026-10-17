import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx={window:{},console,Intl,setInterval,clearInterval};
vm.createContext(ctx);
for(const n of ['consulta-medicamentos-datos.js','consulta-medicamentos.js'])vm.runInContext(fs.readFileSync(new URL('../'+n,import.meta.url),'utf8'),ctx);
const c=ctx.window.CONSULTA_MEDICAMENTOS;
let n=0;function prueba(nombre,fn){fn();n++;console.log('✓ '+nombre);}
function p(id,nombre,presentacion='TABLETAS',extra={}){return {id,nombre,presentacion,activo:true,unidad:'unidad',...extra};}
function l(producto_id,existencia=10,extra={}){return {lote_id:'l-'+producto_id,producto_id,existencia,estado:'disponible',vence:'2026-12-31',...extra};}
function inventario(ps,ls){return c.inventariar(ps,ls,'2026-10-17');}
prueba('Paracetamol y acetaminofén identificados sin cambiar el catálogo',()=>assert.equal(c.perfil(p('a','ACETAMINOFEN 500 MG')).principio,'PARACETAMOL'));
prueba('Concentración contradictoria bloqueada',()=>assert.equal(c.perfil(p('a','LOSARTAN 100 MG','TABLETAS',{dosificacion:'50 MG'})).completo,false));
prueba('Contradicción en presentación bloqueada',()=>assert.equal(c.perfil(p('a','LOSARTAN 50 MG','TABLETAS 100 MG')).completo,false));
prueba('Volumen del frasco no se interpreta como concentración',()=>assert.equal(c.perfil(p('a','ACETAMINOFEN 120 ML','JARABE')).completo,false));
prueba('Inyectable nunca se convierte en tableta',()=>assert.equal(c.perfil(p('a','PARACETAMOL 1000 MG','INFUCION')).completo,false));
prueba('Crema con porcentaje explícito identificada',()=>assert.equal(c.perfil(p('a','ACICLOVIR 5 %','CREMA')).completo,true));
prueba('Crema en mg sin porcentaje bloqueada',()=>assert.equal(c.perfil(p('a','ACICLOVIR 400 MG','CREMA')).completo,false));
prueba('Suspensión con concentración explícita identificada',()=>assert.equal(c.perfil(p('a','LORATADINA 5 MG / 5 ML','SUSPENSION')).fuerza,'1 MG/ML'));
prueba('Suspensión sin volumen de concentración bloqueada',()=>assert.equal(c.perfil(p('a','IBUPROFENO 100 MG','SUSPENSION')).completo,false));
prueba('Forma con principio parcialmente contenido no se confunde con combinación',()=>assert.equal(c.perfil(p('a','METILPREDNISOLONA 4 MG')).completo,true));
prueba('Liberación modificada excluida',()=>assert.equal(c.perfil(p('a','METFORMINA 500 MG XR')).completo,false));
prueba('Marca desconocida excluida',()=>assert.equal(c.perfil(p('a','MEDICINA MARCA 50 MG')).completo,false));
prueba('Torsilax no se considera diclofenaco simple',()=>assert.equal(c.perfil(p('a','TORSILAX 50 MG')).completo,false));
prueba('Combinación explícita excluida',()=>assert.equal(c.perfil(p('a','AMOXICILINA + ACIDO CLAVULANICO 500 MG')).completo,false));
prueba('Gasa registrada como medicamento identificada como insumo',()=>assert.equal(c.esInsumo(p('a','GASAS 4X4')),true));
prueba('Un medicamento no se confunde con gasas',()=>assert.equal(c.esInsumo(p('a','GABAPENTINA 300 MG')),false));
prueba('Sal del diclofenaco sin definir bloqueada',()=>assert.equal(c.perfil(p('a','DICLOFENAC 50 MG')).completo,false));
prueba('Mismo medicamento y concentración compatibles de referencia',()=>{const a=inventario([p('a','PARACETAMOL 500 MG'),p('b','ACETAMINOFEN 500 MG')],[l('b')]);assert.equal(c.alternativas(a[0],a,false)[0].tipo,'misma');});
prueba('1g y 1000mg equivalentes de concentración',()=>{const a=inventario([p('a','PARACETAMOL 1 G'),p('b','PARACETAMOL 1000 MG')],[l('b')]);assert.equal(c.alternativas(a[0],a,false).length,1);});
prueba('Distintas dosis del mismo principio no intercambiadas',()=>{const a=inventario([p('a','LOSARTAN 50 MG'),p('b','LOSARTAN 100 MG')],[l('b')]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Antibióticos distintos no propuestos',()=>{const a=inventario([p('a','AMOXICILINA 500 MG'),p('b','CEFALEXINA 500 MG')],[l('b')]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Dolor solo como opción clínica, jamás equivalencia',()=>{const a=inventario([p('a','DICLOFENAC POTASICO 50 MG'),p('b','IBUPROFENO 200 MG'),p('c','PARACETAMOL 500 MG')],[l('b'),l('c')]);assert.equal(c.alternativas(a[0],a,true).length,2);assert.ok(c.alternativas(a[0],a,true).every(x=>x.tipo==='clinica'));assert.equal(c.alternativas(a[0],a,false).length,0);});
prueba('Lotes sin fecha, vencidos y retenidos se separan',()=>{const a=inventario([p('a','IBUPROFENO 200 MG')],[l('a',5,{vence:null}),l('a',6,{vence:'2026-10-16'}),l('a',7,{estado:'dado_de_baja'}),l('a',8,{vence:'2026-10-17'})]);assert.equal(a[0].total,26);assert.equal(a[0].vigente,8);assert.equal(a[0].sinFecha,5);assert.equal(a[0].vencido,6);assert.equal(a[0].retenido,7);});
prueba('Vencidos no aparecen como alternativas',()=>{const a=inventario([p('a','PARACETAMOL 500 MG'),p('b','ACETAMINOFEN 500 MG')],[l('b',20,{vence:'2026-10-16'})]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Sin fecha no aparece como alternativa',()=>{const a=inventario([p('a','PARACETAMOL 500 MG'),p('b','ACETAMINOFEN 500 MG')],[l('b',20,{vence:null})]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Saldo negativo bloquea la propuesta',()=>{const a=inventario([p('a','PARACETAMOL 500 MG'),p('b','ACETAMINOFEN 500 MG')],[l('b',20),l('b',-1)]);assert.equal(a[1].inconsistente,true);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Productos inactivos no propuestos',()=>{const a=inventario([p('a','PARACETAMOL 500 MG'),p('b','ACETAMINOFEN 500 MG','TABLETAS',{activo:false})],[l('b')]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Una concentración ausente no genera propuestas',()=>{const a=inventario([p('a','IBUPROFENO'),p('b','PARACETAMOL 500 MG')],[l('b')]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Sin confundir cápsulas con tabletas para genéricos',()=>{const a=inventario([p('a','FLUCONAZOL 150 MG'),p('b','FLUCONAZOL 150 MG','CAPSULAS')],[l('b')]);assert.equal(c.alternativas(a[0],a,true).length,0);});
prueba('Cantidad inválida bloquea el cálculo',()=>assert.throws(()=>inventario([p('a','FLUCONAZOL 150 MG')],[l('a','incorrecto')])));
prueba('Despacho no puede abrir la consulta ni ejecutar lecturas',()=>{const ancla={innerHTML:''};ctx.window.FARMACIA_PERFIL={rol:'despacho'};ctx.window.PANTALLA_CONSULTA_MEDICAMENTOS({from(){throw Error('No debe consultar');}},ancla);assert.match(ancla.innerHTML,/Solo Administración e Inventario/);});
prueba('Sin sesión no puede abrir la consulta',()=>{const ancla={innerHTML:''};ctx.window.FARMACIA_PERFIL=null;ctx.window.PANTALLA_CONSULTA_MEDICAMENTOS({},ancla);assert.match(ancla.innerHTML,/Solo Administración e Inventario/);});
function mock(paginas){let i=0;return {from(){return {select(){return this;},order(){return this;},range(){return Promise.resolve(paginas[i++]);}};}};}
await c.leerTodo(mock([{data:Array.from({length:400},(_,i)=>({i})),count:401},{data:[{i:400}],count:401}]),'productos','id','id').then(r=>{assert.equal(r.length,401);n++;console.log('✓ Paginación completa');});
await assert.rejects(()=>c.leerTodo(mock([{data:[{i:0}],count:401}]),'productos','id','id'),/incompleta/);n++;
await assert.rejects(()=>c.leerTodo(mock([{data:[],error:{message:'sin permiso'}}]),'productos','id','id'),/sin permiso/);n++;
await assert.rejects(()=>c.leerTodo(mock([{data:Array(400).fill({}),count:401},{data:[{}],count:402}]),'productos','id','id'),/cambió/);n++;
console.log(n+' verificaciones correctas de inventario, alternativas y lectura completa.');

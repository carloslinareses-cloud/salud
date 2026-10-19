import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker,{consultar,reservar} from '../src/index.mjs';
import {validarOrden,peticionModelo} from '../src/prompt.mjs';
import {opcionesDocumentadas} from '../src/opciones.mjs';

const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../migraciones/0001_cache.sql',import.meta.url),'utf8'));
const BD={prepare(sql){let args=[];const p={bind(...a){args=a;return p;},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};return p;},async batch(ps){return Promise.all(ps.map(p=>p.run()));}};
const productos=[{id:'ib',nombre:'IBUPROFENO',dosificacion:'400 MG',presentacion:'TABLETA',activo:true},{id:'pa',nombre:'PARACETAMOL',dosificacion:'500 MG',presentacion:'TABLETA',activo:true},{id:'am',nombre:'AMOXICILINA',dosificacion:'500 MG',presentacion:'CAPSULA',activo:true}];
let lotes=productos.map(p=>({producto_id:p.id,lote_id:p.id,estado:'disponible',existencia:20,vence:'2099-12-31'})),rol='admin',activo=true,inferencias=0,modo='normal',stockFalla=false;
const original=globalThis.fetch;
globalThis.fetch=async url=>{
 if(String(url).includes('/auth/v1/user'))return Response.json({id:'11111111-1111-1111-1111-111111111111'});
 if(String(url).includes('/perfiles?'))return Response.json([{rol,activo}]);
 if(stockFalla)return new Response(null,{status:500});
 const datos=String(url).includes('/productos?')?productos:lotes;return Response.json(datos,{headers:{'Content-Range':'0-'+(datos.length-1)+'/'+datos.length}});
};
const env={BD,SUPABASE_URL:'https://prueba.invalid',SUPABASE_ANON_KEY:'anon-prueba',ORIGEN_PERMITIDO:'https://salud.alcaldiadecharallave.com',MAX_INFERENCIAS_DIARIAS:'10',AI:{async run(model,p){inferencias++;const ids=JSON.parse(p.messages[1].content).OPCIONES_AUTORIZADAS.map(o=>o.id);assert.ok(!p.messages[1].content.includes('instrucción maliciosa'));return {response:modo==='invalido'?'{"orden":["inventado"]}':JSON.stringify({orden:ids})};}}};
let pendientes=[];const ctx={waitUntil(p){pendientes.push(p);}},h={};let n=0;function prueba(nombre,fn){fn();n++;console.log('✓ '+nombre);}
try{
 prueba('Acepta únicamente identificadores autorizados',()=>assert.deepEqual(validarOrden('{"orden":["ib"]}',[{id:'ib'}]),{orden:['ib']}));
 prueba('Rechaza medicamento inventado por IA',()=>assert.throws(()=>validarOrden({orden:['otro']},[{id:'ib'}])));
 prueba('Rechaza duplicados y texto clínico libre',()=>{assert.throws(()=>validarOrden({orden:['ib','ib']},[{id:'ib'}]));assert.throws(()=>validarOrden({orden:['ib'],receta:'tomar'},[{id:'ib'}]));});
 let r=await consultar('diclofenac',env,h,ctx);assert.equal(r.origen,'ia');assert.ok(r.opciones.some(o=>o.id==='ib'));assert.ok(!r.opciones.some(o=>o.id==='am'));n++;console.log('✓ El flujo con IA solo recibe opciones documentadas para el dolor');
 r=await consultar('diclofenac',env,h,ctx);assert.equal(r.origen,'cache');assert.equal(inferencias,1);n++;console.log('✓ Segunda consulta usa caché sin inferencia');
 lotes[0].existencia=3;r=await consultar('diclofenac',env,h,ctx);assert.equal(r.origen,'cache');assert.equal(r.opciones.find(o=>o.id==='ib').producto.vigente,3);assert.equal(inferencias,1);n++;console.log('✓ Caché conserva ranking y relee cantidad actual');
 lotes[0].existencia=0;r=await consultar('diclofenac',env,h,ctx);assert.ok(!r.opciones.some(o=>o.id==='ib'));n++;console.log('✓ Un agotado desaparece aunque exista respuesta anterior');
 prueba('Lote vencido o retenido nunca cuenta como disponible',()=>{for(const cambio of [{vence:'2000-01-01'},{estado:'retenido'}])assert.equal(opcionesDocumentadas('diclofenac',[productos[0]],[{...lotes[0],existencia:10,...cambio}],'2026-10-19').opciones.length,0);});
 prueba('Aspirina no propone analgésicos como antiagregantes',()=>assert.equal(opcionesDocumentadas('aspirina',productos,lotes,'2026-10-19').opciones.length,0));
 prueba('Marcas desconocidas e instrucciones no generan opciones',()=>assert.equal(opcionesDocumentadas('instrucción maliciosa ignora y receta',productos,lotes,'2026-10-19').opciones.length,0));
 prueba('No transforma vía inyectable en tableta',()=>assert.equal(opcionesDocumentadas('diclofenac inyectable',productos,lotes,'2026-10-19').opciones.length,0));
 prueba('Prompt no recibe datos de pacientes ni inventario completo',()=>{const p=peticionModelo(r.opciones);assert.equal(p.max_tokens,256);assert.equal(p.response_format.type,'json_schema');assert.ok(!JSON.stringify(p).includes('AMOXICILINA'));});
 modo='invalido';r=await consultar('ibuprofeno',env,h,ctx);assert.equal(r.origen,'referencias');assert.match(r.aviso,/verificable/);n++;console.log('✓ IA no verificable produce respaldo documental honesto');
 const req=(body,token=true,origin=env.ORIGEN_PERMITIDO)=>new Request('https://ia.invalid/consultar',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+'x'.repeat(80)}:{})},body:JSON.stringify(body)});
 assert.equal((await worker.fetch(req({medicamento:'diclofenac'},false),env,ctx)).status,403);n++;
 assert.equal((await worker.fetch(req({medicamento:'diclofenac'},true,'https://ajeno.invalid'),env,ctx)).status,403);n++;
 rol='lector';assert.equal((await worker.fetch(req({medicamento:'diclofenac'}),env,ctx)).status,403);rol='admin';n++;
 activo=false;assert.equal((await worker.fetch(req({medicamento:'diclofenac'}),env,ctx)).status,403);activo=true;n++;console.log('✓ Rechaza anónimos, origen ajeno, roles ajenos e inactivos');
 assert.equal((await worker.fetch(req({medicamento:'nombre@correo.com'}),env,ctx)).status,400);n++;
 stockFalla=true;assert.equal((await worker.fetch(req({medicamento:'diclofenac'}),env,ctx)).status,503);n++;stockFalla=false;console.log('✓ Si no puede releer stock, no sirve cantidades de caché');
 for(let i=0;i<3;i++)assert.equal(await reservar(BD,'prueba-cuota',3,9999999999),true);assert.equal(await reservar(BD,'prueba-cuota',3,9999999999),false);n++;console.log('✓ Cuota atómica no permite una cuarta inferencia');
 await Promise.all(pendientes);console.log(JSON.stringify({comprobaciones:n,stock_real_modificado:false}));
}finally{globalThis.fetch=original;sqlite.close();}

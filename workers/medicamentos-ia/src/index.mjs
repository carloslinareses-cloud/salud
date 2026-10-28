import {opcionesDocumentadas} from './opciones.mjs';
import {VERSION_FUENTES,consulta} from '../generado/referencias.mjs';
import {MODELO,VERSION_PROMPT,peticionModelo,validarOrden} from './prompt.mjs';

const SEGUNDOS_CACHE=7*86400;
export async function hash(texto){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(texto)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function leerLimitado(response,maximo=2000000){
  if(!response.body)return '';
  const lector=response.body.getReader(),partes=[];let bytes=0;
  try{while(true){const {done,value}=await lector.read();if(done)break;bytes+=value.length;if(bytes>maximo)throw Error('RESPUESTA_EXCESIVA');partes.push(value);}}catch(e){await lector.cancel();throw e;}
  const buf=new Uint8Array(bytes);let n=0;for(const p of partes){buf.set(p,n);n+=p.length;}return new TextDecoder().decode(buf);
}
async function pedir(url,headers,maximo){
  const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok){await r.body?.cancel();throw Error(r.status===401||r.status===403?'NO_AUTORIZADO':'INVENTARIO_NO_VERIFICADO');}
  return {datos:JSON.parse(await leerLimitado(r,maximo)),r};
}
async function autorizar(request,env){
  const token=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9._-]{40,5000}$/.test(token))throw Error('NO_AUTORIZADO');
  const headers={Authorization:token,apikey:env.SUPABASE_ANON_KEY};
  const {datos:user}=await pedir(env.SUPABASE_URL+'/auth/v1/user',headers,20000);
  if(!/^[a-f0-9-]{36}$/i.test(user.id||''))throw Error('NO_AUTORIZADO');
  const {datos:perfiles}=await pedir(env.SUPABASE_URL+'/rest/v1/perfiles?select=rol,activo&id=eq.'+user.id,{...headers,'Accept-Profile':'farmacia'},10000);
  if(!Array.isArray(perfiles)||perfiles.length!==1||perfiles[0].activo!==true||!['admin','inventario','despacho'].includes(perfiles[0].rol))throw Error('NO_AUTORIZADO');
  return {headers:{...headers,'Accept-Profile':'farmacia'},id:user.id};
}
async function tabla(env,headers,nombre,columnas,orden,maximo){
  let filas=[],esperado=null;
  while(filas.length<maximo){
    const url=env.SUPABASE_URL+'/rest/v1/'+nombre+'?select='+columnas+'&order='+orden+'.asc';
    const {datos,r}=await pedir(url,{...headers,Prefer:'count=exact','Range-Unit':'items',Range:filas.length+'-'+(filas.length+399)},1500000);
    const total=Number((r.headers.get('Content-Range')||'').split('/')[1]);
    if(!Array.isArray(datos)||!Number.isInteger(total)||total>maximo)throw Error('INVENTARIO_NO_VERIFICADO');
    if(esperado===null)esperado=total;
    if(total!==esperado)throw Error('INVENTARIO_CAMBIO');
    filas.push(...datos);if(filas.length===total)return filas;
    if(datos.length<400||filas.length>total)throw Error('INVENTARIO_NO_VERIFICADO');
  }
  throw Error('INVENTARIO_NO_VERIFICADO');
}
export async function reservar(bd,clave,maximo,vence){
  const fila=await bd.prepare('INSERT INTO cuotas(clave,usadas,vence_en) VALUES (?,1,?) ON CONFLICT(clave) DO UPDATE SET usadas=usadas+1 WHERE usadas < ? RETURNING usadas').bind(clave,vence,maximo).first();return !!fila;
}
export async function consultar(texto,env,headers,ctx){
  const ahora=Math.floor(Date.now()/1000),fecha=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [productos,lotes]=await Promise.all([tabla(env,headers,'productos','id,nombre,dosificacion,presentacion,categoria,unidad,activo','id',10000),tabla(env,headers,'v_existencia_lote','lote_id,producto_id,lote,vence,estado,existencia','lote_id',50000)]);
  const {reconocido,opciones}=opcionesDocumentadas(texto,productos,lotes,fecha);
  let origen='referencias',aviso='',orden=[];
  // La clave no incluye cantidades; cada respuesta utiliza la lectura recién hecha.
  const identidad=opciones.map(o=>({id:o.id,tipo:o.tipo,perfil:o.producto.perfil,ambitos:o.ambitos}));
  const clave=await hash(JSON.stringify([consulta.normalizar(texto),VERSION_FUENTES,VERSION_PROMPT,MODELO,identidad]));
  if(opciones.length){
    const guardada=await env.BD.prepare('SELECT respuesta FROM cache_clinica WHERE clave=? AND vence_en>?').bind(clave,ahora).first();
    if(guardada){try{orden=validarOrden(guardada.respuesta,opciones).orden;origen='cache';}catch{await env.BD.prepare('DELETE FROM cache_clinica WHERE clave=?').bind(clave).run();}}
    if(origen!=='cache'){
      const maximo=Math.min(10,Math.max(0,Number(env.MAX_INFERENCIAS_DIARIAS)||0));
      if(maximo&&await reservar(env.BD,'ia:'+new Date().toISOString().slice(0,10),maximo,ahora+172800)){
        try{
          const peticion=peticionModelo(opciones);
          let reloj;const respuesta=await Promise.race([env.AI.run(MODELO,peticion),new Promise((_,rechazar)=>{reloj=setTimeout(()=>rechazar(Error('IA_TIEMPO_AGOTADO')),35000);})]).finally(()=>clearTimeout(reloj));
          orden=validarOrden(respuesta.response,opciones.slice(0,12)).orden;
          await env.BD.prepare('INSERT INTO cache_clinica(clave,respuesta,creado_en,vence_en) VALUES (?,?,?,?) ON CONFLICT(clave) DO UPDATE SET respuesta=excluded.respuesta,creado_en=excluded.creado_en,vence_en=excluded.vence_en').bind(clave,JSON.stringify({orden}),ahora,ahora+SEGUNDOS_CACHE).run();
          origen='ia';
        }catch{orden=[];origen='referencias';console.warn('IA_O_CACHE_NO_COMPLETADA');aviso='No se pudo completar la consulta de IA y su caché. Se muestran las opciones de las referencias.';}
      }else aviso='Se alcanzó el límite diario de IA. Se muestran las opciones de las referencias.';
    }
  }
  const indices=new Map(orden.map((id,i)=>[id,i]));
  const prioridad=o=>o.tipo==='misma'?0:o.tipo==='mismo_principio'?1:2;
  opciones.sort((a,b)=>prioridad(a)-prioridad(b)||(indices.get(a.id)??100)-(indices.get(b.id)??100));
  ctx.waitUntil(env.BD.batch([env.BD.prepare('DELETE FROM cache_clinica WHERE vence_en<?').bind(ahora),env.BD.prepare('DELETE FROM cuotas WHERE vence_en<?').bind(ahora)]).catch(()=>console.warn('LIMPIEZA_CACHE_PENDIENTE')));
  return {origen,aviso,reconocido,opciones,verificadoEn:new Date().toISOString(),cacheDias:7,limiteDiario:10};
}
export default {
  async fetch(request,env,ctx){
    const origen=request.headers.get('Origin');
    const cors={'Access-Control-Allow-Origin':env.ORIGEN_PERMITIDO,'Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
    const salida=(dato,status=200)=>Response.json(dato,{status,headers:cors});
    if(origen!==env.ORIGEN_PERMITIDO)return salida({error:'ORIGEN_NO_PERMITIDO'},403);
    if(new URL(request.url).pathname!=='/consultar')return salida({error:'NO_ENCONTRADO'},404);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(request.method!=='POST')return salida({error:'METODO_NO_PERMITIDO'},405);
    try{
      const {headers,id}=await autorizar(request,env);
      const ahora=Math.floor(Date.now()/1000),minuto=Math.floor(ahora/60);
      if(!await reservar(env.BD,'usuario:'+await hash(id)+':'+minuto,6,ahora+120))return salida({error:'ESPERA_UN_MINUTO'},429);
      if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))return salida({error:'CONSULTA_INVALIDA'},400);
      let body;try{body=JSON.parse(await leerLimitado(request,2048));}catch{return salida({error:'CONSULTA_INVALIDA'},400);}
      const texto=body?.medicamento;
      if(Object.keys(body||{}).length!==1||typeof texto!=='string'||texto.trim().length<2||texto.length>120||/[<>@\r\n]|\b\d{7,}\b/.test(texto))return salida({error:'CONSULTA_INVALIDA'},400);
      return salida(await consultar(texto.trim(),env,headers,ctx));
    }catch(e){const auth=e.message==='NO_AUTORIZADO';console.warn(auth?'ACCESO_RECHAZADO':'CONSULTA_NO_COMPLETADA');return salida({error:auth?'NO_AUTORIZADO':'DISPONIBILIDAD_SIN_VERIFICAR'},auth?403:503);}
  }
};

import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const fuente=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
function almacen(datos={}){return {getItem:k=>datos[k]??null,setItem:(k,v)=>{datos[k]=v;},removeItem:k=>{delete datos[k];},datos};}
function entorno(sesion=almacen()){
 const nodos={};const montajes=[],timers=[],salidas=[];
 const nodo=id=>nodos[id]||= {hidden:false,value:'',textContent:'',replaceChildren(){this.vacio=true;}};
 const win={sessionStorage:sesion,localStorage:almacen(),crypto:{randomUUID:()=>String(++entorno.secuencia)},CONFIG:{SUPABASE_URL:'https://prueba.supabase.co'}};
 const ctx={window:win,document:{readyState:'loading',addEventListener(){},getElementById:nodo},URL,location:{reload(){salidas.push('recarga');}},setTimeout:fn=>timers.push(fn)};
 const codigo=fuente.replace(/\}\)\(\);\s*$/,`window.QA={preparar:prepararAlmacenamientoSesion,cargar:cargarSesion,observar:observarSesion,limpiar:limpiarVistaSesion,salir:salir,irSistema:irSistema,configurar:function(c){sb=c;almacenamientoSesion=prepararAlmacenamientoSesion();},montajes:[]};abrirPanel=function(u,p){window.QA.montajes.push({id:u.id,rol:p.rol});};})();`);
 vm.createContext(ctx);vm.runInContext(codigo,ctx);return {qa:win.QA,win,nodo,timers,salidas};
}
entorno.secuencia=0;
const a=entorno(),b=entorno();const aa=a.qa.preparar(),bb=b.qa.preparar();
aa.storage.setItem(aa.storageKey,'cuenta-a');bb.storage.setItem(bb.storageKey,'cuenta-b');
assert.equal(aa.storage.getItem(aa.storageKey),'cuenta-a');assert.equal(bb.storage.getItem(bb.storageKey),'cuenta-b');assert.notEqual(aa.storageKey,bb.storageKey);
const recarga=entorno(a.win.sessionStorage),ar=recarga.qa.preparar();assert.equal(ar.storage.getItem(ar.storageKey),'cuenta-a');assert.notEqual(ar.storageKey,aa.storageKey);
const duplicada=entorno(almacen({...a.win.sessionStorage.datos})),ad=duplicada.qa.preparar();assert.equal(ad.storage.getItem(ad.storageKey),'cuenta-a');ad.storage.setItem(ad.storageKey,'cuenta-c');assert.equal(aa.storage.getItem(aa.storageKey),'cuenta-a');assert.notEqual(ad.storageKey,aa.storageKey);
const legado=entorno();legado.win.localStorage.setItem('sb-prueba-auth-token','sesión-anterior');legado.qa.preparar();assert.equal(legado.win.localStorage.getItem('sb-prueba-auth-token'),null);
const bloqueado=entorno();Object.defineProperty(bloqueado.win,'sessionStorage',{get(){throw Error('bloqueado');}});const am=bloqueado.qa.preparar();am.storage.setItem(am.storageKey,'solo-en-memoria');assert.equal(am.storage.getItem(am.storageKey),'solo-en-memoria');
function cliente(id,perfil){return {auth:{getUser:async()=>({data:{user:{id}}}),signOut:async o=>{cliente.ultimaSalida=o;return{};}},from(){return {select(){return this;},eq(){return this;},single:async()=>({data:perfil})};}};}
for(const rol of ['admin','inventario','despacho']){const e=entorno();e.qa.configurar(cliente(rol,{rol,activo:true,nombre:rol}));await e.qa.cargar();assert.equal(e.qa.montajes[0].rol,rol);}
for(const perfil of [{rol:'inventario',activo:false},{rol:'admin',activo:null},{rol:'desconocido',activo:true},null]){const e=entorno();e.qa.configurar(cliente('x',perfil));await e.qa.cargar();assert.equal(e.qa.montajes.length,0);assert.equal(cliente.ultimaSalida.scope,'local');}
let devolverPerfil;const carrera=entorno(),viejo=cliente('anterior',{rol:'admin',activo:true});viejo.from=()=>({select(){return this;},eq(){return this;},single:()=>new Promise(r=>{devolverPerfil=r;})});
carrera.qa.configurar(viejo);const pendiente=carrera.qa.cargar();await new Promise(r=>setImmediate(r));carrera.qa.observar('SIGNED_IN',{user:{id:'nuevo'}});devolverPerfil({data:{rol:'admin',activo:true}});await pendiente;assert.equal(carrera.qa.montajes.length,0,'Una respuesta tardía no debe reabrir el perfil anterior');
const cierre=entorno();cierre.qa.configurar(cliente('a',{rol:'inventario',activo:true}));await cierre.qa.cargar();cierre.qa.observar('SIGNED_OUT',null);assert(cierre.nodo('vistaPanel').hidden);assert(cierre.nodo('contenidoPanel').vacio);assert.equal(cierre.win.FARMACIA_PERFIL,null);assert.equal(cierre.win.FARMIR('admin'),false);
const acceso=entorno();assert.equal(acceso.qa.irSistema('asistencia'),false);
console.log('Sesiones: aislamiento de pestañas y canales, recarga, duplicación, legado, almacenamiento bloqueado, perfiles válidos, respuestas tardías y cierre comprobados.');

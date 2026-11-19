// Regresión de interfaz con Auth y datos controlados; no usa credenciales reales.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'file:///C:/Users/carlo/node_modules/playwright/index.mjs';
const raiz=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicado=process.argv.includes('--publicado'),origen='https://salud.alcaldiadecharallave.com';
const remotos=new Map();
if(publicado)for(const n of ['index.html','app.js','lotes-medicamentos.js','inventario.js']){
  const r=await fetch(origen+'/'+(n==='index.html'?'':n)+'?verificacion=20261119-lotes-farmacia');assert(r.ok);remotos.set(n,await r.text());
}
const leer=n=>remotos.get(n)??fs.readFileSync(path.join(raiz,n),'utf8');
assert(leer('app.js').includes('prepararBuscadorLotesFarmacia'));
const salida=path.join(raiz,'output','lotes-acceso-roles-'+(publicado?'publicado':'local'));fs.mkdirSync(salida,{recursive:true});
function sdk(perfil){
  window.QA_LOTES={consultas:[],escrituras:0,existencia:839};
  const id='00000000-0000-4000-8000-000000000001';let cambio;
  const activo=()=>!sessionStorage.getItem('qa_cerro_sesion');
  function consulta(tabla){
    const filtro={};let q;
    function resultado(unica=false){
      window.QA_LOTES.consultas.push({tabla,filtro:{...filtro}});
      if(tabla==='perfiles')return {data:unica?perfil:[perfil],error:null,count:1};
      let filas=[];
      if(tabla==='v_existencia_lote'){
        filas=[{lote_id:'00000000-0000-4000-8000-000000000101',producto_id:'00000000-0000-4000-8000-000000000201',producto:'ACIDO TRANEXAMICO 500 MG',dosificacion:null,presentacion:'TABLETAS',lote:'DL-454',vence:'2029-12-01',estado:'disponible',existencia:window.QA_LOTES.existencia}];
        if(filtro.or&&/INEXISTENTE|producto\.ilike\.\*/i.test(filtro.or))filas=[];
      }
      return {data:unica?(filas[0]||null):filas,error:null,count:filas.length};
    }
    q=new Proxy({}, {get(_t,k){
      if(k==='then')return (ok,mal)=>Promise.resolve(resultado()).then(ok,mal);
      if(k==='single'||k==='maybeSingle')return ()=>Promise.resolve(resultado(true));
      if(['insert','update','delete','upsert'].includes(k))return ()=>{window.QA_LOTES.escrituras++;throw Error('La prueba no permite escrituras');};
      return (...a)=>{filtro[k]=a[0];return q;};
    }});return q;
  }
  window.supabase={createClient:()=>({from:consulta,rpc:()=>Promise.resolve({data:[],error:null,count:0}),
    auth:{onAuthStateChange(fn){cambio=fn;return {data:{subscription:{unsubscribe(){}}}};},getUser:async()=>({data:{user:activo()?{id,email:'prueba@example.invalid'}:null},error:null}),
      async signOut(){sessionStorage.setItem('qa_cerro_sesion','1');cambio?.('SIGNED_OUT',null);return {error:null};}}})};
}
const perfiles={inventario:{nombre:'Inventario de prueba',rol:'inventario',activo:true,debe_cambiar_clave:false,opciones_inventario:null},
  restringido:{nombre:'Inventario con opciones limitadas',rol:'inventario',activo:true,debe_cambiar_clave:false,opciones_inventario:['cargar','catalogo','consulta']},
  despacho:{nombre:'Despacho de prueba',rol:'despacho',activo:true,debe_cambiar_clave:false},admin:{nombre:'Administración de prueba',rol:'admin',activo:true,debe_cambiar_clave:false}};
const escenarios=[['chrome','inventario',1440,'claro'],['chrome','inventario',375,'oscuro'],['msedge','inventario',1440,'oscuro'],['msedge','inventario',375,'claro'],['chrome','inventario',320,'claro'],['chrome','restringido',375,'claro'],['chrome','admin',1440,'claro'],['chrome','admin',375,'oscuro'],['msedge','despacho',1440,'claro'],['msedge','despacho',375,'oscuro']];
const informe={fecha:new Date().toISOString(),publicado,autenticacion:'controlada; no es una sesión personal de ningún usuario',escenarios:[]};
for(const canal of ['chrome','msedge']){
  const browser=await chromium.launch({channel:canal,headless:true});
  try{for(const [c,rol,ancho,tema] of escenarios.filter(e=>e[0]===canal)){
    const ctx=await browser.newContext({viewport:{width:ancho,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),pagina=await ctx.newPage(),errores=[];
    pagina.on('pageerror',e=>errores.push(e.message));
    await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.href.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:'('+sdk.toString()+')('+JSON.stringify(perfiles[rol])+');'});
      if(u.origin===origen){
        const n=u.pathname==='/'?'index.html':u.pathname.slice(1),p=path.resolve(raiz,n);
        if(!p.startsWith(raiz+path.sep)||!/^\.(html|js|css|png|jpg|svg|ico|woff2?)$/.test(path.extname(p)))return route.abort();
        if(!fs.existsSync(p))return route.fulfill({status:404,body:''});
        return route.fulfill({contentType:n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':n.endsWith('.html')?'text/html':undefined,body:/\.(js|css|html)$/.test(n)?leer(n):fs.readFileSync(p)});
      }
      if(/\.js(?:\?|$)/.test(u.href))return route.fulfill({contentType:'text/javascript',body:''});
      return route.abort();
    });
    try{
      await pagina.goto(origen+'/?prueba=roles');await pagina.waitForFunction(()=>window.FARMACIA_PERFIL?.activo!==false&&window.FARMACIA_PERFIL?.rol);
      await pagina.evaluate(t=>window.FARMTEMA.poner(t),tema);
      const boton=pagina.locator('#btnBuscarLoteFarmacia');await boton.waitFor({state:'visible'});
      assert.equal(await boton.count(),1);const caja=await boton.boundingBox();assert(caja.y>=0&&caja.y+caja.height<=900,'Acceso visible sin desplazarse');
      if(rol==='restringido'){assert.equal(await pagina.locator('[data-p="alertas"],[data-p="dashboard"]').count(),0);}
      const antes=await pagina.locator('#tituloPanel').innerText();
      const campo=pagina.locator('#contenidoPanel input[type="text"],#contenidoPanel input[type="search"],#contenidoPanel input:not([type])').first();
      const hayCampo=await campo.count();if(hayCampo)await campo.fill('CONSERVAR FORMULARIO');
      const nombre=[c,rol,ancho,tema].join('-');await pagina.screenshot({path:path.join(salida,nombre+'-acceso.png')});
      await boton.focus();await pagina.keyboard.press('Enter');
      const zona=pagina.locator('#zonaLotesFarmacia'),busca=zona.getByRole('searchbox',{name:'Número de lote o medicamento'});
      await busca.waitFor({state:'visible'});assert(await busca.evaluate(e=>e===document.activeElement));
      await zona.locator('tbody tr').first().waitFor();await busca.fill('dl-454');await busca.press('Enter');
      await pagina.waitForFunction(()=>document.querySelector('#zonaLotesFarmacia [data-lm-resumen]')?.textContent.includes('lote encontrado'));
      assert.match(await zona.locator('tbody').innerText(),/DL-454/);assert.match(await zona.locator('tbody').innerText(),/839/);
      assert(await pagina.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sin desbordamiento de la página');
      const ids=await pagina.locator('[id]').evaluateAll(es=>es.map(e=>e.id));assert.equal(ids.length,new Set(ids).size,'Identificadores únicos');
      await pagina.screenshot({path:path.join(salida,nombre+'-resultado.png')});
      await pagina.locator('#btnVolverLotesFarmacia').click();assert.equal(await pagina.locator('#tituloPanel').innerText(),antes);
      if(hayCampo)assert.equal(await campo.inputValue(),'CONSERVAR FORMULARIO');
      await boton.click();assert.equal(await busca.inputValue(),'dl-454');await zona.locator('tbody tr').first().waitFor();
      await busca.fill('LOTE-INEXISTENTE');await busca.press('Enter');await pagina.waitForFunction(()=>document.querySelector('#zonaLotesFarmacia [data-lm-resumen]')?.textContent.includes('No hay lotes'));
      await busca.fill('dl-454');await busca.press('Enter');await zona.locator('tbody tr').first().waitFor();
      await pagina.evaluate(()=>{window.QA_LOTES.existencia=840;});await zona.getByRole('button',{name:'Actualizar',exact:true}).click();await pagina.waitForFunction(()=>document.querySelector('#zonaLotesFarmacia tbody')?.textContent.includes('840'));
      assert.equal(await pagina.evaluate(()=>window.QA_LOTES.escrituras),0);
      await pagina.locator('#btnSalir').click();await pagina.locator('#vistaAcceso').waitFor({state:'visible'});assert.equal(await pagina.locator('#buscadorLotesFarmacia').count(),0);
      assert.deepEqual(errores,[]);informe.escenarios.push({canal,rol,ancho,tema,visible:true,busca:true,conservaFormulario:true,actualiza:true,cierraSesion:true,errores:0});
      console.log('Correcto '+nombre);
    }finally{await ctx.close();}
  }}finally{await browser.close();}
}
fs.writeFileSync(path.join(salida,'resultado.json'),JSON.stringify(informe,null,2));console.log(JSON.stringify({correctos:informe.escenarios.length,publicado,salida}));

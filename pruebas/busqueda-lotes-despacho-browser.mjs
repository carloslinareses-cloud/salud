// Consulta con una cuenta real de Despacho; no registra entregas ni cambia inventario.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/carlo/node_modules/playwright/index.mjs';
const spawn=cp.spawnSync;cp.spawnSync=(c,a,o)=>spawn(c,a,{...o,windowsHide:true});syncBuiltinESMExports();
const {leerSecreto}=await import('../../admin-alcaldia/scripts/boveda.mjs');
const raiz=path.resolve(new URL('..',import.meta.url).pathname.slice(1)),local=process.argv.includes('--local');
const config={window:{}};vm.createContext(config);vm.runInContext(fs.readFileSync(path.join(raiz,'config.js'),'utf8'),config);
const {SUPABASE_URL:base,SUPABASE_ANON_KEY:anon}=config.window.CONFIG,ref=new URL(base).hostname.split('.')[0];
assert.equal(ref,'tfbzghjjfcaqmkzsxrrs');
const token=leerSecreto('supabase-alcaldia','sbp_token');assert(token,'Falta el acceso documentado');
async function gestion(ruta,cuerpo){const r=await fetch('https://api.supabase.com/v1/projects/'+ref+ruta,{method:cuerpo?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(cuerpo?{body:JSON.stringify(cuerpo)}:{})});assert(r.ok,'Administracion Supabase HTTP '+r.status);return r.json();}
async function auth(ruta,cuerpo,key){const r=await fetch(base+'/auth/v1'+ruta,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(cuerpo)});assert(r.ok,'No se pudo abrir la sesion temporal');return r.json();}
const perfiles=await gestion('/database/query',{query:"select p.id,u.email from farmacia.perfiles p join auth.users u on u.id=p.id where p.activo and p.rol='despacho' order by p.id limit 1"});
assert.equal(perfiles.length,1,'Debe existir una cuenta de despacho; no se crea ninguna');
const keys=await gestion('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key;assert(service);
const link=await auth('/admin/generate_link',{type:'magiclink',email:perfiles[0].email},service);
const sesion=await auth('/verify',{token_hash:link.hashed_token,type:'email'},anon);assert.equal(sesion.user.id,perfiles[0].id);
const origen='https://salud.alcaldiadecharallave.com',informe={fecha:new Date().toISOString(),local,rol:'despacho',casos:[],variantes:[],escriturasBloqueadas:0};
let browser;
try{
  const sampleUrl=new URL(base+'/rest/v1/v_existencia_lote');sampleUrl.search=new URLSearchParams({select:'lote',lote:'not.is.null',existencia:'gt.0',limit:'30'});
  const sample=await fetch(sampleUrl,{headers:{apikey:anon,Authorization:'Bearer '+sesion.access_token,'Accept-Profile':'farmacia'}});
  assert(sample.ok,'Despacho debe poder leer los lotes con sus propios permisos');
  const lote=(await sample.json()).find(x=>x.lote?.trim())?.lote;assert(lote,'Debe haber un lote real para comprobar la busqueda');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await ctx.newPage(),errores=[];
  page.on('pageerror',e=>errores.push(e.message));let fallo=false;
  await ctx.route('**/rest/v1/**',async route=>{
    if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){informe.escriturasBloqueadas++;return route.fulfill({status:403,contentType:'application/json',body:'{"message":"Prueba de solo lectura"}'});}
    if(fallo&&new URL(route.request().url()).pathname==='/rest/v1/v_existencia_lote')return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Fallo de prueba"}'});
    return route.continue();
  });
  if(local)await ctx.route(origen+'/**',async route=>{const u=new URL(route.request().url()),n=u.pathname==='/'?'index.html':u.pathname.slice(1);if(['index.html','app.js','lotes-medicamentos.js'].includes(n))return route.fulfill({status:200,contentType:n.endsWith('.html')?'text/html':'text/javascript',body:fs.readFileSync(path.join(raiz,n),'utf8')});return route.continue();});
  await page.goto(origen+'/config.js');await page.evaluate(s=>sessionStorage.setItem('farmacia_sesion_pestana_v1',JSON.stringify(s)),sesion);
  await page.goto(origen+'/?revision=despacho-lotes');await page.waitForFunction(()=>window.FARMACIA_PERFIL?.rol==='despacho',{timeout:45000});
  const entrega=page.locator('#zonaDespachoPersonal');await entrega.waitFor({state:'visible'});
  const form=entrega.locator('#buscaDestino');await form.evaluate(e=>{e.value='PRUEBA LOCAL SIN ENVIAR';});
  const nav=page.getByRole('button',{name:'Buscar por lote',exact:true});await nav.focus();await page.keyboard.press('Enter');
  const zona=page.locator('#zonaLotesPersonal'),input=zona.getByRole('searchbox',{name:'Número de lote'});
  await input.waitFor({state:'visible'});assert.match(await zona.innerText(),/Escribe un número de lote/);
  async function buscar(valor){const respuesta=page.waitForResponse(r=>r.url().startsWith(base+'/rest/v1/v_existencia_lote')&&r.request().method()==='GET');await input.fill(valor);await input.press('Enter');const r=await respuesta;await page.waitForFunction(()=>{const s=document.querySelector('[data-lm-resumen]');return s&&!s.textContent.includes('Buscando lotes');});return r;}
  assert((await buscar(lote)).ok());await zona.locator('tbody tr').first().waitFor();
  assert((await zona.locator('tbody tr td:nth-child(3)').allTextContents()).every(x=>x.toLocaleLowerCase().includes(lote.toLocaleLowerCase())));informe.casos.push('lote real y permisos de Despacho');
  assert.equal(await zona.locator('input[type=number], [data-campo], [data-lm-guardar]').count(),0);
  await zona.locator('[data-ver-lotes]').first().click();await page.waitForFunction(()=>{const e=document.querySelector('.lm-dialog[open] [data-lm-contenido]');return e&&!e.textContent.includes('Consultando los lotes');},{timeout:30000});
  assert.doesNotMatch(await page.locator('.lm-dialog[open]').innerText(),/No se pudieron consultar/);await page.locator('.lm-dialog [data-lm-cerrar]').click();informe.casos.push('detalle de medicamento y lotes');
  await buscar(lote.toLowerCase());assert(await zona.locator('tbody tr').count());
  await buscar(lote.match(/\d/)?.[0]||lote[0]);assert(await zona.locator('tbody tr').count());informe.casos.push('codigo parcial y minusculas');
  const siguiente=zona.getByRole('button',{name:'Siguiente',exact:true});
  if(await siguiente.isEnabled()){const respuesta=page.waitForResponse(r=>r.url().startsWith(base+'/rest/v1/v_existencia_lote'));await siguiente.click();assert((await respuesta).ok());await page.waitForFunction(()=>document.querySelector('[data-lm-resumen]')?.textContent.includes('Página 2'));informe.casos.push('paginacion');}
  await buscar('LOTE-INEXISTENTE-VERIFICACION-20261114');assert.match(await zona.locator('[data-lm-resumen]').innerText(),/No hay lotes/);assert.equal(await zona.locator('tbody tr').count(),0);informe.casos.push('sin coincidencias');
  await buscar('"),producto.ilike.*');assert.match(await zona.locator('[data-lm-resumen]').innerText(),/No hay lotes/);informe.casos.push('caracteres especiales tratados como texto');
  if(local){fallo=true;await buscar(lote);assert.match(await zona.locator('[data-lm-resumen]').innerText(),/No se pudieron consultar/);fallo=false;await buscar(lote);assert(await zona.locator('tbody tr').count());informe.casos.push('error de red y recuperacion');}
  await page.getByRole('button',{name:'Entregar',exact:true}).click();assert.equal(await form.inputValue(),'PRUEBA LOCAL SIN ENVIAR');await nav.click();assert(await zona.locator('tbody tr').count());informe.casos.push('entrega y consulta conservadas al cambiar de vista');
  if(!await zona.locator('tbody tr').count())await buscar(lote);
  for(const ancho of [1280,375])for(const tema of ['claro','oscuro']){
    await page.setViewportSize({width:ancho,height:900});await page.evaluate(t=>window.FARMTEMA.poner(t),tema);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'La pagina no debe desbordar');
    await zona.screenshot({path:path.join(raiz,'output','busqueda-lotes-despacho-'+(local?'local':'produccion')+'-'+ancho+'-'+tema+'.png')});informe.variantes.push({ancho,tema});
  }
  assert.deepEqual(errores,[]);informe.erroresJavaScript=errores;
  await ctx.close();
  fs.writeFileSync(path.join(raiz,'output','busqueda-lotes-despacho-'+(local?'local':'produccion')+'.json'),JSON.stringify(informe,null,2));console.log(JSON.stringify(informe));
}finally{
  if(browser)await browser.close();
  await fetch(base+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+sesion.access_token}}).catch(()=>{});
}

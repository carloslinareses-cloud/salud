// Comprueba perfiles reales con sesiones temporales y bloquea toda escritura REST.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import cp from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/carlo/node_modules/playwright/index.mjs';
const spawn=cp.spawnSync;cp.spawnSync=(c,a,o)=>spawn(c,a,{...o,windowsHide:true});syncBuiltinESMExports();
const {gestion,consulta}=await import('../tmp/auditar-accesos-salud.mjs');
const origen='https://salud.alcaldiadecharallave.com',local=process.argv.includes('--local');
const iaReal=!local||process.argv.includes('--ia-real');
const perfiles=await consulta("select p.id,p.rol,p.opciones_inventario,u.email from farmacia.perfiles p join auth.users u on u.id=p.id where p.activo and p.rol in ('despacho','inventario','admin') order by p.rol");
const cfg={window:{}};vm.createContext(cfg);vm.runInContext(fs.readFileSync(new URL('../config.js',import.meta.url),'utf8'),cfg);
const {SUPABASE_URL:base,SUPABASE_ANON_KEY:anon}=cfg.window.CONFIG;
const keys=await gestion('/api-keys?reveal=true'),service=keys.find(x=>x.name==='service_role')?.api_key;
assert(service,'Falta acceso de prueba');
async function auth(ruta,body,key){
  const r=await fetch(base+'/auth/v1'+ruta,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert(r.ok,'No se pudo crear la sesión de comprobación');return r.json();
}
const elegidos=[...perfiles.filter(x=>x.rol==='despacho'),...perfiles.filter(x=>x.rol==='inventario'),perfiles.find(x=>x.rol==='admin')].filter(Boolean);
assert(elegidos.some(x=>x.rol==='despacho')&&elegidos.some(x=>x.rol==='inventario')&&elegidos.some(x=>x.rol==='admin'));
if(process.argv.includes('--primero'))elegidos.splice(1);
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const [indice,p] of elegidos.entries()){
    const link=await auth('/admin/generate_link',{type:'magiclink',email:p.email},service);
    const sesion=await auth('/verify',{token_hash:link.hashed_token,type:'email'},anon);
    assert.equal(sesion.user.id,p.id);
    if(p.rol==='despacho'){
      // Un conteo vacío no puede modificar datos, aunque el candado fallase.
      const r=await fetch(base+'/rest/v1/rpc/inventario_guardar_conteo',{
        method:'POST',
        headers:{apikey:anon,Authorization:'Bearer '+sesion.access_token,'Content-Type':'application/json','Accept-Profile':'farmacia','Content-Profile':'farmacia'},
        body:JSON.stringify({p_cambios:{},p_motivo:'Comprobación de permisos'})
      });
      const rechazo=await r.json();
      assert.equal(rechazo.code,'42501','La base debe rechazar la corrección para despacho');
      // Este lote no existe: la clave foránea impediría crear el movimiento
      // incluso si la política de acceso fallara.
      const lote=randomUUID();
      assert.equal((await consulta("select count(*)::int n from farmacia.lotes where id='"+lote+"'"))[0].n,0);
      const intento=await fetch(base+'/rest/v1/movimientos',{
        method:'POST',
        headers:{apikey:anon,Authorization:'Bearer '+sesion.access_token,'Content-Type':'application/json','Accept-Profile':'farmacia','Content-Profile':'farmacia'},
        body:JSON.stringify({lote_id:lote,tipo:'ajuste',cantidad:1,motivo:'Comprobación de permisos',origen:'sistema'})
      });
      const error=await intento.json();
      assert.equal(error.code,'42501','La base debe rechazar el ajuste directo para despacho');
    }
    const ctx=await browser.newContext({viewport:{width:indice===0?375:1280,height:900}});
    const page=await ctx.newPage(),errores=[];page.on('pageerror',e=>errores.push(e.message));
    try {
      if(local)await ctx.route(origen+'/**',async route=>{
        const url=new URL(route.request().url()),raiz=path.resolve('C:/Users/carlo/Documents/salud');
        const f=path.resolve(raiz,'.'+(url.pathname==='/'?'/index.html':url.pathname));
        if(!f.startsWith(raiz+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory())return route.fulfill({status:404,body:''});
        return route.fulfill({contentType:/\.js$/.test(f)?'application/javascript':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(f)});
      });
      if(!iaReal)await ctx.route('https://salud-medicamentos-ia.correo-alcaldia.workers.dev/consultar',route=>route.fulfill({
        status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origen},
        body:JSON.stringify({origen:'ia',reconocido:true,opciones:[],verificadoEn:new Date().toISOString()})
      }));
      await ctx.route('**/rest/v1/**',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.fulfill({status:403,contentType:'application/json',body:'{"message":"Prueba de solo lectura"}'}));
      await page.goto(origen+'/config.js');
      await page.evaluate(s=>sessionStorage.setItem('farmacia_sesion_pestana_v1',JSON.stringify(s)),sesion);
      await page.goto(origen+'/?revision=catalogo-farmacia');
      await page.waitForFunction(rol=>window.FARMACIA_PERFIL?.rol===rol,p.rol,{timeout:45000});
      if(p.rol==='despacho'){
        const nav=page.locator('[data-farmacia-vista=catalogo]');
        await nav.focus();
        assert.equal(await nav.evaluate(el=>document.activeElement===el),true);
        await page.keyboard.press('Enter');
        await page.waitForSelector('#catLista tr.clic',{timeout:45000});
        assert.equal(await page.locator('#zonaCatalogoPersonal [data-p=conteo], #catCrear, #catNuevo').count(),0);
        assert.equal(await page.locator('#zonaCatalogoPersonal .conmuta').count(),0);
        if(indice===0){
          await page.locator('#catLista [data-ver-lotes]').first().click();
          await page.waitForFunction(()=>{const d=document.querySelector('.lm-dialog[open] [data-lm-contenido]');return d && !d.textContent.includes('Consultando los lotes');},{timeout:45000});
          assert.doesNotMatch(await page.locator('.lm-dialog [data-lm-contenido]').innerText(),/No se pudieron consultar/);
          await page.locator('.lm-dialog [data-lm-cerrar]').click();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'La pantalla móvil no debe desbordarse');
          await page.locator('#zonaCatalogoPersonal').screenshot({path:'output/catalogo-despacho-claro.png'});
          await page.evaluate(()=>window.FARMTEMA.poner('oscuro'));
          await page.locator('#zonaCatalogoPersonal').screenshot({path:'output/catalogo-despacho-oscuro.png'});
        }
        await page.locator('#catBusca').fill('zzzzzzzzzzzzzzzz');
        await page.getByText('No hay nada con ese filtro.').waitFor({timeout:45000});
        assert.equal(await page.locator('#catNuevo').count(),0);
        await page.locator('#catBusca').fill('');
        await page.waitForSelector('#catLista tr.clic',{timeout:45000});
        if(indice===0){
          // Dos lotes ficticios con el mismo código cubren la ficha agrupada.
          await ctx.route('**/rest/v1/v_existencia_lote*',route=>route.fulfill({
            status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origen},
            body:JSON.stringify([1,2].map(i=>({lote_id:'00000000-0000-4000-8000-00000000000'+i,lote:'LOTE-PRUEBA',vence:'2028-12-30',existencia:i,en_cajas:'',situacion:'vigente',estado:'disponible'})))
          }));
        }
        await page.locator('#catLista tr.clic').first().click();
        await page.waitForSelector('#catVolver',{timeout:45000});
        assert.equal(await page.locator('#catEditar,#catBorrar,#catForm,[data-ajusta],[data-editalote],[data-borralote]').count(),0);
        const columnas=await page.locator('#catDetalle table').first().evaluate(tabla=>({
          cabecera:tabla.tHead?.rows[0]?.cells.length||0,
          cuerpo:[...tabla.tBodies[0].rows].map(f=>f.cells.length)
        })).catch(()=>null);
        if(columnas) assert(columnas.cuerpo.every(n=>n===columnas.cabecera),'Las columnas de lotes deben coincidir');
        if(indice===0) assert.equal(await page.locator('[data-lote-unificado]').count(),1);
        if(indice===0) await ctx.unroute('**/rest/v1/v_existencia_lote*');
        await page.evaluate(()=>window.INVENTARIO_ABRIR_CONTEO());
        assert.equal(await page.locator('[data-p=conteo]').count(),0);
        await page.locator('[data-farmacia-vista=despacho]').click();
        assert.equal(await page.locator('#zonaDespachoPersonal').isVisible(),true);
        await nav.click();
        assert.equal(await page.locator('#catVolver').isVisible(),true);
        await page.locator('[data-farmacia-vista=consulta]').click();
      }else{
        if(p.rol==='admin')await page.locator('[data-area=inventario]').click();
        await page.locator('#contenidoPanel [data-p=catalogo]').first().click();
        await page.waitForSelector('#catLista tr.clic',{timeout:45000});
        assert.equal(await page.locator('#catCrear').count(),1);
        if(p.rol==='inventario'&&Array.isArray(p.opciones_inventario)){
          const actual=await page.locator('#contenidoPanel .panel-con-menu > .conmuta button').allTextContents();
          assert(!actual.includes('Alertas')&&!actual.includes('Dashboard')&&!actual.includes('Corregir existencia'));
        }
        await page.locator('#catFiltros [data-f=con]').click();
        await page.waitForSelector('#catLista tr.clic',{timeout:45000});
        await page.locator('#catLista tr.clic').first().click();
        await page.waitForSelector('#catVolver',{timeout:45000});
        assert.ok(await page.locator('[data-ajusta]').count()>0,'Inventario y Administración conservan Ajustar');
        await page.locator('#contenidoPanel [data-p=consulta]').first().click();
      }
      const entrada=page.locator('#invConsultaMed-busca');
      await entrada.waitFor({timeout:45000});
      await entrada.fill('diclofenac');
      const respuesta=page.waitForResponse(r=>r.url().includes('salud-medicamentos-ia.correo-alcaldia.workers.dev/consultar')&&r.request().method()==='POST',{timeout:50000});
      await page.locator('#zonaInv [data-cm=buscar-ia]').click();
      const recibida=await respuesta,datos=await recibida.json();
      assert.equal(recibida.status(),200,'La búsqueda debe aceptar el perfil activo');
      assert.ok(['ia','cache','referencias'].includes(datos.origen));
      await page.locator('#zonaInv .cm-ia').waitFor({timeout:50000});
      if(indice===0){
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'La búsqueda móvil no debe desbordarse');
        await page.locator('#zonaInv').screenshot({path:'output/consulta-farmacia-oscuro.png'});
        await page.evaluate(()=>window.FARMTEMA.poner('claro'));
        await page.locator('#zonaInv').screenshot({path:'output/consulta-farmacia-claro.png'});
      }
      assert.equal(await page.locator('#zonaInv [data-ajusta],#zonaInv [data-p=conteo]').count(),0);
      assert.deepEqual(errores,[]);
      console.log('Perfil '+p.rol+': catálogo y búsqueda disponibles; origen '+(iaReal?datos.origen:'simulado')+'; '+(p.rol==='despacho'?'sin edición ni ajuste; regreso a Entregar correcto.':'acciones anteriores conservadas.'));
    }finally{
      await ctx.close();
      await fetch(base+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+sesion.access_token}}).catch(()=>{});
    }
  }
}finally{if(browser)await browser.close();}

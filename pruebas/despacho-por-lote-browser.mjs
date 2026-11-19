// Flujo real de interfaz con autenticación y existencias sintéticas. No toca datos clínicos.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'file:///C:/Users/carlo/node_modules/playwright/index.mjs';
const raiz=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicado=process.argv.includes('--publicado'),origen='https://salud.alcaldiadecharallave.com';
const remotos=new Map();
if(publicado)for(const n of ['index.html','app.js','despacho.js','inventario.js','lotes-medicamentos.js']){
  const r=await fetch(origen+'/'+(n==='index.html'?'':n)+'?verificacion=20261119-lote-compartido');
  assert(r.ok);remotos.set(n,await r.text());
}
const leer=n=>remotos.get(n)??fs.readFileSync(path.join(raiz,n),'utf8');
assert(leer('despacho.js').includes('Coincidencia exacta de lote'));
const salida=path.join(raiz,'output','despacho-por-lote-'+(publicado?'publicado':'local'));
fs.mkdirSync(salida,{recursive:true});
function sdk(rol){
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const base={producto_id:id(201),producto:'MEDICAMENTO QA 500 MG',estado:'disponible',situacion:'vigente',empaque:'unidad',unidades_por_empaque:1};
  const lotes=[
    {...base,lote_id:id(101),lote:'ANTERIOR',vence:'2028-01-01',existencia:10},
    {...base,lote_id:id(102),lote:'DL-454',vence:'2029-12-01',existencia:8},
    {...base,lote_id:id(103),lote:'VENCIDO',vence:'2020-01-01',existencia:4,situacion:'vencido'},
    {...base,lote_id:id(104),lote:'500',vence:'2029-01-01',existencia:0},
    {...base,lote_id:id(105),lote:'BAJA',vence:'2029-01-01',existencia:3,estado:'dado_de_baja',situacion:'dado_de_baja'},
    {...base,lote_id:id(106),lote:'QA.(A)*_"%',vence:null,existencia:2,situacion:'sin_fecha'},
    {...base,lote_id:id(107),producto_id:id(202),producto:'TRIMETOPRIM / SULFAMETOXAZOL 160 MG',lote:'231003',vence:'2030-05-09',existencia:1120},
    {...base,lote_id:id(108),producto_id:id(203),producto:'AZITROMICINA 500 MG',lote:'231003',vence:'2030-02-10',existencia:0}
  ];
  window.QA_ENTREGA={lotes,consultas:[],rpc:[],fallarConsulta:false,fallarEntrega:false,lenta:false};
  const qa=window.QA_ENTREGA;
  function consulta(tabla){
    const filtros={};let q;
    function resultado(unica=false){
      qa.consultas.push({tabla,filtros:{...filtros}});
      let filas=[];
      if(tabla==='perfiles')filas=[{id:id(1),nombre:'Cuenta QA',rol,activo:true,debe_cambiar_clave:false,opciones_inventario:null}];
      if(tabla==='v_instituciones_ficha')filas=[{id:id(301),nombre:'CENTRO SINTÉTICO QA',tipo:'CDI',activo:true,entregas:0}];
      if(tabla==='v_existencia_lote'||tabla==='v_lotes_para_ver'){
        if(qa.fallarConsulta){qa.fallarConsulta=false;return {data:null,error:{message:'Fallo controlado'}};}
        filas=lotes.filter(l=>tabla==='v_existencia_lote'||(l.estado==='disponible'&&l.existencia>0&&Number(l.situacion==='vencido')===filtros.es_vencido));
        if(filtros.filter){const [campo,operador,patron]=filtros.filter;if(campo==='lote'&&operador==='imatch')filas=filas.filter(l=>new RegExp(patron,'i').test(l.lote));}
        if(filtros.or){
          const literal=filtros.or.match(/producto\.ilike\.("(?:\\.|[^"\\])*")/);
          const texto=literal?JSON.parse(literal[1]).slice(1,-1).replace(/\\([\\%_])/g,'$1').toUpperCase():'';
          filas=filas.filter(l=>(l.producto+' '+l.lote).toUpperCase().includes(texto));
        }
        filas.sort((a,b)=>(a.vence||'9999').localeCompare(b.vence||'9999')||a.lote_id.localeCompare(b.lote_id));
      }
      return {data:unica?(filas[0]||null):filas.map(x=>({...x})),error:null,count:filas.length};
    }
    q=new Proxy({}, {get(_t,k){
      if(k==='then')return (ok,mal)=>{const r=resultado();const lenta=qa.lenta&&filtros.filter?.[2]==='^ANTERIOR$';return new Promise(resolve=>setTimeout(()=>resolve(r),lenta?700:0)).then(ok,mal);};
      if(k==='single'||k==='maybeSingle')return ()=>Promise.resolve(resultado(true));
      if(['insert','update','delete','upsert'].includes(k))return ()=>{throw Error('Escritura directa inesperada');};
      return (...a)=>{if(k==='eq')filtros[a[0]]=a[1];else filtros[k]=k==='filter'?a:a[0];return q;};
    }});return q;
  }
  window.supabase={createClient:()=>({from:consulta,rpc:async(nombre,datos)=>{
    if(nombre!=='entrega_guardar')return {data:[],error:null};
    qa.rpc.push({nombre,datos:JSON.parse(JSON.stringify(datos))});
    if(qa.fallarEntrega){qa.fallarEntrega=false;return {data:null,error:{message:'No hay suficiente. Quedan 2 unidades.'}};}
    for(const x of datos.p_datos.items)lotes.find(l=>l.lote_id===x.lote_id).existencia-=x.cantidad;
    return {data:id(401),error:null};
  },auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},getUser:async()=>({data:{user:{id:id(1),email:'qa@example.invalid'}},error:null}),signOut:async()=>({error:null})}})};
}
const informe={fecha:new Date().toISOString(),publicado,alcance:'Interfaz completa con Auth y datos controlados; RPC de entrega simulada',escenarios:[]};
const escenarios=[['chrome','despacho',1440,'claro'],['chrome','despacho',375,'oscuro'],['msedge','despacho',320,'claro'],['msedge','admin',1440,'oscuro'],['chrome','inventario',375,'claro']];
for(const canal of ['chrome','msedge']){
  const browser=await chromium.launch({channel:canal,headless:true});
  try{for(const [c,rol,ancho,tema] of escenarios.filter(e=>e[0]===canal)){
    const ctx=await browser.newContext({viewport:{width:ancho,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
    const pagina=await ctx.newPage(),errores=[],nombre=[c,rol,ancho,tema].join('-');
    pagina.on('pageerror',e=>errores.push(e.message));
    await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.href.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:'('+sdk.toString()+')('+JSON.stringify(rol)+');'});
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
      await pagina.goto(origen+'/?prueba=entrega-lote');await pagina.waitForFunction(()=>window.FARMACIA_PERFIL?.rol);
      await pagina.evaluate(t=>window.FARMTEMA.poner(t),tema);
      if(rol==='inventario')await pagina.evaluate(()=>window.FARMIR('despacho'));
      else if(rol==='admin')await pagina.locator('[data-area="despacho"]').click();
      await pagina.locator('[data-modo="institucion"]').click();
      await pagina.locator('#zonaDestino .ficha').filter({hasText:'CENTRO SINTÉTICO QA'}).click();
      await pagina.locator('#recibeNombre').fill('Receptor de prueba');
      const busca=pagina.getByRole('searchbox',{name:'Buscar medicamento o lote'});
      async function buscar(q){await busca.fill(q);await busca.press('Enter');await pagina.waitForFunction(()=>!document.querySelector('#resMed .cargando'));}
      await buscar('231003');
      assert.match(await pagina.locator('#resMed').innerText(),/registrado en varios medicamentos/);
      const trim=pagina.locator('#resMed .ficha').filter({hasText:'TRIMETOPRIM'}),azi=pagina.locator('#resMed .ficha').filter({hasText:'AZITROMICINA'});
      assert(await trim.isEnabled());assert.match(await trim.innerText(),/1120/);assert(await azi.isDisabled());assert.match(await azi.innerText(),/SIN EXISTENCIA/);
      assert(!/Este lote no está disponible/.test(await pagina.locator('#resMed').innerText()));
      await trim.click();assert.equal(await pagina.locator('#renglones .cant').getAttribute('max'),'1120');
      assert.match(await pagina.locator('#renglones').innerText(),/TRIMETOPRIM.*231003/s);
      await pagina.locator('#renglones .ci-quitar').click();
      await pagina.screenshot({path:path.join(salida,nombre+'-compartido-entrega.png'),fullPage:true});
      await pagina.locator('#btnBuscarLoteFarmacia').click();
      const global=pagina.locator('#zonaLotesFarmacia'),filtro=global.getByRole('searchbox',{name:'Número de lote o medicamento'});
      await filtro.fill('231003');await filtro.press('Enter');
      await pagina.waitForFunction(()=>document.querySelector('#zonaLotesFarmacia [data-lm-resumen]')?.textContent.includes('2 lotes encontrados'));
      assert.match(await global.locator('[data-lm-resultados]').innerText(),/registrado en varios medicamentos/);
      const filas=global.locator('tbody tr');assert.equal(await filas.count(),2);
      assert.match(await filas.nth(0).innerText(),/TRIMETOPRIM/);assert.match(await filas.nth(0).locator('td').nth(4).innerText(),/1[.,]?120/);
      assert.match(await filas.nth(1).innerText(),/AZITROMICINA/);assert.equal(await filas.nth(1).locator('td').nth(4).innerText(),'0');
      assert(await pagina.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Aviso de lote compartido sin desbordamiento');
      await pagina.screenshot({path:path.join(salida,nombre+'-compartido-consulta.png'),fullPage:true});
      await pagina.locator('#btnVolverLotesFarmacia').click();
      await buscar('dl-454');assert.equal(await pagina.locator('#resMed .ficha').count(),1);assert.match(await pagina.locator('#resMed').innerText(),/Coincidencia exacta.*dl-454/s);
      await busca.focus();assert(await busca.evaluate(e=>e===document.activeElement));
      await pagina.keyboard.press('Tab');await pagina.keyboard.press('Enter');
      await pagina.locator('#renglones .cant').waitFor();assert.match(await pagina.locator('#renglones').innerText(),/DL-454/);
      assert.equal(await pagina.locator('#renglones .cant').getAttribute('max'),'8');
      await pagina.locator('#renglones .cant').fill('3');await pagina.locator('#renglones .cant').press('Tab');
      for(const [q,motivo]of [['VENCIDO','VENCIDO'],['500','SIN EXISTENCIA'],['BAJA','DADO DE BAJA']]){
        await buscar(q);assert.equal(await pagina.locator('#resMed .ficha').count(),1);assert(await pagina.locator('#resMed .ficha').isDisabled());assert.match(await pagina.locator('#resMed').innerText(),new RegExp(motivo));
      }
      await buscar('QA.(A)*_"%');assert.equal(await pagina.locator('#resMed .ficha').count(),1);assert.match(await pagina.locator('#resMed').innerText(),/Coincidencia exacta/);
      await buscar('medicamento');assert(await pagina.locator('#resMed .ficha').count()>=3,'Búsqueda por nombre conservada');
      await buscar('DL-');assert.equal(await pagina.locator('#resMed .ficha').count(),1,'Búsqueda parcial de lote');
      await pagina.evaluate(()=>window.QA_ENTREGA.lenta=true);
      await busca.fill('ANTERIOR');await busca.press('Enter');await busca.fill('dl-454');
      assert.equal(await pagina.locator('#resMed .ficha').count(),0,'Se retiran resultados antiguos al escribir');
      await busca.press('Enter');await pagina.waitForTimeout(800);assert.equal(await pagina.locator('#resMed .ficha').count(),1);assert.match(await pagina.locator('#resMed').innerText(),/DL-454/);
      await pagina.evaluate(()=>window.QA_ENTREGA.fallarConsulta=true);await buscar('ANTERIOR');
      await pagina.getByRole('button',{name:'Volver a buscar',exact:true}).click();await pagina.locator('#resMed .ficha[data-i]').waitFor();
      assert.match(await pagina.locator('#renglones').innerText(),/DL-454/,'Un fallo de consulta conserva el lote seleccionado');
      await buscar('dl-454');
      assert(await pagina.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sin desbordamiento horizontal');
      await pagina.screenshot({path:path.join(salida,nombre+'-lote.png'),fullPage:true});
      await pagina.locator('#recibeNombre').fill('Receptor de prueba');
      await pagina.evaluate(()=>window.QA_ENTREGA.fallarEntrega=true);
      await pagina.locator('#btnRegistrar').click();await pagina.waitForFunction(()=>document.querySelector('#zonaAviso')?.textContent.includes('No hay suficiente'));
      assert.match(await pagina.locator('#renglones').innerText(),/DL-454/);assert.equal(await pagina.locator('#renglones .cant').inputValue(),'3');
      await pagina.locator('#btnRegistrar').click();await pagina.waitForFunction(()=>window.QA_ENTREGA.lotes[1].existencia===5);
      const prueba=await pagina.evaluate(()=>window.QA_ENTREGA);
      assert.deepEqual(prueba.rpc.at(-1).datos.p_datos.items,[{lote_id:'00000000-0000-4000-8000-000000000102',cantidad:3}]);
      assert.equal(prueba.lotes[0].existencia,10);assert.equal(prueba.lotes[1].existencia,5);assert.equal(await pagina.locator('#renglones .cant').count(),0);
      assert.deepEqual(errores,[]);informe.escenarios.push({canal,rol,ancho,tema,loteExacto:true,loteCompartido:true,saldosPorMedicamento:true,descuentoDirigidoSimulado:true,bloqueados:true,errores:0});console.log('Correcto '+nombre);
    }catch(e){await pagina.screenshot({path:path.join(salida,nombre+'-fallo.png'),fullPage:true});throw e;}finally{await ctx.close();}
  }}finally{await browser.close();}
}
fs.writeFileSync(path.join(salida,'resultado.json'),JSON.stringify(informe,null,2));console.log(JSON.stringify({correctos:informe.escenarios.length,publicado,salida}));

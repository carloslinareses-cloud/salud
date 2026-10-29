import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const root=new URL('../',import.meta.url),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run']});
try {
  const page=await browser.newPage(),errores=[];
  page.on('pageerror',e=>errores.push(e.message));
  await page.setContent('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="zona"></main></body></html>');
  await page.addStyleTag({content:':root{--ink:#152035;--ink-soft:#344861;--line:#ced5df;--navy:#153756;--ok-ink:#176637}body{margin:16px;font:16px Arial,sans-serif}*{box-sizing:border-box}input,button{font:inherit}'});
  await page.addStyleTag({path:new URL('../consulta-medicamentos.css',import.meta.url).pathname.replace(/^\/(.:)/,'$1')});
  for(const nombre of ['consulta-medicamentos-datos.js','consulta-medicamentos-oms-datos.js','consulta-medicamentos-oms.js','consulta-medicamentos.js'])await page.addScriptTag({content:fs.readFileSync(new URL(nombre,root),'utf8')});
  await page.evaluate(()=>{
    window.FARMACIA_PERFIL={rol:'despacho'};
    const tabla={select(){return this},order(){return this},range(){return Promise.resolve({data:[],count:0})}};
    const sb={from(){return tabla},auth:{getSession:async()=>({data:{session:{access_token:'token-ficticio'}}})}};
    window.fetch=async(_url,opts)=>{
      const termino=JSON.parse(opts.body).medicamento;
      const base={origen:'referencias',aviso:'',reconocido:false,opciones:[],verificadoEn:'2026-10-29T00:00:00Z'};
      if(termino==='sin fuente')return Response.json({...base,externa:{estado:'no_disponible',coincidencias:[]}});
      if(termino==='diclofenac')return Response.json({...base,reconocido:true,externa:null,opciones:[{tipo:'clinica',producto:{nombre:'IBUPROFENO',dosificacion:'400 MG',presentacion:'TABLETA',vigente:2},ambitos:[{indicacion:'Dolor en adultos',restricciones:['Confirmar indicación'],fuente:'https://www.nhs.uk/medicines/diclofenac/'}]}]});
      return Response.json({...base,externa:{estado:'encontrado',coincidencias:[{nombre:'Amoxicilina de prueba',url:'https://rxnav.nlm.nih.gov/REST/rxcui/723/properties.json'}]}});
    };
    window.PANTALLA_CONSULTA_MEDICAMENTOS(sb,document.querySelector('#zona'),{prefijo:'prueba'});
  });
  async function buscar(termino){await page.$eval('#prueba-busca',(e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}))},termino);await page.click('[data-cm="buscar-ia"]');await page.waitForSelector('.cm-ia');}
  for(const [width,tema] of [[1280,'light'],[320,'light'],[320,'dark']]){
    await page.setViewport({width,height:900});
    await page.evaluate(t=>{document.documentElement.style.colorScheme=t;document.body.style.background=t==='dark'?'#111827':'#fff';document.documentElement.style.setProperty('--ink',t==='dark'?'#f4f6fb':'#152035');document.documentElement.style.setProperty('--ink-soft',t==='dark'?'#d2d8e4':'#344861')},tema);
    await buscar('marca desconocida');
    assert.match(await page.$eval('[data-cm="ia"]',e=>e.innerText),/no sustitutos ni prueba de existencia/);
    assert.equal(await page.$eval('[data-cm="ia"] a',e=>e.hostname),'rxnav.nlm.nih.gov');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Sin desbordamiento horizontal');
    await page.focus('[data-cm-nombre]');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-cm-nombre')),true);
    await page.keyboard.press('Enter');assert.equal(await page.$eval('#prueba-busca',e=>e.value),'Amoxicilina de prueba');
    assert.equal(await page.$eval('[data-cm="ia"]',e=>e.textContent),'');
  }
  await buscar('diclofenac');
  assert.equal(await page.$eval('.cm-ambito a',e=>e.hostname),'www.nhs.uk');
  await buscar('sin fuente');assert.match(await page.$eval('[data-cm="ia"]',e=>e.innerText),/No se pudo consultar RxNav/);
  assert.deepEqual(errores,[]);console.log('Consulta: fuentes, coincidencias, error, teclado y 3 vistas verificados');
} finally { await browser.close(); }

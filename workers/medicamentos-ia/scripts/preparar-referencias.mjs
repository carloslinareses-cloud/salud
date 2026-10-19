import fs from 'node:fs';import crypto from 'node:crypto';
const root=new URL('../../../',import.meta.url),destino=new URL('../generado/',import.meta.url);
const files=['consulta-medicamentos-datos.js','consulta-medicamentos-oms-datos.js','consulta-medicamentos-oms.js','consulta-medicamentos.js'];
const codigo=files.map(n=>fs.readFileSync(new URL(n,root),'utf8')).join('\n');
const reglas=files.map(n=>{const s=fs.readFileSync(new URL(n,root),'utf8');return n==='consulta-medicamentos.js'?s.slice(0,s.indexOf('  var montajes =')):s;}).join('\n');
const hash=crypto.createHash('sha256').update(reglas).digest('hex');
fs.mkdirSync(destino,{recursive:true});
fs.writeFileSync(new URL('referencias.mjs',destino),'// Generado desde las mismas reglas y fuentes que utiliza la web. No editar.\nconst window={};\n'+codigo+'\nexport const guia=window.GUIA_CONSULTA_MEDICAMENTOS;\nexport const oms=window.CONSULTA_OMS_MEDICAMENTOS;\nexport const consulta=window.CONSULTA_MEDICAMENTOS;\nexport const VERSION_FUENTES='+JSON.stringify(hash)+';\n');
console.log('Referencias compartidas preparadas: '+hash.slice(0,12));

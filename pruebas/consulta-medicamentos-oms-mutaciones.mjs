import cp from 'node:child_process';import assert from 'node:assert/strict';
const mutaciones=[
 {archivo:'consulta-medicamentos-oms.js',antes:'return g.base===m.id || g.alternativas.includes(m.id);',despues:'return true;'},
 {archivo:'consulta-medicamentos.js',antes:'!fechaValida(l.vence)',despues:'!l.vence'}
];
for(const m of mutaciones){
 const code=`import fs from 'node:fs';const leer=fs.readFileSync;let aplicado=false;fs.readFileSync=(p,...args)=>{const s=leer(p,...args);if(String(p).endsWith(${JSON.stringify(m.archivo)})){if(!s.includes(${JSON.stringify(m.antes)}))throw Error('Mutación no aplicada');aplicado=true;return s.replace(${JSON.stringify(m.antes)},${JSON.stringify(m.despues)});}return s;};try{await import('./pruebas/consulta-medicamentos-oms.mjs');process.exit(aplicado?0:2);}catch(e){process.exit(aplicado&&e.code==='ERR_ASSERTION'?17:2);}`;
 const r=cp.spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),windowsHide:true,encoding:'utf8'});
 assert.equal(r.status,17,'La prueba no detectó la mutación: '+m.archivo);console.log('✓ Detecto la mutación en memoria de '+m.archivo+'; sin modificar archivos ni datos');
}

import fs from 'node:fs/promises';
import { leerSecreto } from 'file:///C:/Users/carlo/Documents/admin-alcaldia/scripts/boveda.mjs';

if (!process.argv.includes('--aplicar')) throw new Error('Indica --aplicar para publicar las operaciones verificadas.');
const token = leerSecreto('supabase-alcaldia','sbp_token');
for (const nombre of ['41-inventario-operaciones-atomicas.sql','42-inventario-movimientos-concurrentes.sql','43-inventario-devoluciones.sql']) {
  const query = await fs.readFile(new URL('../sql/'+nombre,import.meta.url),'utf8');
  const r = await fetch('https://api.supabase.com/v1/projects/tfbzghjjfcaqmkzsxrrs/database/query', {
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})
  });
  const j=await r.json(); if (!r.ok) throw new Error(j.message || nombre);
  console.log(nombre+': aplicado.');
}

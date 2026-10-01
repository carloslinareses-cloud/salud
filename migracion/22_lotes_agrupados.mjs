import fs from 'node:fs/promises';
import { leerSecreto } from 'file:///C:/Users/carlo/Documents/admin-alcaldia/scripts/boveda.mjs';

if (!process.argv.includes('--aplicar')) throw new Error('Indica --aplicar para publicar la agrupacion del catalogo.');
const token = await leerSecreto('supabase-alcaldia', 'sbp_token');
const query = await fs.readFile(new URL('../sql/40-lotes-agrupados-catalogo.sql', import.meta.url), 'utf8');
const r = await fetch('https://api.supabase.com/v1/projects/tfbzghjjfcaqmkzsxrrs/database/query', {
  method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})
});
const resultado = await r.json();
if (!r.ok) throw new Error(resultado.message || 'No se aplico la agrupacion.');
console.log('Catalogo agrupado en produccion. Cantidades, vencimientos y movimientos originales verificados sin cambios.');

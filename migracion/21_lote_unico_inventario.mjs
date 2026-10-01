/* Aplico el control global de lotes o pruebo ambos perfiles con reversión. */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { leerSecreto } from 'file:///C:/Users/carlo/Documents/admin-alcaldia/scripts/boveda.mjs';
const token = leerSecreto('supabase-alcaldia', 'sbp_token');
if (!token) throw new Error('No hay acceso administrativo disponible');
async function consultar(query) {
  const r = await fetch('https://api.supabase.com/v1/projects/tfbzghjjfcaqmkzsxrrs/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const resultado = await r.json();
  if (!r.ok) throw new Error('Consulta rechazada: ' + JSON.stringify(resultado));
  return resultado;
}
if (process.argv.includes('--aplicar')) {
  let sql = fs.readFileSync(new URL('../sql/39-lote-unico-inventario.sql', import.meta.url), 'utf8');
  const huella = "select md5(coalesce(string_agg(row_to_json(l)::text, '' order by id),'')) from farmacia.lotes l";
  sql = sql.replace('create or replace function farmacia.normalizar_codigo_lote',
    `create temp table lotes_antes on commit drop as ${huella};\ncreate or replace function farmacia.normalizar_codigo_lote`);
  sql = sql.replace('commit;', () => `do $$ begin if (select md5 from lotes_antes) is distinct from (${huella}) then raise exception 'Los lotes anteriores cambiaron'; end if; end $$;\ncommit;`);
  await consultar(sql);
  console.log('Control global publicado; lotes anteriores conservados íntegramente.');
}
if (process.argv.includes('--probar')) {
  const resultado = await consultar(fs.readFileSync(new URL('../pruebas/lote-unico-inventario.sql', import.meta.url), 'utf8'));
  if (resultado.length !== 16 || resultado.some(x => x.correcto !== true)) throw new Error('Pruebas incompletas');
  console.log('16 casos reales correctos para Administración e Inventario; datos de prueba revertidos.');
}
if (process.argv.includes('--probar-concurrencia')) {
  const ids = [randomUUID(), randomUUID()], codigo = 'PRUEBA-CONCURRENCIA-' + randomUUID();
  try {
    const resultados = await Promise.allSettled(ids.map(id => consultar(`begin;
      insert into farmacia.lotes(id,producto_id,codigo,vence)
      select '${id}',id,'${codigo}','2030-01-01' from farmacia.productos limit 1;
      select pg_sleep(0.4); commit;`)));
    if (resultados.filter(x => x.status === 'fulfilled').length !== 1 ||
        resultados.filter(x => x.status === 'rejected' && /lote ya está registrado/.test(x.reason.message)).length !== 1) {
      throw new Error('El control concurrente no bloqueó exactamente una entrada');
    }
    console.log('Dos registros simultáneos: uno permitido y el repetido bloqueado.');
  } finally {
    const idsSql = ids.map(id => "'" + id + "'").join(',');
    await consultar(`delete from farmacia.lotes where id in (${idsSql});`);
    const restantes = await consultar(`select count(*)::int cantidad from farmacia.lotes where id in (${idsSql});`);
    if (restantes[0]?.cantidad !== 0) throw new Error('Quedaron lotes de prueba');
    console.log('Lotes de concurrencia retirados y ausencia comprobada.');
  }
}
if (!process.argv.some(x => ['--aplicar', '--probar', '--probar-concurrencia'].includes(x))) throw new Error('Usa --aplicar, --probar o --probar-concurrencia');

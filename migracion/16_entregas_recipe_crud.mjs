/* Aplica la función transaccional de entregas con récipe.
   El token se lee de la bóveda de Windows en el momento de usarlo.
   Uso: node migracion/16_entregas_recipe_crud.mjs [--aplicar]
   Sin --aplicar solo comprueba el acceso y el esquema actual. */
import { readFileSync } from 'node:fs';
import { leerSecreto } from '../../admin-alcaldia/scripts/boveda.mjs';

const token = leerSecreto('supabase-alcaldia', 'sbp_token');
if (!token) throw new Error('No está disponible el acceso de Supabase de la Alcaldía.');
const endpoint = 'https://api.supabase.com/v1/projects/tfbzghjjfcaqmkzsxrrs/database/query';
async function sql(query) {
  const respuesta = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error('Supabase rechazó la consulta (HTTP ' + respuesta.status +
    '): ' + (datos && datos.message || 'sin detalle'));
  return datos;
}
const actual = await sql("select to_regclass('farmacia.entregas') is not null as entregas, " +
  "to_regclass('farmacia.solicitudes') is not null as solicitudes, " +
  "to_regclass('farmacia.movimientos') is not null as movimientos");
if (!actual[0]?.entregas || !actual[0]?.solicitudes || !actual[0]?.movimientos) {
  throw new Error('Falta una tabla necesaria. No se aplicó nada.');
}
console.log('Acceso y tablas necesarios: verificados.');
if (process.argv.includes('--aplicar')) {
  await sql(readFileSync(new URL('../sql/33-entregas-recipe-crud.sql', import.meta.url), 'utf8'));
  const despues = await sql("select count(*)::int as funciones from pg_proc p join pg_namespace n " +
    "on n.oid = p.pronamespace where n.nspname = 'farmacia' and p.proname in " +
    "('entrega_guardar','entrega_anular')");
  if (despues[0]?.funciones !== 2) throw new Error('No aparecieron las dos funciones nuevas.');
  console.log('Funciones y esquema de entregas: aplicados y verificados.');
}
if (process.argv.includes('--probar') || process.argv.includes('--probar-inventario')) {
  let prueba = readFileSync(new URL('../pruebas/entregas-recipe-crud.sql', import.meta.url), 'utf8');
  if (process.argv.includes('--probar-inventario')) prueba = prueba.replace("rol = 'admin'", "rol = 'inventario'");
  await sql(prueba);
  const restos = await sql("select count(*)::int as n from farmacia.pacientes " +
    "where nombre in ('ZZZ PRUEBA CRUD RÉCIPE', 'ZZZ PRUEBA OTRA PERSONA')");
  if (restos[0]?.n !== 0) throw new Error('La prueba dejó pacientes temporales; revisa la base.');
  console.log('Alta, corrección, anulación y rechazo de récipe ajeno: verificados; prueba revertida' +
    (process.argv.includes('--probar-inventario') ? ' con rol Inventario.' : ' con rol Administración.'));
}

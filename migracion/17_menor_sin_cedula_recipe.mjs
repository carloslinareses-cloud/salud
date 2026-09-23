/* Comprueba el acceso y aplica el registro de menores con récipe.
   El secreto se obtiene de la bóveda local; nunca se escribe en el repositorio.
   Uso: node migracion/17_menor_sin_cedula_recipe.mjs [--aplicar] */
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

const antes = await sql("select to_regclass('farmacia.pacientes') is not null as pacientes, " +
  "to_regclass('farmacia.solicitudes') is not null as solicitudes");
if (!antes[0]?.pacientes || !antes[0]?.solicitudes) {
  throw new Error('Falta una tabla necesaria. No se aplicó nada.');
}
console.log('Acceso y tablas necesarios: verificados.');
if (process.argv.includes('--aplicar')) {
  await sql(readFileSync(new URL('../sql/34-menor-sin-cedula-recipe.sql', import.meta.url), 'utf8'));
  const despues = await sql("select count(*)::int as columnas from information_schema.columns " +
    "where table_schema = 'farmacia' and table_name = 'solicitudes' and column_name in " +
    "('menor_sin_cedula', 'representante_nombre', 'representante_cedula', 'representante_telefono')");
  const funcion = await sql("select to_regprocedure('farmacia.registrar_menor_recipe(jsonb)') is not null as existe");
  if (despues[0]?.columnas !== 4 || !funcion[0]?.existe) {
    throw new Error('El esquema quedó incompleto. Revisa Supabase antes de publicar.');
  }
  console.log('Campos del representante y registro conjunto del menor: aplicados y verificados.');
}
if (process.argv.includes('--probar')) {
  await sql(readFileSync(new URL('../pruebas/menor-sin-cedula-recipe.sql', import.meta.url), 'utf8'));
  const restos = await sql("select count(*)::int as n from farmacia.pacientes " +
    "where nombre in ('ZZZ REPRESENTANTE DE PRUEBA', 'ZZZ MENOR DE PRUEBA')");
  if (restos[0]?.n !== 0) throw new Error('La prueba dejó pacientes temporales; revisa la base.');
  console.log('Paciente menor, contacto independiente y entrega al menor: verificados; prueba revertida.');
}

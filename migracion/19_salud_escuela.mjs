/* Aplica el tipo y los campos de Salud a la Escuela antes de publicar la pantalla.
   Lee el token de la bóveda local; nunca lo guarda ni lo muestra. */
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

if (process.argv.includes('--aplicar')) {
  await sql(readFileSync(new URL('../sql/36-salud-escuela.sql', import.meta.url), 'utf8'));
}
const estado = await sql("select count(*)::int as columnas from information_schema.columns " +
  "where table_schema = 'farmacia' and table_name = 'jornadas_registros' " +
  "and column_name in ('representante_nombre','representante_cedula','comuna','comunidad','plantel','seccion')");
if (estado[0]?.columnas !== 6) throw new Error('Faltan columnas de Salud a la Escuela.');
const tipos = await sql("select conname, pg_get_constraintdef(oid) as definicion from pg_constraint " +
  "where conrelid in ('farmacia.jornadas_eventos'::regclass,'farmacia.jornadas_registros'::regclass) " +
  "and conname in ('jornadas_eventos_tipo_check','jornadas_registros_conjunto_check')");
if (tipos.length !== 2 || tipos.some(t => !t.definicion.includes('salud_escuela')))
  throw new Error('Falta admitir el tipo Salud a la Escuela.');
console.log('Tipo y seis campos de Salud a la Escuela: verificados.');
if (process.argv.includes('--probar')) {
  await sql(readFileSync(new URL('../pruebas/salud-escuela.sql', import.meta.url), 'utf8'));
  const restos = await sql("select count(*)::int as n from farmacia.jornadas_eventos " +
    "where lugar = 'ZZZ PRUEBA SALUD ESCUELA'");
  if (restos[0]?.n) throw new Error('La prueba dejó un evento temporal.');
  console.log('Registro escolar completo: comprobado y revertido.');
}

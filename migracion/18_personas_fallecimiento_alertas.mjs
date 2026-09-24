/* Aplica y comprueba las alertas de retiro y el estado vital de Personas.
   El token se lee de la bóveda local; no se guarda en archivos.
   Uso: node migracion/18_personas_fallecimiento_alertas.mjs [--aplicar] [--probar] */
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
  "to_regclass('farmacia.entregas') is not null as entregas, " +
  "to_regclass('farmacia.tratamientos_paciente') is not null as tratamientos");
if (!antes[0]?.pacientes || !antes[0]?.entregas || !antes[0]?.tratamientos) {
  throw new Error('Falta una tabla necesaria. No se aplicó nada.');
}
console.log('Acceso y tablas necesarios: verificados.');

if (process.argv.includes('--aplicar')) {
  await sql(readFileSync(new URL('../sql/35-personas-fallecimiento-alertas-retiro.sql', import.meta.url), 'utf8'));
  const despues = await sql("select to_regclass('farmacia.v_alertas_retiro') is not null as alertas, " +
    "to_regprocedure('farmacia.marcar_estado_vital(uuid,boolean,text)') is not null as vital, " +
    "to_regprocedure('farmacia.resolver_alerta_retiro(uuid,boolean,text)') is not null as resolver");
  if (!despues[0]?.alertas || !despues[0]?.vital || !despues[0]?.resolver) {
    throw new Error('El esquema quedó incompleto. Revisa Supabase antes de publicar.');
  }
  console.log('Estado vital, alertas y permisos: aplicados y verificados.');
}
if (process.argv.includes('--probar')) {
  await sql(readFileSync(new URL('../pruebas/personas-fallecimiento-alertas.sql', import.meta.url), 'utf8'));
  const restos = await sql("select count(*)::int as n from farmacia.pacientes " +
    "where nombre like 'ZZZ PRUEBA ALERTA RETIRO %'");
  if (restos[0]?.n) throw new Error('La prueba dejó pacientes temporales; revisa la base.');
  console.log('Alertas y estado vital para Inventario y Administración; bloqueo a Despacho verificado; prueba revertida.');
}

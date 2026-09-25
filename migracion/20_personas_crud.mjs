/* Aplica y verifica el retiro, eliminación y reactivación de Personas.
   El token administrativo se lee de la bóveda local; no se muestra ni guarda. */
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

const base = await sql("select to_regclass('farmacia.pacientes') is not null as pacientes, " +
  "to_regclass('farmacia.entregas') is not null as entregas, " +
  "to_regclass('farmacia.movimientos') is not null as movimientos");
if (!base[0]?.pacientes || !base[0]?.entregas || !base[0]?.movimientos) {
  throw new Error('Faltan tablas necesarias. No se aplicó nada.');
}
console.log('Acceso y tablas necesarios: verificados.');

if (process.argv.includes('--aplicar')) {
  await sql(readFileSync(new URL('../sql/37-personas-crud.sql', import.meta.url), 'utf8'));
  const despues = await sql("select " +
    "to_regprocedure('farmacia.persona_resumen_retiro(uuid)') is not null as resumen, " +
    "to_regprocedure('farmacia.persona_retirar(uuid,text,text,text)') is not null as retirar, " +
    "to_regprocedure('farmacia.persona_reactivar(uuid,text)') is not null as reactivar");
  if (!despues[0]?.resumen || !despues[0]?.retirar || !despues[0]?.reactivar) {
    throw new Error('Las funciones no quedaron completas; no publiques la pantalla.');
  }
  const permisos = await sql("select has_table_privilege('authenticated', 'farmacia.pacientes', 'DELETE') as borrado_directo");
  if (permisos[0]?.borrado_directo) {
    throw new Error('El borrado directo de pacientes sigue habilitado; no publiques la pantalla.');
  }
  console.log('Funciones y permisos de Personas: aplicados y verificados.');
}
if (process.argv.includes('--probar')) {
  await sql(readFileSync(new URL('../pruebas/personas-crud.sql', import.meta.url), 'utf8'));
  const restos = await sql("select count(*)::int as n from farmacia.pacientes " +
    "where nombre like 'ZZZ PRUEBA CRUD PERSONAS %'");
  if (restos[0]?.n) throw new Error('La prueba dejó personas temporales en la base.');
  console.log('Eliminación segura, desactivación, reactivación y permisos: verificados sin dejar datos de prueba.');
}

/* ASISTENCIA: la clave que el admin escribe al crear a alguien SÍ se aplica.

   1. Reemplaza farmacia.asis_admin_crear_personal: si la cédula ya
      existía, antes actualizaba nombre y teléfono pero dejaba la clave
      vieja, sin avisar. Ahora aplica la clave nueva y vuelve a pedir
      cambiarla al entrar.

   2. Pone la clave temporal a las cuentas que TODAVÍA no han cambiado
      la suya (debe_cambiar_clave = true). Las que ya eligieron su
      propia clave no se tocan.

   La clave temporal NO va escrita aquí: el repositorio es público.

       export SUPABASE_TOKEN=sbp_...
       export CLAVE_TEMPORAL=...
       node migracion/13_asistencia_clave_inicial.mjs             (solo mira)
       node migracion/13_asistencia_clave_inicial.mjs --aplicar   (escribe)
*/
const REF = 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
const CLAVE = process.env.CLAVE_TEMPORAL
const APLICAR = process.argv.includes('--aplicar')
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }
if (!CLAVE || CLAVE.length < 6) { console.error('Falta CLAVE_TEMPORAL (6 caracteres o más).'); process.exit(2) }

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(t.slice(0, 500))
  try { return JSON.parse(t) } catch { return [] }
}
const comilla = (t) => "'" + String(t).replace(/'/g, "''") + "'"

const antes = await sql(`select cedula, nombre, debe_cambiar_clave,
  (clave_hash = extensions.crypt(${comilla(CLAVE)}, clave_hash)) as ya_tiene_la_temporal
  from farmacia.asistencia_personal order by nombre;`)
console.log('Cuentas:')
antes.forEach((x) => console.log(`  ${x.nombre.padEnd(24)} cambiar=${x.debe_cambiar_clave}  ya_tiene_temporal=${x.ya_tiene_la_temporal}`))

const aResetear = antes.filter((x) => x.debe_cambiar_clave)
console.log(`\nSe les pone la clave temporal a ${aResetear.length} (las que no han elegido la suya).`)
console.log(`No se tocan ${antes.length - aResetear.length} (ya eligieron su clave).`)

if (!APLICAR) { console.log('\nNada se escribió. Usa --aplicar.'); process.exit(0) }

await sql(`
create or replace function farmacia.asis_admin_crear_personal(
  p_cedula text, p_nombre text, p_telefono text, p_correo text, p_clave_inicial text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.es_admin() then
    raise exception 'Solo un administrador puede crear personal de asistencia.';
  end if;
  if length(p_clave_inicial) < 6 then
    raise exception 'La clave inicial debe tener al menos 6 caracteres.';
  end if;
  insert into farmacia.asistencia_personal (cedula, nombre, telefono, correo, clave_hash, debe_cambiar_clave, activo)
  values (regexp_replace(p_cedula, '\\D', '', 'g'), p_nombre, p_telefono, p_correo,
          extensions.crypt(p_clave_inicial, extensions.gen_salt('bf')), true, true)
  on conflict (cedula) do update set
    nombre = excluded.nombre, telefono = excluded.telefono, correo = excluded.correo,
    clave_hash = excluded.clave_hash, debe_cambiar_clave = true,
    activo = true, actualizado_en = now();
  return true;
end $$;`)
console.log('\nFunción asis_admin_crear_personal reemplazada.')

await sql(`update farmacia.asistencia_personal
   set clave_hash = extensions.crypt(${comilla(CLAVE)}, extensions.gen_salt('bf')),
       debe_cambiar_clave = true, actualizado_en = now()
 where debe_cambiar_clave;`)

const despues = await sql(`select nombre, debe_cambiar_clave,
  (clave_hash = extensions.crypt(${comilla(CLAVE)}, clave_hash)) as entra_con_temporal
  from farmacia.asistencia_personal order by nombre;`)
console.log('\nDespués:')
despues.forEach((x) => console.log(`  ${x.nombre.padEnd(24)} entra_con_temporal=${x.entra_con_temporal}  cambiar=${x.debe_cambiar_clave}`))

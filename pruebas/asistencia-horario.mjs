/* ASISTENCIA: salida libre y fin de semana libre (sql/30-asistencia-horario-libre.sql).

   Corre el archivo SQL TAL CUAL dentro de una transacción que se deshace
   sola al final (nada queda en la base), y comprueba:
     · la regla del horario con días y horas fijos (lunes, viernes, sábado,
       domingo, los bordes 6:59 / 8:45 / 8:46, y el cambio de día entre la
       hora de Venezuela y la hora universal);
     · a qué jornada le toca la salida, incluida la de después de medianoche
       y el tope de 18 horas;
     · marcar la salida de verdad (con la función que usa la app) cierra la
       jornada de anoche y no crea otra.
   Sirve para ensayar el cambio ANTES de aplicarlo en producción.

       node pruebas/asistencia-horario.mjs              corre las pruebas
       node pruebas/asistencia-horario.mjs --mutantes   rompe la regla y exige que se note

   Token de Supabase: SUPABASE_TOKEN, o la bóveda de Windows (supabase-alcaldia/sbp_token). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ARCHIVO = path.join(AQUI, '..', 'sql', '30-asistencia-horario-libre.sql')
const REF = 'tfbzghjjfcaqmkzsxrrs'
let TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) {
  try { TOKEN = (await import('file:///C:/Users/carlo/Documents/admin-alcaldia/scripts/boveda.mjs')).leerSecreto('supabase-alcaldia', 'sbp_token') } catch { TOKEN = null }
}
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }

/* Cada prueba: [nombre, expresión SQL que da true si está bien, expresión que se muestra si falla]. */
const V = (tipo, momento, cfg) => `farmacia.asis_problema_ventana('${tipo}', '${momento}'::timestamptz, ${cfg})`
const PRUEBAS_REGLA = [
  ['lunes 7:30: la entrada se puede', `${V('entrada', '2026-09-21 07:30-04', 'c1')} is null`],
  ['lunes 6:59: la entrada todavía no', `${V('entrada', '2026-09-21 06:59-04', 'c1')} like '%de 07:00 AM a 08:45 AM, de lunes a viernes%'`],
  ['lunes 8:45 en punto: la entrada se puede (borde)', `${V('entrada', '2026-09-21 08:45-04', 'c1')} is null`],
  ['lunes 8:46: la entrada ya no', `${V('entrada', '2026-09-21 08:46-04', 'c1')} like 'Fuera del horario permitido para marcar la entrada%'`],
  ['lunes 12:00: la salida es libre', `${V('salida', '2026-09-21 12:00-04', 'c1')} is null`],
  ['lunes 23:59: la salida es libre', `${V('salida', '2026-09-21 23:59-04', 'c1')} is null`],
  ['viernes 20:00: la entrada no (el viernes es día de semana)', `${V('entrada', '2026-09-25 20:00-04', 'c1')} is not null`],
  ['sábado 3:00: la entrada es libre', `${V('entrada', '2026-09-26 03:00-04', 'c1')} is null`],
  ['domingo 13:00: la entrada es libre', `${V('entrada', '2026-09-27 13:00-04', 'c1')} is null`],
  ['domingo 22:00: la salida es libre', `${V('salida', '2026-09-27 22:00-04', 'c1')} is null`],
  ['lunes 21:00 en Venezuela (ya martes en hora universal): la entrada no', `${V('entrada', '2026-09-22 01:00+00', 'c1')} is not null`],
  ['domingo 22:00 en Venezuela (ya lunes en hora universal): la entrada es libre', `${V('entrada', '2026-09-21 02:00+00', 'c1')} is null`],
  ['viernes 23:30 en Venezuela (ya sábado en hora universal): la entrada no', `${V('entrada', '2026-09-26 03:30+00', 'c1')} is not null`],
  ['con la salida NO libre, lunes 12:00 la salida no', `${V('salida', '2026-09-21 12:00-04', 'c2')} like '%de 04:30 PM a 06:30 PM, de lunes a viernes%'`],
  ['con la salida NO libre, lunes 17:00 la salida sí', `${V('salida', '2026-09-21 17:00-04', 'c2')} is null`],
  ['sin fin de semana libre, sábado 10:00 la entrada no (y no dice "de lunes a viernes")',
    `${V('entrada', '2026-09-26 10:00-04', 'c3')} like '%(de 07:00 AM a 08:45 AM).'`],
  ['sin fin de semana libre, sábado 7:30 la entrada sí', `${V('entrada', '2026-09-26 07:30-04', 'c3')} is null`],
  ['sin configuración, no se bloquea nada', `${V('entrada', '2026-09-21 03:00-04', 'null::farmacia.config_asistencia')} is null`],
]

function armar(sqlArchivo) {
  const pruebas = PRUEBAS_REGLA.map(([n, e]) => `r := r || jsonb_build_object('n', ${lit(n)}, 'ok', coalesce((${e}), false));`).join('\n  ')
  return `begin;
${sqlArchivo}
do $$
declare
  r  jsonb := '[]'::jsonb;
  c1 farmacia.config_asistencia;  -- como quedó pedido: salida libre y fin de semana libre
  c2 farmacia.config_asistencia;  -- salida con horario
  c3 farmacia.config_asistencia;  -- todo con horario, también el fin de semana
  hoy date := (timezone('America/Caracas', now()))::date;
  f  farmacia.asistencia_registros;
  e  text;
  n  int;
begin
  select * into c1 from farmacia.config_asistencia where id = 1;
  c1.entrada_desde := '07:00'; c1.entrada_hasta := '08:45'; c1.salida_desde := '16:30'; c1.salida_hasta := '18:30';
  c1.salida_libre := true; c1.fin_de_semana_libre := true;
  c2 := c1; c2.salida_libre := false;
  c3 := c2; c3.fin_de_semana_libre := false;
  ${pruebas}

  -- Personas de mentira (todo se deshace al final).
  insert into farmacia.asistencia_personal (cedula, nombre, clave_hash)
  select '99900010' || g, 'ZZ PRUEBA HORARIO ' || g, 'x' from generate_series(1, 8) g;
  update farmacia.config_asistencia set salida_libre = true, fin_de_semana_libre = true, exigir_gps = false where id = 1;

  -- 1: entró ayer hace 5 horas y no ha salido; hoy no tiene fila.
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000101', hoy - 1, now() - interval '5 hours');
  f := farmacia.asis_registro_para_salida('999000101', now());
  r := r || jsonb_build_object('n', 'después de medianoche le toca la jornada de anoche', 'ok', f.fecha = hoy - 1);
  f := farmacia.asis_estado_hoy('999000101');
  r := r || jsonb_build_object('n', 'la app ve esa jornada abierta (para ofrecer "Marcar salida")', 'ok', f.fecha = hoy - 1 and f.hora_salida is null);
  f := farmacia.asis_marcar_salida('999000101');
  select count(*) into n from farmacia.asistencia_registros where cedula = '999000101';
  r := r || jsonb_build_object('n', 'marcar la salida cierra la de anoche y no crea otra fila', 'ok', f.fecha = hoy - 1 and f.hora_salida is not null and n = 1);

  -- 2: entró ayer hace 20 horas (más de 18): no se le cierra.
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000102', hoy - 1, now() - interval '20 hours');
  f := farmacia.asis_registro_para_salida('999000102', now());
  r := r || jsonb_build_object('n', 'con más de 18 horas no le toca ninguna jornada', 'ok', f.id is null);
  begin
    perform farmacia.asis_marcar_salida('999000102'); e := null;
  exception when others then e := sqlerrm;
  end;
  r := r || jsonb_build_object('n', 'y marcar la salida lo dice claro', 'ok', e = 'No hay marca de entrada de hoy para completar la salida.', 'dio', e);

  -- 3: la de ayer ya está cerrada.
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada, hora_salida) values ('999000103', hoy - 1, now() - interval '6 hours', now() - interval '1 hour');
  f := farmacia.asis_registro_para_salida('999000103', now());
  r := r || jsonb_build_object('n', 'una jornada de ayer ya cerrada no se vuelve a tocar', 'ok', f.id is null);

  -- 4: tiene jornada hoy y además una abierta de ayer: manda la de hoy.
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000104', hoy - 1, now() - interval '5 hours');
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000104', hoy, now() - interval '1 hour');
  f := farmacia.asis_registro_para_salida('999000104', now());
  r := r || jsonb_build_object('n', 'si hay jornada de hoy, la salida es de la de hoy', 'ok', f.fecha = hoy);

  -- 5: con la salida NO libre, lo de anoche no se ofrece.
  update farmacia.config_asistencia set salida_libre = false where id = 1;
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000105', hoy - 1, now() - interval '5 hours');
  f := farmacia.asis_registro_para_salida('999000105', now());
  r := r || jsonb_build_object('n', 'con la salida con horario, lo de anoche no se ofrece', 'ok', f.id is null);
  update farmacia.config_asistencia set salida_libre = true where id = 1;

  -- 6: el tope de 18 horas con momentos fijos (entró lunes 7:30).
  insert into farmacia.asistencia_registros (cedula, fecha, hora_entrada) values ('999000106', '2026-09-21', '2026-09-21 07:30-04');
  f := farmacia.asis_registro_para_salida('999000106', '2026-09-22 01:00-04');
  r := r || jsonb_build_object('n', 'martes 1:00 (17 h 30 min después): le toca la del lunes', 'ok', f.fecha = '2026-09-21'::date);
  f := farmacia.asis_registro_para_salida('999000106', '2026-09-22 02:00-04');
  r := r || jsonb_build_object('n', 'martes 2:00 (18 h 30 min después): ya no', 'ok', f.id is null);
  f := farmacia.asis_registro_para_salida('999000106', '2026-09-22 00:30+00');
  r := r || jsonb_build_object('n', 'el "ayer" se cuenta en hora de Venezuela (lunes 20:30 = mismo día)', 'ok', f.fecha = '2026-09-21'::date);

  -- 7: la app de hoy, sin nada: no ve ninguna jornada.
  f := farmacia.asis_estado_hoy('999000107');
  r := r || jsonb_build_object('n', 'quien no ha marcado nada no ve ninguna jornada', 'ok', f.id is null);

  -- 8: permisos: la app (anon) no puede llamar las funciones internas.
  r := r || jsonb_build_object('n', 'la app no puede llamar las funciones internas nuevas', 'ok',
    not has_function_privilege('anon', 'farmacia.asis_problema_ventana(text, timestamptz, farmacia.config_asistencia)', 'execute')
    and not has_function_privilege('anon', 'farmacia.asis_registro_para_salida(text, timestamptz)', 'execute')
    and has_function_privilege('anon', 'farmacia.asis_marcar_salida(text, double precision, double precision, text, double precision)', 'execute')
    and has_function_privilege('anon', 'farmacia.asis_estado_hoy(text)', 'execute'));
  r := r || jsonb_build_object('n', 'el panel puede leer y cambiar los dos interruptores', 'ok',
    has_column_privilege('authenticated', 'farmacia.config_asistencia', 'salida_libre', 'update')
    and has_column_privilege('authenticated', 'farmacia.config_asistencia', 'fin_de_semana_libre', 'select'));

  raise exception 'RESULTADOS%', r::text;
end $$;`
}
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'" }

async function correr(sqlArchivo) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: armar(sqlArchivo) })
  })
  const t = await res.text()
  let msg = t
  try { const j = JSON.parse(t); msg = j.message || (Array.isArray(j) ? '(la consulta terminó sin el resultado esperado)' : t) } catch { /* texto plano */ }
  const i = msg.indexOf('RESULTADOS[')
  if (i < 0) return { error: String(msg).slice(0, 800) }
  const cola = msg.slice(i + 'RESULTADOS'.length)
  const fin = cola.indexOf('\nCONTEXT')
  return { resultados: JSON.parse((fin >= 0 ? cola.slice(0, fin) : cola).trim()) }
}

const SQL = fs.readFileSync(ARCHIVO, 'utf8')

async function mutantes() {
  const MUT = [
    ['el fin de semana no es libre', 'if coalesce(p_config.fin_de_semana_libre, false) and v_dia in (6, 7) then', 'if false then'],
    ['el domingo se cuenta mal (dow en vez de isodow)', "extract(isodow from v_local)", "extract(dow from v_local)"],
    ['la salida tiene horario aunque sea libre', "    if coalesce(p_config.salida_libre, false) then\n      return null;\n    end if;\n", ''],
    ['el día se toma en hora universal', "v_local timestamp := timezone('America/Caracas', p_momento);", "v_local timestamp := timezone('UTC', p_momento);"],
    ['el tope de 18 horas se agranda', "interval '18 hours'", "interval '48 hours'"],
    ['se vuelve a cerrar una jornada ya cerrada', "and hora_entrada is not null and hora_salida is null", "and hora_entrada is not null"],
    ['la salida se busca solo en la fila de hoy (como antes)', "   where id = v_jornada.id", "   where cedula = v_cedula and fecha = (timezone('America/Caracas', now()))::date"],
    ['la app no ve la jornada de anoche', "select * from farmacia.asis_registro_para_salida(p_cedula, now()) r where r.id is not null",
      "select * from farmacia.asistencia_registros where cedula = regexp_replace(p_cedula, '\\D', '', 'g') and fecha = (timezone('America/Caracas', now()))::date"],
    ['la app puede llamar la regla interna', "revoke all on function farmacia.asis_problema_ventana(text, timestamptz, farmacia.config_asistencia) from public, anon, authenticated;", ''],
    ['el borde de las 8:45 queda fuera', 'if v_hora < v_desde or v_hora > v_hasta then', 'if v_hora < v_desde or v_hora >= v_hasta then'],
  ]
  let vivos = 0
  for (const [nombre, a, b] of MUT) {
    if (SQL.replace(/\r\n/g, '\n').split(a).length !== 2) { console.log(`  ? ${nombre}: no encontré el texto`); vivos++; continue }
    const r = await correr(SQL.replace(/\r\n/g, '\n').replace(a, b))
    const notada = !!r.error || r.resultados.some(x => !x.ok)
    if (!notada) vivos++
    console.log(`  ${notada ? '✓' : '✗'} ${nombre}: ${notada ? 'detectado' : '¡NADIE LO NOTÓ!'}`)
  }
  console.log(`\nmutantes vivos: ${vivos}`)
  process.exitCode = vivos ? 1 : 0
}

async function principal() {
  const r = await correr(SQL)
  if (r.error) { console.log('✗ el ensayo no corrió:', r.error); process.exitCode = 1; return }
  let mal = 0
  for (const x of r.resultados) { if (!x.ok) mal++; console.log(`  ${x.ok ? '✓' : '✗'} ${x.n}${!x.ok && x.dio ? ' → ' + x.dio : ''}`) }
  console.log(`\n${mal ? '✗' : '✓'} ${r.resultados.length - mal} bien, ${mal} mal (todo se deshizo: la base no cambió)`)
  process.exitCode = mal ? 1 : 0
}

/* Se deja terminar solo (process.exitCode): con process.exit, Node en Windows
   a veces revienta al cerrar las conexiones y la salida no dice la verdad. */
await (process.argv.includes('--mutantes') ? mutantes() : principal())

/* CONTROL DE INSUMOS: LOS PERMISOS, PROBADOS EN LA BASE DE VERDAD SIN DEJAR NADA.

   Se hace pasar por un usuario de cada rol (despacho, inventario,
   administrador y el público) y comprueba qué puede y qué no. Cada
   intento corre dentro de una sub-transacción que se DESHACE al final:
   aunque un candado estuviera roto, no queda nada escrito.

   Todo lo que se crea para probar empieza por ZZZ.

       export SUPABASE_TOKEN=sbp_...
       node pruebas/insumos-control-permisos.mjs
*/
const REF = 'tfbzghjjfcaqmkzsxrrs'
const TOKEN = process.env.SUPABASE_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_TOKEN.'); process.exit(2) }

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const t = await r.text()
  if (r.status >= 300) throw new Error(t.slice(0, 800))
  return JSON.parse(t)
}

let ok = 0, mal = 0
const prueba = (n, c, d = '') => { if (c) { ok++; console.log('  OK    ' + n) } else { mal++; console.log('  FALLA ' + n + '   ' + d) } }

const ids = (await sql(`select
  (select id from farmacia.perfiles where rol = 'despacho' and activo limit 1) as despacho,
  (select id from farmacia.perfiles where rol = 'inventario' and activo limit 1) as inventario,
  (select id from farmacia.perfiles where rol = 'admin' and activo limit 1) as admin`))[0]

const BUENA = `'{"fecha":"2026-09-01","persona":"ZZZ PERSONA DE PRUEBA","categoria":"ZZZ CATEGORIA","observacion":"ZZZ",
  "estado_inventario":"ENTREGADO","ultima_entrega":"2026-09-01",
  "items":[{"descripcion":"ZZZ INSUMO A","cantidad":10},{"descripcion":"ZZZ INSUMO B","cantidad":"2.5"}]}'::jsonb`

const casos = [
  ['despacho NO puede guardar', ids.despacho, `perform farmacia.insumos_control_guardar(null, ${BUENA}); v := 'GUARDO';`],
  ['despacho NO ve el control', ids.despacho, `select count(*)::text into v from farmacia.insumos_control_entregas;`],
  ['despacho NO puede escribir directo en la tabla', ids.despacho,
    `insert into farmacia.insumos_control_entregas (fecha, persona) values ('2026-09-01', 'ZZZ'); v := 'INSERTO';`],
  ['inventario SÍ guarda un registro con sus insumos', ids.inventario,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     select e.origen || '|' || e.registrado_por || '|' ||
            (select count(*) from farmacia.insumos_control_entregas_items where entrega_id = v_id) || '|' ||
            (select sum(cantidad) from farmacia.insumos_control_entregas_items where entrega_id = v_id)
       into v from farmacia.insumos_control_entregas e where e.id = v_id;`],
  ['inventario SÍ ve lo que guardó (en la vista)', ids.inventario,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     select insumos::text || '|' || suma_cantidades::text into v
       from farmacia.v_insumos_control_entregas where id = v_id;`],
  ['inventario NO puede escribir directo en la tabla', ids.inventario,
    `insert into farmacia.insumos_control_entregas (fecha, persona) values ('2026-09-01', 'ZZZ'); v := 'INSERTO';`],
  ['sin cantidad en un insumo manual: no se guarda NADA', ids.inventario,
    `perform farmacia.insumos_control_guardar(null, '{"fecha":"2026-09-01","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ A","cantidad":5},{"descripcion":"ZZZ B","cantidad":""}]}'::jsonb); v := 'GUARDO';`],
  ['sin persona en manual: rechazado', ids.inventario,
    `perform farmacia.insumos_control_guardar(null, '{"fecha":"2026-09-01","persona":"",
       "items":[{"descripcion":"ZZZ A","cantidad":5}]}'::jsonb); v := 'GUARDO';`],
  ['fecha futura: rechazada', ids.inventario,
    `perform farmacia.insumos_control_guardar(null, '{"fecha":"2099-01-01","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ A","cantidad":5}]}'::jsonb); v := 'GUARDO';`],
  ['cantidad cero: rechazada', ids.inventario,
    `perform farmacia.insumos_control_guardar(null, '{"fecha":"2026-09-01","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ A","cantidad":0}]}'::jsonb); v := 'GUARDO';`],
  ['corregir reemplaza los insumos (de 2 a 1)', ids.inventario,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     perform farmacia.insumos_control_guardar(v_id, '{"fecha":"2026-09-02","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ SOLO UNO","cantidad":7}]}'::jsonb);
     select e.fecha::text || '|' ||
            (select count(*) from farmacia.insumos_control_entregas_items where entrega_id = v_id) || '|' ||
            (select string_agg(descripcion, ',') from farmacia.insumos_control_entregas_items where entrega_id = v_id)
       into v from farmacia.insumos_control_entregas e where e.id = v_id;`],
  ['corregir limpia la marca de revisar del registro', ids.inventario,
    `reset role;   -- el registro «del Excel» lo crea la carga, no la pantalla
     insert into farmacia.insumos_control_entregas (fecha, fecha_texto, persona, origen, fila_excel, revisar, revisar_motivo)
       values (null, '3 TRIMESTRE', 'ZZZ', 'excel', 900001, true, 'ZZZ prueba') returning id into v_id;
     set local role authenticated;
     perform farmacia.insumos_control_guardar(v_id, '{"fecha":"2026-09-01","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ A","cantidad":5}]}'::jsonb);
     select revisar::text || '|' || (fecha is not null)::text into v
       from farmacia.insumos_control_entregas where id = v_id;`],
  ['inventario NO puede anular', ids.inventario,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     perform farmacia.insumos_control_anular(v_id, 'ZZZ prueba de anular'); v := 'ANULO';`],
  ['el administrador SÍ anula, con motivo', ids.admin,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     perform farmacia.insumos_control_anular(v_id, 'ZZZ prueba de anular');
     select anulada::text || '|' || anulada_motivo into v
       from farmacia.insumos_control_entregas where id = v_id;`],
  ['anular sin motivo: rechazado', ids.admin,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     perform farmacia.insumos_control_anular(v_id, ''); v := 'ANULO';`],
  ['un registro anulado no se puede corregir', ids.admin,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     perform farmacia.insumos_control_anular(v_id, 'ZZZ prueba de anular');
     perform farmacia.insumos_control_guardar(v_id, '{"fecha":"2026-09-02","persona":"ZZZ PERSONA",
       "items":[{"descripcion":"ZZZ A","cantidad":1}]}'::jsonb); v := 'CORRIGIO';`],
  ['la vista trae items y total', ids.inventario,
    `v_id := farmacia.insumos_control_guardar(null, ${BUENA});
     select items::text is not null || '|' || (insumos = 2)::text || '|' || (suma_cantidades = 12.5)::text into v
       from farmacia.v_insumos_control_entregas where id = v_id;`]
]

const esperado = {
  'despacho NO puede guardar': { error: true },
  'despacho NO ve el control': { v: '0' },
  'despacho NO puede escribir directo en la tabla': { error: true },
  'inventario SÍ guarda un registro con sus insumos': { v: 'manual|' + ids.inventario + '|2|12.50' },
  'inventario SÍ ve lo que guardó (en la vista)': { v: '2|12.50' },
  'inventario NO puede escribir directo en la tabla': { error: true },
  'sin cantidad en un insumo manual: no se guarda NADA': { error: true },
  'sin persona en manual: rechazado': { error: true },
  'fecha futura: rechazada': { error: true },
  'cantidad cero: rechazada': { error: true },
  'corregir reemplaza los insumos (de 2 a 1)': { v: '2026-09-02|1|ZZZ SOLO UNO' },
  'corregir limpia la marca de revisar del registro': { v: 'false|true' },
  'inventario NO puede anular': { error: true },
  'el administrador SÍ anula, con motivo': { v: 'true|ZZZ prueba de anular' },
  'anular sin motivo: rechazado': { error: true },
  'un registro anulado no se puede corregir': { error: true },
  'la vista trae items y total': { v: 'true|true|true' }
}

/* Cada intento corre dentro de una sub-transacción que se DESHACE al final
   ("raise exception 'DESHACER'"): aunque un candado estuviera roto, no queda
   nada escrito. El resultado se guarda en una tabla temporal FUERA de la
   sub-transacción, y se lee al final con un select (la API no devuelve los
   "raise notice"). */
const bloques = casos.map(([nombre, uid, cuerpo], k) => `
  v := null; v_id := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', '${uid}', true);
    set local role authenticated;
    begin
      ${cuerpo}
    exception when others then v := 'ERROR: ' || sqlerrm;
    end;
    reset role;
    raise exception 'DESHACER';
  exception when others then
    if sqlerrm <> 'DESHACER' then v := 'FALLO LA PRUEBA: ' || sqlerrm; end if;
  end;
  insert into pg_temp.resultado values (${k}, v);`).join('\n')

const r = await sql(`create temp table resultado (k int, v text);
do $$ declare v text; v_id uuid; begin ${bloques} end $$;
select k, v from pg_temp.resultado order by k;`)
if (!Array.isArray(r)) { console.error('La consulta falló: ' + JSON.stringify(r).slice(0, 500)); process.exit(1) }
const de = Object.fromEntries(r.map(x => [x.k, x.v]))

casos.forEach(([nombre], k) => {
  const valor = de[k] == null ? '' : String(de[k])
  const esp = esperado[nombre]
  if (esp.error) prueba(nombre, /^ERROR:/.test(valor), valor)
  else prueba(nombre, valor === esp.v, 'dio: ' + valor + '  esperaba: ' + esp.v)
})

const quedo = await sql(`select count(*) as n from farmacia.insumos_control_entregas where persona like 'ZZZ%' or fila_excel = 900001;`)
prueba('no quedó NADA escrito por las pruebas', Array.isArray(quedo) && Number(quedo[0].n) === 0, JSON.stringify(quedo))

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}` : `Pasaron las ${ok} pruebas de permisos de control.`))
process.exit(mal ? 1 : 0)

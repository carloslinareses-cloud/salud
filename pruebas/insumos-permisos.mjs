/* INSUMOS: LOS PERMISOS, PROBADOS EN LA BASE DE VERDAD SIN DEJAR NADA.

   Se hace pasar por un usuario de cada rol (despacho, inventario,
   administrador y el público) y comprueba qué puede y qué no. Cada
   intento corre dentro de una sub-transacción que se DESHACE al final:
   aunque un candado estuviera roto, no queda nada escrito.

       export SUPABASE_TOKEN=sbp_...
       node pruebas/insumos-permisos.mjs
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

const BUENA = `'{"fecha":"2026-09-01","destino":"ZZZ CENTRO DE PRUEBA","recibido_por":"ZZZ RESPONSABLE",
  "items":[{"descripcion":"ZZZ INSUMO A","cantidad":10},{"descripcion":"ZZZ INSUMO B","cantidad":"2.5"}]}'::jsonb`

/* Cada caso: quién, qué SQL corre (debe dejar un texto en v) */
const casos = [
  ['despacho NO puede guardar', ids.despacho, `perform farmacia.insumos_cds_guardar(null, ${BUENA}); v := 'GUARDO';`],
  ['despacho NO ve el registro', ids.despacho, `select count(*)::text into v from farmacia.insumos_entregas_cds;`],
  ['despacho NO puede escribir directo en la tabla', ids.despacho,
    `insert into farmacia.insumos_entregas_cds (fecha, destino, recibido_por) values ('2026-09-01', 'ZZZ', 'ZZZ'); v := 'INSERTO';`],
  ['inventario SÍ guarda una entrega con sus insumos', ids.inventario,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA});
     select e.origen || '|' || e.registrado_por || '|' || (select count(*) from farmacia.insumos_entregas_cds_items where entrega_id = v_id)
                    || '|' || (select sum(cantidad) from farmacia.insumos_entregas_cds_items where entrega_id = v_id)
       into v from farmacia.insumos_entregas_cds e where e.id = v_id;`],
  ['inventario SÍ ve lo que guardó (en la vista)', ids.inventario,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA});
     select insumos::text || '|' || suma_cantidades::text into v from farmacia.v_insumos_entregas_cds where id = v_id;`],
  ['inventario NO puede escribir directo en la tabla', ids.inventario,
    `insert into farmacia.insumos_entregas_cds (fecha, destino, recibido_por) values ('2026-09-01', 'ZZZ', 'ZZZ'); v := 'INSERTO';`],
  ['sin cantidad en un insumo: no se guarda NADA', ids.inventario,
    `perform farmacia.insumos_cds_guardar(null, '{"fecha":"2026-09-01","destino":"ZZZ CENTRO","recibido_por":"ZZZ R",
       "items":[{"descripcion":"ZZZ A","cantidad":5},{"descripcion":"ZZZ B","cantidad":""}]}'::jsonb); v := 'GUARDO';`],
  ['fecha futura: rechazada', ids.inventario,
    `perform farmacia.insumos_cds_guardar(null, '{"fecha":"2099-01-01","destino":"ZZZ CENTRO","recibido_por":"ZZZ R",
       "items":[{"descripcion":"ZZZ A","cantidad":5}]}'::jsonb); v := 'GUARDO';`],
  ['sin quien recibe: rechazada', ids.inventario,
    `perform farmacia.insumos_cds_guardar(null, '{"fecha":"2026-09-01","destino":"ZZZ CENTRO","recibido_por":"",
       "items":[{"descripcion":"ZZZ A","cantidad":5}]}'::jsonb); v := 'GUARDO';`],
  ['cantidad cero: rechazada', ids.inventario,
    `perform farmacia.insumos_cds_guardar(null, '{"fecha":"2026-09-01","destino":"ZZZ CENTRO","recibido_por":"ZZZ R",
       "items":[{"descripcion":"ZZZ A","cantidad":0}]}'::jsonb); v := 'GUARDO';`],
  ['corregir reemplaza los insumos (de 2 a 1)', ids.inventario,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA});
     perform farmacia.insumos_cds_guardar(v_id, '{"fecha":"2026-09-02","destino":"ZZZ CENTRO","recibido_por":"ZZZ R",
       "items":[{"descripcion":"ZZZ SOLO UNO","cantidad":7}]}'::jsonb);
     select e.fecha::text || '|' || (select count(*) from farmacia.insumos_entregas_cds_items where entrega_id = v_id)
                     || '|' || (select string_agg(descripcion, ',') from farmacia.insumos_entregas_cds_items where entrega_id = v_id)
       into v from farmacia.insumos_entregas_cds e where e.id = v_id;`],
  ['inventario NO puede anular', ids.inventario,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA}); perform farmacia.insumos_cds_anular(v_id, 'ZZZ prueba de anular'); v := 'ANULO';`],
  ['el administrador SÍ anula, con motivo', ids.admin,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA});
     perform farmacia.insumos_cds_anular(v_id, 'ZZZ prueba de anular');
     select anulada::text || '|' || anulada_motivo into v from farmacia.insumos_entregas_cds where id = v_id;`],
  ['anular sin motivo: rechazado', ids.admin,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA}); perform farmacia.insumos_cds_anular(v_id, ''); v := 'ANULO';`],
  ['una entrega anulada no se puede corregir', ids.admin,
    `v_id := farmacia.insumos_cds_guardar(null, ${BUENA});
     perform farmacia.insumos_cds_anular(v_id, 'ZZZ prueba de anular');
     perform farmacia.insumos_cds_guardar(v_id, ${BUENA}); v := 'CORRIGIO';`],
]

const bloques = casos.map(([nombre, quien, cuerpo], k) => `
  v := null; v_id := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${quien}', 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', '${quien}', true);
    set local role authenticated;
    begin
      ${cuerpo}
    exception when others then v := 'ERROR: ' || sqlerrm;
    end;
    reset role;
    insert into pg_temp.resultado values (${k}, v);
    raise exception 'DESHACER';
  exception when others then
    if sqlerrm <> 'DESHACER' then v := 'FALLO LA PRUEBA: ' || sqlerrm; end if;
  end;
  insert into pg_temp.resultado values (${k}, v);`).join('\n')

/* La fila de dentro se deshace con la sub-transacción; la de fuera queda. */
const r = await sql(`create temp table resultado (k int, v text);
do $$ declare v text; v_id uuid; begin ${bloques} end $$;
select k, v from pg_temp.resultado order by k;`)
const de = Object.fromEntries(r.map(x => [x.k, x.v]))
const quedo = await sql(`select count(*) n from farmacia.insumos_entregas_cds where destino like 'ZZZ%' or recibido_por like 'ZZZ%';`)

console.log('INSUMOS — PERMISOS Y REGLAS EN LA BASE\n')
const v = (k) => de[k] || ''
prueba(casos[0][0], /^ERROR: Solo inventario o el administrador/.test(v(0)), v(0))
prueba(casos[1][0], v(1) === '0', v(1))
prueba(casos[2][0], /^ERROR: permission denied/.test(v(2)), v(2))
prueba(casos[3][0], /^manual\|f221|^manual\|[0-9a-f-]{36}\|2\|12\.5/.test(v(3)) && /\|2\|12\.5/.test(v(3)), v(3))
prueba(casos[4][0], v(4) === '2|12.50' || v(4) === '2|12.5', v(4))
prueba(casos[5][0], /^ERROR: permission denied/.test(v(5)), v(5))
prueba(casos[6][0], /^ERROR: Falta la cantidad entregada de "ZZZ B"/.test(v(6)), v(6))
prueba(casos[7][0], /^ERROR: La fecha no puede ser futura/.test(v(7)), v(7))
prueba(casos[8][0], /^ERROR: Escribe quién lo recibió/.test(v(8)), v(8))
prueba(casos[9][0], /^ERROR: Revisa la cantidad/.test(v(9)), v(9))
prueba(casos[10][0], v(10) === '2026-09-02|1|ZZZ SOLO UNO', v(10))
prueba(casos[11][0], /^ERROR: Solo el administrador puede anular/.test(v(11)), v(11))
prueba(casos[12][0], v(12) === 'true|ZZZ prueba de anular', v(12))
prueba(casos[13][0], /^ERROR: Escribe por qué se anula/.test(v(13)), v(13))
prueba(casos[14][0], /^ERROR: Esa entrega no existe o fue anulada/.test(v(14)), v(14))
prueba('no quedó NADA escrito por las pruebas', Number(quedo[0].n) === 0, JSON.stringify(quedo))

console.log('\n' + (mal ? `FALLARON ${mal} de ${ok + mal}` : `Pasaron las ${ok} pruebas de permisos.`))
process.exit(mal ? 1 : 0)

-- =====================================================================
-- ¿DE VERDAD SALE DEL INVENTARIO? — prueba que NO deja rastro
--
-- Todo lo que hace esta prueba ocurre dentro de una sub-transacción que
-- se deshace al final a propósito (la excepción DESHACER). Se crean un
-- producto y unos lotes de mentira, se registran entregas, se comprueba
-- el resultado y luego NADA de eso queda en la base: ni el producto, ni
-- los movimientos, ni las entregas.
--
-- Se corre pegándola entera en el editor SQL o por la API. Devuelve una
-- fila por comprobación.
-- =====================================================================
do $$
declare
  v_prod    uuid;
  v_lote1   uuid;   -- vence primero: de aquí tiene que salir antes
  v_lote2   uuid;
  v_ent     uuid;
  v_hay     numeric;
  v_falta   numeric;
  v_res     text[] := array[]::text[];
  v_ok      boolean;
  r         record;
  anotar    text;
  v_usuario uuid;
begin
  begin
    /* La base exige que cada movimiento tenga autor (lo pone sola con
       auth.uid()). Como esta prueba corre por la API de administración,
       donde no hay usuario, se le presta el de un administrador real
       SOLO dentro de esta transacción que igual se va a deshacer. */
    select id into v_usuario from farmacia.perfiles where rol = 'admin' and activo limit 1;
    if v_usuario is null then
      raise exception 'No hay ningún administrador activo para prestar su identidad en la prueba.';
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_usuario)::text, true);

    -- ---------- se arma un inventario de mentira ----------
    insert into farmacia.productos (nombre, dosificacion, presentacion, categoria)
    values ('ZZZ PRUEBA DESCUENTO', '1MG', 'CAJA', 'insumo') returning id into v_prod;

    insert into farmacia.lotes (producto_id, codigo, vence)
    values (v_prod, 'ZZZ-A', current_date + 30) returning id into v_lote1;
    insert into farmacia.lotes (producto_id, codigo, vence)
    values (v_prod, 'ZZZ-B', current_date + 300) returning id into v_lote2;

    insert into farmacia.movimientos (lote_id, tipo, cantidad, motivo, origen)
    values (v_lote1, 'entrada', 10, 'ZZZ prueba', 'sistema');
    insert into farmacia.movimientos (lote_id, tipo, cantidad, motivo, origen)
    values (v_lote2, 'entrada', 100, 'ZZZ prueba', 'sistema');

    select disponible into v_hay from farmacia.v_existencia_producto where producto_id = v_prod;
    v_res := v_res || format('%s|%s|arranca con 110 unidades en dos lotes', (v_hay = 110), v_hay);

    -- ---------- 1. una entrega normal descuenta ----------
    v_ent := farmacia.insumos_cds_guardar(null, jsonb_build_object(
      'fecha', to_char(current_date, 'YYYY-MM-DD'),
      'destino', 'ZZZ CENTRO DE PRUEBA',
      'recibido_por', 'ZZZ QUIEN RECIBE',
      'items', jsonb_build_array(
        jsonb_build_object('descripcion', 'ZZZ PRUEBA DESCUENTO', 'cantidad', '4', 'producto_id', v_prod::text))));

    select disponible into v_hay from farmacia.v_existencia_producto where producto_id = v_prod;
    v_res := v_res || format('%s|%s|entregar 4 deja 106', (v_hay = 106), v_hay);

    select existencia into v_hay from farmacia.v_existencia_lote where lote_id = v_lote1;
    v_res := v_res || format('%s|%s|salió del lote que vence primero (quedan 6 de 10)', (v_hay = 6), v_hay);

    select coalesce(sum(cantidad), 0) into v_hay from farmacia.insumos_salidas where entrega_id = v_ent;
    v_res := v_res || format('%s|%s|queda anotado de qué lote salió', (v_hay = 4), v_hay);

    select descontado, faltante into v_hay, v_falta
      from farmacia.insumos_entregas_cds_items where entrega_id = v_ent and orden = 1;
    v_res := v_res || format('%s|%s y %s|el renglón dice cuánto salió y que no faltó nada',
                             (v_hay = 4 and v_falta is null), v_hay, coalesce(v_falta::text, 'nada'));

    -- ---------- 2. sin producto enlazado NO descuenta ----------
    perform farmacia.insumos_cds_guardar(null, jsonb_build_object(
      'fecha', to_char(current_date, 'YYYY-MM-DD'),
      'destino', 'ZZZ CENTRO DE PRUEBA',
      'recibido_por', 'ZZZ QUIEN RECIBE',
      'items', jsonb_build_array(
        jsonb_build_object('descripcion', 'ZZZ ALGO ESCRITO A MANO', 'cantidad', '50'))));
    select disponible into v_hay from farmacia.v_existencia_producto where producto_id = v_prod;
    v_res := v_res || format('%s|%s|lo escrito a mano no toca el inventario', (v_hay = 106), v_hay);

    -- ---------- 3. si no alcanza: saca lo que hay y anota el faltante ----------
    v_ent := farmacia.insumos_cds_guardar(null, jsonb_build_object(
      'fecha', to_char(current_date, 'YYYY-MM-DD'),
      'destino', 'ZZZ CENTRO DE PRUEBA',
      'recibido_por', 'ZZZ QUIEN RECIBE',
      'items', jsonb_build_array(
        jsonb_build_object('descripcion', 'ZZZ PRUEBA DESCUENTO', 'cantidad', '500', 'producto_id', v_prod::text))));

    select disponible into v_hay from farmacia.v_existencia_producto where producto_id = v_prod;
    v_res := v_res || format('%s|%s|se llevó todo lo que había (queda 0, nunca negativo)', (v_hay = 0), v_hay);

    select descontado, faltante, revisar into v_hay, v_falta, v_ok
      from farmacia.insumos_entregas_cds_items where entrega_id = v_ent and orden = 1;
    v_res := v_res || format('%s|salió %s, faltaron %s|anota el faltante y lo marca para revisar',
                             (v_hay = 106 and v_falta = 394 and v_ok), v_hay, v_falta);

    -- ---------- 4. al anular, lo devuelve ----------
    perform farmacia.insumos_cds_anular(v_ent, 'ZZZ prueba de devolución');
    select disponible into v_hay from farmacia.v_existencia_producto where producto_id = v_prod;
    v_res := v_res || format('%s|%s|al anular vuelve al inventario (106 otra vez)', (v_hay = 106), v_hay);

    select count(*) into v_hay from farmacia.movimientos m
      join farmacia.insumos_salidas s on s.movimiento_id = m.anula_a where s.entrega_id = v_ent;
    v_res := v_res || format('%s|%s|cada devolución apunta al movimiento que anula', (v_hay > 0), v_hay);

    -- ---------- 5. lo del Excel nunca descuenta ----------
    select count(*) into v_hay
      from farmacia.insumos_entregas_cds e
      join farmacia.insumos_salidas s on s.entrega_id = e.id
     where e.origen = 'excel';
    v_res := v_res || format('%s|%s|ninguna entrega migrada del Excel descontó nada', (v_hay = 0), v_hay);

    raise exception 'DESHACER';
  exception when others then
    if sqlerrm <> 'DESHACER' then
      v_res := v_res || format('false|%s|LA PRUEBA SE ROMPIÓ', sqlerrm);
    end if;
  end;

  -- Los resultados se guardan FUERA de la sub-transacción deshecha.
  create temp table if not exists zzz_resultados (ok text, valor text, que text);
  delete from zzz_resultados;
  foreach anotar in array v_res loop
    insert into zzz_resultados values (split_part(anotar, '|', 1), split_part(anotar, '|', 2), split_part(anotar, '|', 3));
  end loop;
end $$;

/* Postgres escribe los booleanos como 't' y 'f', no como 'true'. */
select case when ok in ('t', 'true') then 'OK   ' else 'FALLA' end as resultado, que, valor from zzz_resultados;

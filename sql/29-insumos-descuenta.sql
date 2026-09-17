-- =====================================================================
-- QUE LO ENTREGADO SALGA DEL INVENTARIO
--
-- Hasta ahora el módulo de Insumos era un cuaderno: anotaba lo que se
-- entregó, pero el inventario no se enteraba. Desde aquí, cuando se
-- registra una entrega A MANO y el insumo está enlazado con un producto
-- del catálogo, la cantidad SALE del inventario como cualquier otra
-- entrega de la farmacia.
--
-- Las tres reglas, tal como las pidió la Alcaldía:
--
--   1. Si no hay suficiente, NO se frena a quien está despachando: se
--      descuenta lo que haya y lo que faltó queda anotado en el renglón
--      (columna "faltante") para que inventario lo revise. En la farmacia
--      manda lo físico; cuando la cuenta no cuadra, casi siempre es el
--      sistema el que está mal, no la persona.
--   2. Lo que todavía no está en el catálogo se anota igual, sin
--      descontar, y queda marcado. Ninguna entrega se pierde por eso.
--   3. Lo migrado del Excel NO descuenta nunca: ya se entregó hace meses
--      y el inventario de hoy no lo tiene contado.
--
-- Al anular o al corregir una entrega, lo descontado se DEVUELVE. Nada
-- se borra: cada devolución es su propio movimiento, que apunta al que
-- anula. Así la existencia siempre se puede explicar renglón por renglón.
--
-- Se puede correr varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. De qué producto es cada renglón, y cuánto se pudo descontar.
-- ---------------------------------------------------------------------
alter table farmacia.insumos_entregas_cds_items
  add column if not exists producto_id uuid references farmacia.productos(id) on delete set null,
  add column if not exists descontado  numeric(12,2),
  add column if not exists faltante    numeric(12,2);

comment on column farmacia.insumos_entregas_cds_items.producto_id is
  'Con qué producto del catálogo se enlazó. Nulo = se escribió a mano y no descuenta.';
comment on column farmacia.insumos_entregas_cds_items.descontado is
  'Cuánto salió de verdad del inventario.';
comment on column farmacia.insumos_entregas_cds_items.faltante is
  'Lo que se entregó pero el sistema no tenía. Es para revisar, no un error de quien despachó.';

-- ---------------------------------------------------------------------
-- 2. De qué lote salió cada cosa. Una entrega puede repartirse en varios
--    lotes (se saca primero el que vence antes), y hay que poder deshacerlo.
-- ---------------------------------------------------------------------
create table if not exists farmacia.insumos_salidas (
  id             uuid primary key default gen_random_uuid(),
  entrega_id     uuid not null references farmacia.insumos_entregas_cds(id) on delete cascade,
  item_orden     integer,
  producto_id    uuid references farmacia.productos(id) on delete set null,
  lote_id        uuid not null references farmacia.lotes(id) on delete restrict,
  cantidad       numeric(12,2) not null check (cantidad > 0),
  movimiento_id  uuid references farmacia.movimientos(id) on delete set null,
  devuelta       boolean not null default false,
  creado_en      timestamptz not null default now()
);
create index if not exists ix_insumos_salidas_entrega on farmacia.insumos_salidas (entrega_id);

alter table farmacia.insumos_salidas enable row level security;
drop policy if exists insumos_salidas_ver on farmacia.insumos_salidas;
create policy insumos_salidas_ver on farmacia.insumos_salidas
  for select to authenticated using (farmacia.mi_rol() is not null);
grant select on farmacia.insumos_salidas to authenticated;
-- Escribir solo desde las funciones de abajo (security definer).

-- ---------------------------------------------------------------------
-- 3. Devolver al inventario lo que sacó una entrega.
--    Cada devolución es un movimiento que apunta al que anula.
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_devolver(p_entrega_id uuid)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_s      record;
  v_total  numeric := 0;
  v_mov    uuid;
begin
  for v_s in
    select * from farmacia.insumos_salidas
     where entrega_id = p_entrega_id and not devuelta
     for update
  loop
    insert into farmacia.movimientos (lote_id, tipo, cantidad, motivo, anula_a, origen)
    values (v_s.lote_id, 'entrada', v_s.cantidad,
            'Devolución: se corrigió o anuló una entrega de insumos', v_s.movimiento_id, 'sistema')
    returning id into v_mov;
    update farmacia.insumos_salidas set devuelta = true where id = v_s.id;
    v_total := v_total + v_s.cantidad;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------
-- 4. Sacar del inventario lo de una entrega, lote por lote (FEFO: sale
--    primero el que vence antes). Devuelve cuánto no se pudo sacar.
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_descontar(
  p_entrega_id uuid, p_item_orden integer, p_producto_id uuid, p_cantidad numeric)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_falta  numeric := coalesce(p_cantidad, 0);
  v_lote   record;
  v_saca   numeric;
  v_mov    uuid;
begin
  if p_producto_id is null or v_falta <= 0 then
    return v_falta;
  end if;
  /* El que vence primero sale primero. Los vencidos no se tocan: para
     eso está darles de baja, que deja constancia aparte. */
  for v_lote in
    select l.lote_id, l.existencia
      from farmacia.v_lotes_para_despachar l
     where l.producto_id = p_producto_id and l.existencia > 0
     order by (l.vence is null), l.vence asc
  loop
    exit when v_falta <= 0;
    v_saca := least(v_falta, v_lote.existencia);
    insert into farmacia.movimientos (lote_id, tipo, cantidad, motivo, origen)
    values (v_lote.lote_id, 'salida', -v_saca, 'Entrega de insumos a un centro de salud', 'sistema')
    returning id into v_mov;
    insert into farmacia.insumos_salidas (entrega_id, item_orden, producto_id, lote_id, cantidad, movimiento_id)
    values (p_entrega_id, p_item_orden, p_producto_id, v_lote.lote_id, v_saca, v_mov);
    v_falta := v_falta - v_saca;
  end loop;
  return v_falta;   -- lo que el sistema no tenía
end $$;

-- ---------------------------------------------------------------------
-- 5. Guardar una entrega: lo de siempre, y además descontar.
--    (Reemplaza la función de sql/27, conservando todas sus revisiones.)
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_cds_guardar(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_rol      text := farmacia.mi_rol();
  v_id       uuid;
  v_origen   text := 'manual';
  v_fecha    date;
  v_destino  text;
  v_recibe   text;
  v_items    jsonb := p_datos -> 'items';
  v_it       jsonb;
  v_n        integer := 0;
  v_desc     text;
  v_cant     numeric;
  v_inst     uuid;
  v_prod     uuid;
  v_falta    numeric;
begin
  if v_rol is null or v_rol not in ('admin', 'inventario') then
    raise exception 'Solo inventario o el administrador pueden registrar entregas de insumos.' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select e.origen into v_origen from farmacia.insumos_entregas_cds e
     where e.id = p_id and not e.anulada for update;
    if not found then
      raise exception 'Esa entrega no existe o fue anulada.' using errcode = 'P0001';
    end if;
  end if;

  begin
    v_fecha := nullif(trim(coalesce(p_datos ->> 'fecha', '')), '')::date;
  exception when others then
    raise exception 'La fecha no es válida.' using errcode = 'P0001';
  end;
  if v_fecha is null then
    raise exception 'Falta la fecha.' using errcode = 'P0001';
  end if;
  if v_fecha > (timezone('America/Caracas', now()))::date then
    raise exception 'La fecha no puede ser futura.' using errcode = 'P0001';
  end if;
  if v_fecha < date '2020-01-01' then
    raise exception 'Revisa la fecha: es demasiado antigua.' using errcode = 'P0001';
  end if;

  v_destino := nullif(regexp_replace(trim(coalesce(p_datos ->> 'destino', '')), '\s+', ' ', 'g'), '');
  v_recibe  := nullif(regexp_replace(trim(coalesce(p_datos ->> 'recibido_por', '')), '\s+', ' ', 'g'), '');
  if v_origen = 'manual' and (v_destino is null or length(v_destino) < 3) then
    raise exception 'Escribe el centro de salud o destino.' using errcode = 'P0001';
  end if;
  if v_origen = 'manual' and (v_recibe is null or length(v_recibe) < 3) then
    raise exception 'Escribe quién lo recibió (el responsable).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_destino, '')) > 200 or length(coalesce(v_recibe, '')) > 200 then
    raise exception 'El destino o el responsable es demasiado largo.' using errcode = 'P0001';
  end if;

  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Agrega al menos un insumo con su cantidad.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_items) > 300 then
    raise exception 'Son demasiados insumos para una sola entrega.' using errcode = 'P0001';
  end if;

  -- Se revisan TODOS antes de tocar la base.
  for v_it in select value from jsonb_array_elements(v_items) loop
    v_n := v_n + 1;
    v_desc := nullif(regexp_replace(trim(coalesce(v_it ->> 'descripcion', '')), '\s+', ' ', 'g'), '');
    if v_desc is null or length(v_desc) < 2 then
      raise exception 'Al insumo número % le falta la descripción.', v_n using errcode = 'P0001';
    end if;
    if length(v_desc) > 300 then
      raise exception 'La descripción del insumo número % es demasiado larga.', v_n using errcode = 'P0001';
    end if;
    begin
      v_cant := nullif(trim(coalesce(v_it ->> 'cantidad', '')), '')::numeric;
    exception when others then
      raise exception 'La cantidad de "%" no es un número.', v_desc using errcode = 'P0001';
    end;
    -- Lo del Excel puede quedar sin cantidad propia; lo registrado a mano, no.
    if v_cant is null and v_origen = 'manual' then
      raise exception 'Falta la cantidad entregada de "%".', v_desc using errcode = 'P0001';
    end if;
    if v_cant is not null and (v_cant <= 0 or v_cant > 1000000) then
      raise exception 'Revisa la cantidad de "%": tiene que ser mayor que cero.', v_desc using errcode = 'P0001';
    end if;
    -- El producto, si viene, tiene que existir de verdad.
    begin
      v_prod := nullif(trim(coalesce(v_it ->> 'producto_id', '')), '')::uuid;
    exception when others then
      raise exception 'El producto enlazado a "%" no es válido.', v_desc using errcode = 'P0001';
    end;
    if v_prod is not null and not exists (select 1 from farmacia.productos p where p.id = v_prod) then
      raise exception 'El producto enlazado a "%" ya no está en el catálogo.', v_desc using errcode = 'P0001';
    end if;
  end loop;

  select i.id into v_inst from farmacia.instituciones i
   where regexp_replace(farmacia.sin_acentos(upper(i.nombre)), '[\s.\-_]', '', 'g')
       = regexp_replace(farmacia.sin_acentos(upper(coalesce(v_destino, ''))), '[\s.\-_]', '', 'g')
   limit 1;

  if p_id is null then
    insert into farmacia.insumos_entregas_cds (fecha, destino, institucion_id, recibido_por, origen, registrado_por)
    values (v_fecha, v_destino, v_inst, v_recibe, 'manual', auth.uid())
    returning id into v_id;
  else
    update farmacia.insumos_entregas_cds
       set fecha = v_fecha, destino = v_destino, institucion_id = v_inst,
           recibido_por = v_recibe, actualizado_en = now()
     where id = p_id;
    delete from farmacia.insumos_entregas_cds_items where entrega_id = p_id;
    /* Se corrigió: lo que había sacado esta entrega vuelve al inventario
       y en seguida se vuelve a descontar con los renglones nuevos. */
    perform farmacia.insumos_devolver(p_id);
    v_id := p_id;
  end if;

  insert into farmacia.insumos_entregas_cds_items
      (entrega_id, orden, descripcion, cantidad, producto_id, revisar, revisar_motivo)
  select v_id, x.ord::integer,
         regexp_replace(trim(x.value ->> 'descripcion'), '\s+', ' ', 'g'),
         nullif(trim(coalesce(x.value ->> 'cantidad', '')), '')::numeric,
         nullif(trim(coalesce(x.value ->> 'producto_id', '')), '')::uuid,
         coalesce((x.value ->> 'revisar')::boolean, false),
         case when coalesce((x.value ->> 'revisar')::boolean, false) then nullif(x.value ->> 'revisar_motivo', '') end
    from jsonb_array_elements(v_items) with ordinality as x(value, ord);

  /* Y ahora sale del inventario lo que esté enlazado al catálogo.
     Lo migrado del Excel NO descuenta: ya se entregó hace meses. */
  if v_origen = 'manual' then
    for v_n, v_it in
      select x.ord::integer, x.value
        from jsonb_array_elements(v_items) with ordinality as x(value, ord)
       order by x.ord
    loop
      v_prod := nullif(trim(coalesce(v_it ->> 'producto_id', '')), '')::uuid;
      v_cant := nullif(trim(coalesce(v_it ->> 'cantidad', '')), '')::numeric;
      if v_prod is not null and coalesce(v_cant, 0) > 0 then
        v_falta := farmacia.insumos_descontar(v_id, v_n, v_prod, v_cant);
        update farmacia.insumos_entregas_cds_items
           set descontado = v_cant - coalesce(v_falta, 0),
               faltante   = nullif(coalesce(v_falta, 0), 0),
               revisar    = revisar or coalesce(v_falta, 0) > 0,
               revisar_motivo = case
                 when coalesce(v_falta, 0) > 0
                   then coalesce(revisar_motivo || ' | ', '') ||
                        'El sistema solo tenía ' || (v_cant - v_falta)::text || ' de ' || v_cant::text
                 else revisar_motivo end
         where entrega_id = v_id and orden = v_n;
      end if;
    end loop;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Anular: además de marcarla, devuelve al inventario lo que sacó.
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_cds_anular(p_id uuid, p_motivo text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.es_admin() then
    raise exception 'Solo el administrador puede anular una entrega de insumos.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe por qué se anula (al menos 5 letras).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from farmacia.insumos_entregas_cds e where e.id = p_id and not e.anulada) then
    raise exception 'Esa entrega no existe o ya estaba anulada.' using errcode = 'P0001';
  end if;

  perform farmacia.insumos_devolver(p_id);

  update farmacia.insumos_entregas_cds
     set anulada = true, anulada_en = now(), anulada_por = auth.uid(),
         anulada_motivo = trim(p_motivo), actualizado_en = now()
   where id = p_id;
  return true;
end $$;

grant execute on function farmacia.insumos_cds_guardar(uuid, jsonb) to authenticated;
grant execute on function farmacia.insumos_cds_anular(uuid, text) to authenticated;
-- Las de descontar y devolver NO se conceden: solo se usan desde las de arriba.
revoke all on function farmacia.insumos_descontar(uuid, integer, uuid, numeric) from public, anon, authenticated;
revoke all on function farmacia.insumos_devolver(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. La vista de entregas dice también cuánto salió y cuánto faltó.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_insumos_salidas_entrega as
select s.entrega_id,
       sum(s.cantidad) filter (where not s.devuelta)  as descontado,
       count(distinct s.lote_id) filter (where not s.devuelta) as lotes
  from farmacia.insumos_salidas s
 group by s.entrega_id;

alter view farmacia.v_insumos_salidas_entrega set (security_invoker = true);
grant select on farmacia.v_insumos_salidas_entrega to authenticated;

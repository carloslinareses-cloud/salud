-- =====================================================================
-- INSUMOS — "REGISTRO DE ENTREGAS C.D.S"
--
-- La hoja del Excel de insumos anota lo que se le entrega a cada centro
-- de salud o destino: la fecha, a dónde, qué insumos y quién lo recibió.
-- Aquí vive esa misma hoja, pero con cada insumo en su propio renglón y
-- con SU cantidad.
--
-- Es un REGISTRO: no descuenta nada del inventario (eso lo hace Entregar,
-- con su lote). Así quedó pedido: la hoja se lleva tal cual, aparte.
--
-- Dos orígenes:
--   · 'excel'  : se cargó UNA vez de la hoja. Cada renglón del Excel trae
--                una sola cantidad para todos sus insumos juntos; esa
--                cantidad se guarda en la entrega (cantidad_total_excel)
--                y los insumos quedan SIN cantidad propia, porque
--                repartirla sería inventar números.
--   · 'manual' : se registra en la pantalla, cada insumo con su cantidad.
--
-- Se escribe SOLO por las funciones de abajo (una entrega y todos sus
-- insumos se guardan juntos o no se guarda nada). La pueden usar
-- inventario y el administrador. Se puede correr varias veces.
-- =====================================================================

create table if not exists farmacia.insumos_entregas_cds (
  id                    uuid primary key default gen_random_uuid(),
  fecha                 date not null,
  destino               text,          -- "Centro de Salud / Destino"
  institucion_id        uuid references farmacia.instituciones(id) on delete set null,
  departamento          text,          -- "Departamento / Servicio" (solo lo trae el Excel)
  recibido_por          text,          -- "Recibido Por (Responsable)"
  cantidad_total_excel  numeric(12,2), -- la única cantidad que trae cada renglón del Excel
  texto_original        text,          -- la celda "Descripción del Insumo" tal cual venía
  origen                text not null default 'manual',
  fila_excel            integer,
  anulada               boolean not null default false,
  anulada_motivo        text,
  anulada_por           uuid references farmacia.perfiles(id),
  anulada_en            timestamptz,
  registrado_por        uuid references farmacia.perfiles(id),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);

alter table farmacia.insumos_entregas_cds drop constraint if exists insumos_cds_origen;
alter table farmacia.insumos_entregas_cds add  constraint insumos_cds_origen
  check (origen in ('manual', 'excel'));

-- Lo que se registra a mano dice siempre a dónde fue y quién lo recibió.
-- Al Excel le faltan en algunos renglones: se respeta, no se inventa.
alter table farmacia.insumos_entregas_cds drop constraint if exists insumos_cds_manual_completo;
alter table farmacia.insumos_entregas_cds add  constraint insumos_cds_manual_completo
  check (origen <> 'manual' or (length(trim(coalesce(destino, ''))) >= 3
                                and length(trim(coalesce(recibido_por, ''))) >= 3));

alter table farmacia.insumos_entregas_cds drop constraint if exists insumos_cds_total_positivo;
alter table farmacia.insumos_entregas_cds add  constraint insumos_cds_total_positivo
  check (cantidad_total_excel is null or cantidad_total_excel > 0);

alter table farmacia.insumos_entregas_cds drop constraint if exists insumos_cds_anulada_con_motivo;
alter table farmacia.insumos_entregas_cds add  constraint insumos_cds_anulada_con_motivo
  check (not anulada or length(trim(coalesce(anulada_motivo, ''))) >= 5);

-- Cada fila del Excel entra una sola vez: volver a correr la carga no duplica.
create unique index if not exists ux_insumos_cds_fila_excel
  on farmacia.insumos_entregas_cds (fila_excel) where origen = 'excel';
create index if not exists ix_insumos_cds_fecha on farmacia.insumos_entregas_cds (fecha desc, creado_en desc);

create table if not exists farmacia.insumos_entregas_cds_items (
  id              uuid primary key default gen_random_uuid(),
  entrega_id      uuid not null references farmacia.insumos_entregas_cds(id) on delete cascade,
  orden           integer not null,
  descripcion     text not null,       -- "Descripción del Insumo"
  cantidad        numeric(12,2),       -- "Cantidad Entregada"
  revisar         boolean not null default false,
  revisar_motivo  text,
  creado_en       timestamptz not null default now()
);

alter table farmacia.insumos_entregas_cds_items drop constraint if exists insumos_cds_item_descripcion;
alter table farmacia.insumos_entregas_cds_items add  constraint insumos_cds_item_descripcion
  check (length(trim(descripcion)) >= 2);
alter table farmacia.insumos_entregas_cds_items drop constraint if exists insumos_cds_item_cantidad;
alter table farmacia.insumos_entregas_cds_items add  constraint insumos_cds_item_cantidad
  check (cantidad is null or cantidad > 0);

create index if not exists ix_insumos_cds_items_entrega on farmacia.insumos_entregas_cds_items (entrega_id, orden);

comment on table farmacia.insumos_entregas_cds is
  'Insumos > REGISTRO DE ENTREGAS C.D.S. Registro aparte: NO descuenta inventario.';
comment on column farmacia.insumos_entregas_cds.cantidad_total_excel is
  'Solo los renglones del Excel: la cantidad total anotada para todos sus insumos juntos, sin desglose.';

-- ---------------------------------------------------------------------
-- Bitácora: todo cambio queda anotado, con quién y cuándo.
-- ---------------------------------------------------------------------
drop trigger if exists tr_bitacora_insumos_entregas_cds on farmacia.insumos_entregas_cds;
create trigger tr_bitacora_insumos_entregas_cds
  after insert or update or delete on farmacia.insumos_entregas_cds
  for each row execute function farmacia.fn_bitacora();

drop trigger if exists tr_bitacora_insumos_entregas_cds_items on farmacia.insumos_entregas_cds_items;
create trigger tr_bitacora_insumos_entregas_cds_items
  after insert or update or delete on farmacia.insumos_entregas_cds_items
  for each row execute function farmacia.fn_bitacora();

-- ---------------------------------------------------------------------
-- Permisos: leer, inventario y administrador. Escribir, nadie directo:
-- solo por las funciones (que revisan el rol y guardan todo junto).
-- ---------------------------------------------------------------------
alter table farmacia.insumos_entregas_cds enable row level security;
alter table farmacia.insumos_entregas_cds_items enable row level security;
revoke all on farmacia.insumos_entregas_cds, farmacia.insumos_entregas_cds_items from anon, authenticated;
grant select on farmacia.insumos_entregas_cds, farmacia.insumos_entregas_cds_items to authenticated;

drop policy if exists insumos_cds_ver on farmacia.insumos_entregas_cds;
create policy insumos_cds_ver on farmacia.insumos_entregas_cds
  for select to authenticated using (coalesce(farmacia.mi_rol() in ('admin', 'inventario'), false));

drop policy if exists insumos_cds_items_ver on farmacia.insumos_entregas_cds_items;
create policy insumos_cds_items_ver on farmacia.insumos_entregas_cds_items
  for select to authenticated using (coalesce(farmacia.mi_rol() in ('admin', 'inventario'), false));

-- ---------------------------------------------------------------------
-- La lista: una fila por entrega, con sus insumos adentro.
-- ---------------------------------------------------------------------
drop view if exists farmacia.v_insumos_entregas_cds;
create view farmacia.v_insumos_entregas_cds as
select
  e.id, e.fecha, e.destino, e.institucion_id, e.departamento, e.recibido_por,
  e.cantidad_total_excel, e.texto_original, e.origen, e.fila_excel,
  e.anulada, e.anulada_motivo, e.anulada_en,
  e.registrado_por, p.nombre as registrado_por_nombre, e.creado_en, e.actualizado_en,
  coalesce(i.insumos, 0)       as insumos,
  coalesce(i.por_revisar, 0)   as por_revisar,
  i.suma_cantidades,
  coalesce(i.items, '[]'::jsonb) as items,
  farmacia.sin_acentos(upper(concat_ws(' ', e.destino, e.recibido_por, e.departamento, i.textos))) as busqueda
from farmacia.insumos_entregas_cds e
left join farmacia.perfiles p on p.id = e.registrado_por
left join lateral (
  select count(*)                                   as insumos,
         count(*) filter (where it.revisar)         as por_revisar,
         sum(it.cantidad)                           as suma_cantidades,
         string_agg(it.descripcion, ' ' order by it.orden) as textos,
         jsonb_agg(jsonb_build_object('id', it.id, 'orden', it.orden, 'descripcion', it.descripcion,
                                      'cantidad', it.cantidad, 'revisar', it.revisar,
                                      'revisar_motivo', it.revisar_motivo) order by it.orden) as items
    from farmacia.insumos_entregas_cds_items it
   where it.entrega_id = e.id
) i on true;

alter view farmacia.v_insumos_entregas_cds set (security_invoker = true);
grant select on farmacia.v_insumos_entregas_cds to authenticated;

-- ---------------------------------------------------------------------
-- Guardar una entrega (nueva o corregida) con TODOS sus insumos.
--
-- p_datos = { fecha, destino, recibido_por,
--             items: [{ descripcion, cantidad, revisar?, revisar_motivo? }] }
--
-- Todo o nada: si un insumo está mal, no se guarda ninguno.
-- Al corregir, los insumos se reemplazan por los que manda la pantalla.
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
    v_id := p_id;
  end if;

  insert into farmacia.insumos_entregas_cds_items (entrega_id, orden, descripcion, cantidad, revisar, revisar_motivo)
  select v_id, x.ord::integer,
         regexp_replace(trim(x.value ->> 'descripcion'), '\s+', ' ', 'g'),
         nullif(trim(coalesce(x.value ->> 'cantidad', '')), '')::numeric,
         coalesce((x.value ->> 'revisar')::boolean, false),
         case when coalesce((x.value ->> 'revisar')::boolean, false) then nullif(x.value ->> 'revisar_motivo', '') end
    from jsonb_array_elements(v_items) with ordinality as x(value, ord);

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Anular (no se borra: queda con su motivo y quién lo hizo).
-- Solo el administrador.
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
  update farmacia.insumos_entregas_cds
     set anulada = true, anulada_motivo = trim(p_motivo), anulada_por = auth.uid(),
         anulada_en = now(), actualizado_en = now()
   where id = p_id and not anulada;
  return found;
end $$;

revoke all on function farmacia.insumos_cds_guardar(uuid, jsonb) from public, anon;
revoke all on function farmacia.insumos_cds_anular(uuid, text) from public, anon;
grant execute on function farmacia.insumos_cds_guardar(uuid, jsonb) to authenticated;
grant execute on function farmacia.insumos_cds_anular(uuid, text) to authenticated;

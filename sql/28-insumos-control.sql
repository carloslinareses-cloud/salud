-- =====================================================================
-- INSUMOS — "CONTROL DE INSUMOS ENTREGADOS" (hoja 2)
--
-- Segunda hoja del Excel de insumos: lo que se le entregó a cada
-- PERSONA (no a un centro). Cada renglón trae fecha, nombre y
-- apellido, varios insumos en una celda separados por "/", categoría,
-- un Total Entregado (una sola cifra sin desglose), última entrega,
-- estado de inventario y observación.
--
-- Es un REGISTRO aparte: no descuenta inventario.
--
-- Dos orígenes:
--   · 'excel'  : carga única del Excel. Cada renglón trae un Total
--                Entregado sin cantidad por insumo: se guarda en
--                total_entregado_excel y los insumos quedan con
--                cantidad = null (repartir sería inventar).
--   · 'manual' : se registra en la pantalla, cada insumo con su
--                cantidad. El total se calcula como la suma.
--
-- El nombre de la persona es un dato personal: vive SOLO en la base.
-- Nunca va a archivos del repositorio, pruebas ni commits.
--
-- Escritura SOLO por funciones security definer (todo o nada).
-- =====================================================================

create table if not exists farmacia.insumos_control_entregas (
  id                      uuid primary key default gen_random_uuid(),
  fecha                   date,                    -- nula si el Excel trae basura
  fecha_texto             text,                    -- lo que decía la celda FECHA
  persona                 text,                    -- "NOMBRE Y APELLIDO" (dato personal)
  categoria               text,                    -- "Categoría / Tipo"
  total_entregado_excel   numeric(12,2),           -- Total Entregado del Excel, sin desglose
  ultima_entrega          date,                    -- si se pudo leer como fecha
  ultima_entrega_texto    text,                    -- lo que decía la celda (siempre se guarda)
  estado_inventario       text,                    -- "Estado Inventario"
  observacion             text,                    -- "OBSERVACION"
  texto_original          text,                    -- celda "Descripción del Insumo / Medicamento"
  origen                  text not null default 'manual',
  fila_excel              integer,
  revisar                 boolean not null default false,   -- fecha/persona rara del Excel
  revisar_motivo          text,
  anulada                 boolean not null default false,
  anulada_motivo          text,
  anulada_por             uuid references farmacia.perfiles(id),
  anulada_en              timestamptz,
  registrado_por          uuid references farmacia.perfiles(id),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now()
);

alter table farmacia.insumos_control_entregas drop constraint if exists insumos_ctrl_origen;
alter table farmacia.insumos_control_entregas add  constraint insumos_ctrl_origen
  check (origen in ('manual', 'excel'));

-- Lo de a mano exige fecha válida y persona. Al Excel le faltan
-- algunos: se respeta, no se inventa.
alter table farmacia.insumos_control_entregas drop constraint if exists insumos_ctrl_manual_completo;
alter table farmacia.insumos_control_entregas add  constraint insumos_ctrl_manual_completo
  check (origen <> 'manual' or (fecha is not null
                                and length(trim(coalesce(persona, ''))) >= 3));

alter table farmacia.insumos_control_entregas drop constraint if exists insumos_ctrl_total_positivo;
alter table farmacia.insumos_control_entregas add  constraint insumos_ctrl_total_positivo
  check (total_entregado_excel is null or total_entregado_excel > 0);

alter table farmacia.insumos_control_entregas drop constraint if exists insumos_ctrl_anulada_con_motivo;
alter table farmacia.insumos_control_entregas add  constraint insumos_ctrl_anulada_con_motivo
  check (not anulada or length(trim(coalesce(anulada_motivo, ''))) >= 5);

alter table farmacia.insumos_control_entregas drop constraint if exists insumos_ctrl_revisar_con_motivo;
alter table farmacia.insumos_control_entregas add  constraint insumos_ctrl_revisar_con_motivo
  check (not revisar or length(trim(coalesce(revisar_motivo, ''))) >= 3);

-- Cada fila del Excel entra una sola vez.
create unique index if not exists ux_insumos_ctrl_fila_excel
  on farmacia.insumos_control_entregas (fila_excel) where origen = 'excel';
create index if not exists ix_insumos_ctrl_fecha
  on farmacia.insumos_control_entregas (fecha desc nulls last, creado_en desc);

create table if not exists farmacia.insumos_control_entregas_items (
  id              uuid primary key default gen_random_uuid(),
  entrega_id      uuid not null references farmacia.insumos_control_entregas(id) on delete cascade,
  orden           integer not null,
  descripcion     text not null,
  cantidad        numeric(12,2),       -- null en lo del Excel
  revisar         boolean not null default false,
  revisar_motivo  text,
  creado_en       timestamptz not null default now()
);

alter table farmacia.insumos_control_entregas_items drop constraint if exists insumos_ctrl_item_descripcion;
alter table farmacia.insumos_control_entregas_items add  constraint insumos_ctrl_item_descripcion
  check (length(trim(descripcion)) >= 2);
alter table farmacia.insumos_control_entregas_items drop constraint if exists insumos_ctrl_item_cantidad;
alter table farmacia.insumos_control_entregas_items add  constraint insumos_ctrl_item_cantidad
  check (cantidad is null or cantidad > 0);

create index if not exists ix_insumos_ctrl_items_entrega
  on farmacia.insumos_control_entregas_items (entrega_id, orden);

comment on table farmacia.insumos_control_entregas is
  'Insumos > CONTROL DE INSUMOS ENTREGADOS (por persona). Registro aparte: NO descuenta inventario.';
comment on column farmacia.insumos_control_entregas.persona is
  'NOMBRE Y APELLIDO del Excel. Dato personal: solo vive en la base.';
comment on column farmacia.insumos_control_entregas.total_entregado_excel is
  'Solo los renglones del Excel: el Total Entregado, sin cantidad por insumo. No se reparte.';
comment on column farmacia.insumos_control_entregas.fecha_texto is
  'La celda FECHA tal cual venía, por si no se pudo leer como fecha válida.';

-- ---------------------------------------------------------------------
-- Bitácora
-- ---------------------------------------------------------------------
drop trigger if exists tr_bitacora_insumos_control_entregas on farmacia.insumos_control_entregas;
create trigger tr_bitacora_insumos_control_entregas
  after insert or update or delete on farmacia.insumos_control_entregas
  for each row execute function farmacia.fn_bitacora();

drop trigger if exists tr_bitacora_insumos_control_entregas_items on farmacia.insumos_control_entregas_items;
create trigger tr_bitacora_insumos_control_entregas_items
  after insert or update or delete on farmacia.insumos_control_entregas_items
  for each row execute function farmacia.fn_bitacora();

-- ---------------------------------------------------------------------
-- Permisos: leer inventario y admin. Escribir solo por funciones.
-- ---------------------------------------------------------------------
alter table farmacia.insumos_control_entregas enable row level security;
alter table farmacia.insumos_control_entregas_items enable row level security;
revoke all on farmacia.insumos_control_entregas, farmacia.insumos_control_entregas_items from anon, authenticated;
grant select on farmacia.insumos_control_entregas, farmacia.insumos_control_entregas_items to authenticated;

drop policy if exists insumos_ctrl_ver on farmacia.insumos_control_entregas;
create policy insumos_ctrl_ver on farmacia.insumos_control_entregas
  for select to authenticated using (coalesce(farmacia.mi_rol() in ('admin', 'inventario'), false));

drop policy if exists insumos_ctrl_items_ver on farmacia.insumos_control_entregas_items;
create policy insumos_ctrl_items_ver on farmacia.insumos_control_entregas_items
  for select to authenticated using (coalesce(farmacia.mi_rol() in ('admin', 'inventario'), false));

-- ---------------------------------------------------------------------
-- La lista: una fila por entrega, con sus insumos adentro.
-- ---------------------------------------------------------------------
drop view if exists farmacia.v_insumos_control_entregas;
create view farmacia.v_insumos_control_entregas as
select
  e.id, e.fecha, e.fecha_texto, e.persona, e.categoria,
  e.total_entregado_excel, e.ultima_entrega, e.ultima_entrega_texto,
  e.estado_inventario, e.observacion, e.texto_original,
  e.origen, e.fila_excel, e.revisar, e.revisar_motivo,
  e.anulada, e.anulada_motivo, e.anulada_en,
  e.registrado_por, p.nombre as registrado_por_nombre, e.creado_en, e.actualizado_en,
  coalesce(i.insumos, 0)       as insumos,
  coalesce(i.por_revisar, 0)   as por_revisar,
  i.suma_cantidades,
  coalesce(i.items, '[]'::jsonb) as items,
  farmacia.sin_acentos(upper(concat_ws(' ', e.persona, e.categoria, e.estado_inventario,
                                       e.observacion, e.fecha_texto, i.textos))) as busqueda
from farmacia.insumos_control_entregas e
left join farmacia.perfiles p on p.id = e.registrado_por
left join lateral (
  select count(*)                                   as insumos,
         count(*) filter (where it.revisar)         as por_revisar,
         sum(it.cantidad)                           as suma_cantidades,
         string_agg(it.descripcion, ' ' order by it.orden) as textos,
         jsonb_agg(jsonb_build_object('id', it.id, 'orden', it.orden, 'descripcion', it.descripcion,
                                      'cantidad', it.cantidad, 'revisar', it.revisar,
                                      'revisar_motivo', it.revisar_motivo) order by it.orden) as items
    from farmacia.insumos_control_entregas_items it
   where it.entrega_id = e.id
) i on true;

alter view farmacia.v_insumos_control_entregas set (security_invoker = true);
grant select on farmacia.v_insumos_control_entregas to authenticated;

-- ---------------------------------------------------------------------
-- Guardar un registro (nuevo o corregido) con TODOS sus insumos.
--
-- p_datos = { fecha, persona, categoria, observacion, estado_inventario,
--             ultima_entrega, items: [{ descripcion, cantidad, revisar?, revisar_motivo? }] }
--
-- Todo o nada. Al corregir, los insumos se reemplazan.
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_control_guardar(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_rol      text := farmacia.mi_rol();
  v_id       uuid;
  v_origen   text := 'manual';
  v_fecha    date;
  v_persona  text;
  v_categoria text;
  v_obs      text;
  v_estado   text;
  v_ultima   date;
  v_items    jsonb := p_datos -> 'items';
  v_it       jsonb;
  v_n        integer := 0;
  v_desc     text;
  v_cant     numeric;
begin
  if v_rol is null or v_rol not in ('admin', 'inventario') then
    raise exception 'Solo inventario o el administrador pueden registrar control de insumos.' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select e.origen into v_origen from farmacia.insumos_control_entregas e
     where e.id = p_id and not e.anulada for update;
    if not found then
      raise exception 'Ese registro no existe o fue anulado.' using errcode = 'P0001';
    end if;
  end if;

  begin
    v_fecha := nullif(trim(coalesce(p_datos ->> 'fecha', '')), '')::date;
  exception when others then
    raise exception 'La fecha no es válida.' using errcode = 'P0001';
  end;
  if v_origen = 'manual' and v_fecha is null then
    raise exception 'Falta la fecha.' using errcode = 'P0001';
  end if;
  if v_fecha is not null and v_fecha > (timezone('America/Caracas', now()))::date then
    raise exception 'La fecha no puede ser futura.' using errcode = 'P0001';
  end if;
  if v_fecha is not null and v_fecha < date '2020-01-01' then
    raise exception 'Revisa la fecha: es demasiado antigua.' using errcode = 'P0001';
  end if;

  v_persona := nullif(regexp_replace(trim(coalesce(p_datos ->> 'persona', '')), '\s+', ' ', 'g'), '');
  v_categoria := nullif(regexp_replace(trim(coalesce(p_datos ->> 'categoria', '')), '\s+', ' ', 'g'), '');
  v_obs := nullif(regexp_replace(trim(coalesce(p_datos ->> 'observacion', '')), '\s+', ' ', 'g'), '');
  v_estado := nullif(regexp_replace(trim(coalesce(p_datos ->> 'estado_inventario', '')), '\s+', ' ', 'g'), '');

  -- Una fecha mal escrita se avisa; nunca se borra en silencio.
  begin
    v_ultima := nullif(trim(coalesce(p_datos ->> 'ultima_entrega', '')), '')::date;
  exception when others then
    raise exception 'La fecha de la última entrega no es válida.' using errcode = 'P0001';
  end;

  if v_origen = 'manual' and (v_persona is null or length(v_persona) < 3) then
    raise exception 'Escribe el nombre y apellido de la persona.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_persona, '')) > 200 then
    raise exception 'El nombre de la persona es demasiado largo.' using errcode = 'P0001';
  end if;

  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Agrega al menos un insumo.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_items) > 300 then
    raise exception 'Son demasiados insumos para un solo registro.' using errcode = 'P0001';
  end if;

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
    -- Lo del Excel puede quedar sin cantidad propia; lo de a mano, no.
    if v_cant is null and v_origen = 'manual' then
      raise exception 'Falta la cantidad de "%".', v_desc using errcode = 'P0001';
    end if;
    if v_cant is not null and (v_cant <= 0 or v_cant > 1000000) then
      raise exception 'Revisa la cantidad de "%": tiene que ser mayor que cero.', v_desc using errcode = 'P0001';
    end if;
  end loop;

  if p_id is null then
    insert into farmacia.insumos_control_entregas
      (fecha, persona, categoria, observacion, estado_inventario, ultima_entrega,
       origen, registrado_por)
    values (v_fecha, v_persona, v_categoria, v_obs, v_estado, v_ultima,
            'manual', auth.uid())
    returning id into v_id;
  else
    update farmacia.insumos_control_entregas
       set fecha = coalesce(v_fecha, fecha),
           persona = coalesce(v_persona, persona),
           categoria = v_categoria,
           observacion = v_obs,
           estado_inventario = v_estado,
           ultima_entrega = v_ultima,
           -- Quien corrige ya lo miró; pero si sigue sin fecha o sin persona, la duda sigue.
           revisar = (coalesce(v_fecha, fecha) is null or coalesce(v_persona, persona) is null),
           revisar_motivo = case when coalesce(v_fecha, fecha) is null or coalesce(v_persona, persona) is null
                                 then 'Sigue sin fecha válida o sin nombre de la persona' end,
           actualizado_en = now()
     where id = p_id;
    delete from farmacia.insumos_control_entregas_items where entrega_id = p_id;
    v_id := p_id;
  end if;

  insert into farmacia.insumos_control_entregas_items
    (entrega_id, orden, descripcion, cantidad, revisar, revisar_motivo)
  select v_id, x.ord::integer,
         regexp_replace(trim(x.value ->> 'descripcion'), '\s+', ' ', 'g'),
         nullif(trim(coalesce(x.value ->> 'cantidad', '')), '')::numeric,
         coalesce((x.value ->> 'revisar')::boolean, false),
         case when coalesce((x.value ->> 'revisar')::boolean, false)
              then nullif(x.value ->> 'revisar_motivo', '') end
    from jsonb_array_elements(v_items) with ordinality as x(value, ord);

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Anular (solo admin, con motivo). No se borra.
-- ---------------------------------------------------------------------
create or replace function farmacia.insumos_control_anular(p_id uuid, p_motivo text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.es_admin() then
    raise exception 'Solo el administrador puede anular un registro de control de insumos.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe por qué se anula (al menos 5 letras).' using errcode = 'P0001';
  end if;
  update farmacia.insumos_control_entregas
     set anulada = true, anulada_motivo = trim(p_motivo), anulada_por = auth.uid(),
         anulada_en = now(), actualizado_en = now()
   where id = p_id and not anulada;
  return found;
end $$;

revoke all on function farmacia.insumos_control_guardar(uuid, jsonb) from public, anon;
revoke all on function farmacia.insumos_control_anular(uuid, text) from public, anon;
grant execute on function farmacia.insumos_control_guardar(uuid, jsonb) to authenticated;
grant execute on function farmacia.insumos_control_anular(uuid, text) to authenticated;

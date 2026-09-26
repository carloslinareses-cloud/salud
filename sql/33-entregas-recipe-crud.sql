-- Entregas de medicamentos con récipe: alta, consulta, corrección y anulación.
-- Las correcciones conservan la entrega anterior anulada y sus movimientos.
-- Aplicar antes de publicar las pantallas. Repetible.

alter table farmacia.entregas
  add column if not exists solicitud_id uuid references farmacia.solicitudes(id) on delete restrict;
alter table farmacia.entregas
  add column if not exists corrige_entrega_id uuid references farmacia.entregas(id) on delete restrict;
create index if not exists ix_entregas_solicitud on farmacia.entregas(solicitud_id);

create or replace function farmacia.entrega_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entrega farmacia.entregas%rowtype;
  v_mov record;
begin
  if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Administración o Inventario pueden anular entregas.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 8 then
    raise exception 'Explica el motivo de la anulación con al menos 8 caracteres.' using errcode = '22023';
  end if;
  select * into v_entrega from farmacia.entregas where id = p_id for update;
  if not found or v_entrega.anulada then
    raise exception 'La entrega no existe o ya fue anulada.' using errcode = '22023';
  end if;
  if v_entrega.origen = 'migracion_excel' and
     (exists(select 1 from farmacia.entrega_detalle where entrega_id=p_id) or
      exists(select 1 from farmacia.movimientos where entrega_id=p_id)) then
    raise exception 'La entrega importada tiene inventario asociado y requiere revisión.' using errcode='23503';
  end if;
  -- Se bloquean los lotes antes de devolver cantidades, en orden estable.
  perform 1 from farmacia.lotes l
    where l.id in (select d.lote_id from farmacia.entrega_detalle d where d.entrega_id = p_id)
    order by l.id for update;
  for v_mov in
    select m.id, m.lote_id, m.cantidad from farmacia.movimientos m
     where m.entrega_id = p_id and m.tipo = 'salida'
  loop
    if not exists (select 1 from farmacia.movimientos a where a.anula_a = v_mov.id) then
      insert into farmacia.movimientos(lote_id, tipo, cantidad, motivo, entrega_id, anula_a, origen)
      values(v_mov.lote_id, 'ajuste', -v_mov.cantidad,
             'Devolución por anulación: ' || btrim(p_motivo), p_id, v_mov.id, 'sistema');
    end if;
  end loop;
  update farmacia.entregas set anulada = true, anulada_motivo = btrim(p_motivo)
   where id = p_id;
end $$;

create or replace function farmacia.entrega_guardar(p_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rol text := farmacia.mi_rol();
  v_tipo text := p_datos ->> 'tipo_destinatario';
  v_paciente uuid;
  v_centro uuid;
  v_solicitud uuid;
  v_nuevo uuid;
  v_anterior farmacia.entregas%rowtype;
  v_item jsonb;
  v_lote uuid;
  v_cantidad numeric;
  v_items jsonb := p_datos -> 'items';
  v_motivo text := btrim(coalesce(p_datos ->> 'motivo_correccion', ''));
begin
  if v_rol is null or v_rol not in ('admin', 'inventario', 'despacho') then
    raise exception 'Tu usuario no puede registrar entregas.' using errcode = '42501';
  end if;
  if p_id is not null then
    if v_rol not in ('admin', 'inventario') then
      raise exception 'Solo Administración o Inventario pueden corregir entregas.' using errcode = '42501';
    end if;
    if length(v_motivo) < 8 then
      raise exception 'Explica la corrección con al menos 8 caracteres.' using errcode = '22023';
    end if;
    select * into v_anterior from farmacia.entregas where id = p_id for update;
    if not found or v_anterior.origen <> 'sistema' or v_anterior.anulada then
      raise exception 'La entrega no existe, viene del Excel o ya fue anulada.' using errcode = '22023';
    end if;
  end if;
  if v_tipo is null or v_tipo not in ('paciente', 'institucion') then
    raise exception 'El destinatario no es válido.' using errcode = '22023';
  end if;
  begin
    v_paciente := nullif(p_datos ->> 'paciente_id', '')::uuid;
    v_centro := nullif(p_datos ->> 'institucion_id', '')::uuid;
    v_solicitud := nullif(p_datos ->> 'solicitud_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'El identificador de paciente, centro o récipe no es válido.' using errcode = '22023';
  end;
  if (v_tipo = 'paciente' and (v_paciente is null or v_centro is not null)) or
     (v_tipo = 'institucion' and (v_centro is null or v_paciente is not null)) then
    raise exception 'Elige exactamente un paciente o un centro.' using errcode = '22023';
  end if;
  if v_tipo = 'paciente' and not exists
    (select 1 from farmacia.pacientes where id = v_paciente and estado = 'activo') then
    raise exception 'El paciente no está activo.' using errcode = '22023';
  end if;
  if v_tipo = 'institucion' and not exists
    (select 1 from farmacia.instituciones where id = v_centro and activo) then
    raise exception 'El centro no está activo.' using errcode = '22023';
  end if;
  if v_tipo = 'institucion' and length(btrim(coalesce(p_datos ->> 'recibe_nombre', ''))) < 3 then
    raise exception 'Anota quién recibió en el centro.' using errcode = '22023';
  end if;
  if v_solicitud is not null and not exists
    (select 1 from farmacia.solicitudes where id = v_solicitud and paciente_id = v_paciente
      and via in ('recipe', 'operacion') and activa) then
    raise exception 'La solicitud no pertenece a este paciente o no está activa.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 30 then
    raise exception 'La entrega debe tener entre 1 y 30 renglones.' using errcode = '22023';
  end if;
  if nullif(p_datos ->> 'fecha', '') is not null and
     (p_datos ->> 'fecha')::date > (now() at time zone 'America/Caracas')::date then
    raise exception 'La fecha de entrega no puede ser futura.' using errcode = '22023';
  end if;
  if v_rol = 'despacho' and nullif(p_datos ->> 'fecha', '') is not null and
     (p_datos ->> 'fecha')::date <> (now() at time zone 'America/Caracas')::date then
    raise exception 'Solo Administración e Inventario pueden ajustar la fecha.' using errcode='42501';
  end if;
  -- Todo el RPC es una transacción: si falta stock no queda cabecera huérfana.
  -- La anulación se hace primero para devolver existencias de una corrección.
  if p_id is not null then
    perform farmacia.entrega_anular(p_id, 'Corrección: ' || v_motivo);
  end if;
  insert into farmacia.entregas(tipo_destinatario, paciente_id, institucion_id,
    recibe_nombre, recibe_cedula, observacion, solicitud_id, corrige_entrega_id,
    fecha, origen, clave_idempotencia)
  values(v_tipo, v_paciente, v_centro, nullif(btrim(p_datos ->> 'recibe_nombre'), ''),
    nullif(btrim(p_datos ->> 'recibe_cedula'), ''), nullif(btrim(p_datos ->> 'observacion'), ''),
    v_solicitud, p_id,
    coalesce(nullif(p_datos ->> 'fecha', '')::date,
      case when p_id is null then (now() at time zone 'America/Caracas')::date else v_anterior.fecha end),
    'sistema', nullif(p_datos ->> 'clave_idempotencia', ''))
  returning id into v_nuevo;
  for v_item in select value from jsonb_array_elements(v_items) loop
    begin
      v_lote := (v_item ->> 'lote_id')::uuid;
      v_cantidad := (v_item ->> 'cantidad')::numeric;
    exception when others then
      raise exception 'Revisa el lote y la cantidad de cada medicamento.' using errcode = '22023';
    end;
    if v_lote is null or v_cantidad is null or v_cantidad <= 0 or v_cantidad > 100000 then
      raise exception 'Cada medicamento necesita lote y cantidad positiva.' using errcode = '22023';
    end if;
    perform 1 from farmacia.lotes where id = v_lote for update;
    if not found then raise exception 'Uno de los lotes ya no existe.' using errcode = '22023'; end if;
    insert into farmacia.entrega_detalle(entrega_id, lote_id, cantidad)
    values(v_nuevo, v_lote, v_cantidad);
  end loop;
  return v_nuevo;
end $$;

revoke all on function farmacia.entrega_anular(uuid, text) from public, anon;
revoke all on function farmacia.entrega_guardar(uuid, jsonb) from public, anon;
grant execute on function farmacia.entrega_anular(uuid, text) to authenticated;
grant execute on function farmacia.entrega_guardar(uuid, jsonb) to authenticated;
-- La corrección y la anulación solo pasan por funciones auditadas.
revoke update on farmacia.entregas from authenticated;

-- Personas: estado vital y alertas por seis meses sin retirar medicinas.
-- Solo Inventario puede cambiar el estado vital o resolver la alerta.
-- Repetible. Aplicar antes de publicar la pantalla.

alter table farmacia.pacientes add column if not exists fallecido boolean not null default false;
alter table farmacia.pacientes add column if not exists estado_vital_observacion text;
alter table farmacia.pacientes add column if not exists estado_vital_actualizado_en timestamptz;
alter table farmacia.pacientes add column if not exists estado_vital_actualizado_por uuid;

create table if not exists farmacia.alertas_retiro_resueltas (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references farmacia.pacientes(id) on delete restrict,
  fecha_base date not null,
  nota_resolucion text not null check (length(btrim(nota_resolucion)) >= 8),
  fallecido_al_resolver boolean not null,
  resuelto_en timestamptz not null default now(),
  resuelto_por uuid not null,
  unique (paciente_id, fecha_base)
);
create index if not exists ix_alertas_retiro_paciente
  on farmacia.alertas_retiro_resueltas(paciente_id, resuelto_en desc);

alter table farmacia.alertas_retiro_resueltas enable row level security;
revoke all on farmacia.alertas_retiro_resueltas from anon, authenticated;
grant select on farmacia.alertas_retiro_resueltas to authenticated, service_role;
drop policy if exists alertas_retiro_inventario_ve on farmacia.alertas_retiro_resueltas;
create policy alertas_retiro_inventario_ve on farmacia.alertas_retiro_resueltas
  for select to authenticated using (farmacia.mi_rol() = 'inventario');

-- Las notas clínicas no se copian a la bitácora general. Quedan en su
-- registro propio, mientras la bitácora conserva autor, fecha y acción.
create or replace function farmacia.fn_ocultar_sensibles(datos jsonb)
returns jsonb language sql immutable as $$
  select coalesce(datos,'{}'::jsonb) - 'clave' - 'password' - 'token'
    - 'observaciones_clinicas' - 'estado_vital_observacion' - 'nota_resolucion'
$$;

drop trigger if exists tr_bitacora_alertas_retiro_resueltas on farmacia.alertas_retiro_resueltas;
create trigger tr_bitacora_alertas_retiro_resueltas
  after insert on farmacia.alertas_retiro_resueltas
  for each row execute function farmacia.fn_bitacora();

-- El permiso genérico de edición de pacientes no puede servir para
-- modificar el estado vital desde Administración o Despacho.
create or replace function farmacia.fn_cuidar_estado_vital()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.fallecido is distinct from old.fallecido or
     new.estado_vital_observacion is distinct from old.estado_vital_observacion then
    if farmacia.mi_rol() is distinct from 'inventario' then
      raise exception 'Solo Inventario puede modificar el estado vital.' using errcode = '42501';
    end if;
    if length(btrim(coalesce(new.estado_vital_observacion, ''))) < 8 then
      raise exception 'Escribe una observación de al menos 8 caracteres.' using errcode = '22023';
    end if;
    new.estado_vital_actualizado_en := now();
    new.estado_vital_actualizado_por := auth.uid();
  else
    new.estado_vital_actualizado_en := old.estado_vital_actualizado_en;
    new.estado_vital_actualizado_por := old.estado_vital_actualizado_por;
  end if;
  return new;
end $$;
drop trigger if exists tr_cuidar_estado_vital on farmacia.pacientes;
create trigger tr_cuidar_estado_vital before update on farmacia.pacientes
  for each row execute function farmacia.fn_cuidar_estado_vital();

create or replace view farmacia.v_pacientes_estado as
select f.*, p.fallecido,
  case when farmacia.mi_rol() = 'inventario' then p.estado_vital_observacion end
    as estado_vital_observacion,
  p.estado_vital_actualizado_en
from farmacia.v_pacientes_ficha f
join farmacia.pacientes p on p.id = f.id
where farmacia.mi_rol() = 'inventario';
grant select on farmacia.v_pacientes_estado to authenticated, service_role;
alter view farmacia.v_pacientes_estado set (security_invoker = true);

-- Una alerta por período sin retiros. Si nunca retiró, se cuenta desde
-- el registro de su ficha. Una entrega nueva inicia otro período.
create or replace view farmacia.v_alertas_retiro as
select f.*, coalesce(f.ultima_entrega, (p.creado_en at time zone 'America/Caracas')::date)
  as fecha_base_alerta
from farmacia.v_pacientes_estado f
join farmacia.pacientes p on p.id = f.id
left join farmacia.alertas_retiro_resueltas r
  on r.paciente_id = f.id
 and r.fecha_base = coalesce(f.ultima_entrega, (p.creado_en at time zone 'America/Caracas')::date)
where f.estado = 'activo'
  and f.medicamentos > 0
  and coalesce(f.ultima_entrega, (p.creado_en at time zone 'America/Caracas')::date)
      <= ((now() at time zone 'America/Caracas')::date - interval '6 months')::date
  and r.id is null;
grant select on farmacia.v_alertas_retiro to authenticated, service_role;
alter view farmacia.v_alertas_retiro set (security_invoker = true);

create or replace function farmacia.marcar_estado_vital(
  p_paciente uuid, p_fallecido boolean, p_observacion text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Inventario puede cambiar el estado vital.' using errcode = '42501';
  end if;
  if p_fallecido is null or length(btrim(coalesce(p_observacion, ''))) < 8 then
    raise exception 'Elige el estado y escribe una observación de al menos 8 caracteres.' using errcode = '22023';
  end if;
  update farmacia.pacientes
     set fallecido = p_fallecido, estado_vital_observacion = btrim(p_observacion)
   where id = p_paciente and estado <> 'inactivo' and fallecido is distinct from p_fallecido;
  if not found then
    raise exception 'La persona no existe o ya tiene ese estado.' using errcode = '22023';
  end if;
end $$;

create or replace function farmacia.resolver_alerta_retiro(
  p_paciente uuid, p_fallecido boolean, p_observacion text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_paciente farmacia.pacientes%rowtype;
  v_ultima date;
  v_base date;
begin
  if farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Inventario puede resolver alertas de retiro.' using errcode = '42501';
  end if;
  if p_fallecido is null or length(btrim(coalesce(p_observacion, ''))) < 8 then
    raise exception 'Indica si falleció y escribe una observación de al menos 8 caracteres.' using errcode = '22023';
  end if;
  select * into v_paciente from farmacia.pacientes where id = p_paciente for update;
  if not found or v_paciente.estado <> 'activo' then
    raise exception 'La persona no está activa.' using errcode = '22023';
  end if;
  if not exists (select 1 from farmacia.tratamientos_paciente
                 where paciente_id = p_paciente and activo) then
    raise exception 'La persona ya no tiene medicinas activas.' using errcode = '22023';
  end if;
  select max(fecha) into v_ultima from farmacia.entregas
   where paciente_id = p_paciente and not coalesce(anulada, false);
  v_base := coalesce(v_ultima, (v_paciente.creado_en at time zone 'America/Caracas')::date);
  if v_base > ((now() at time zone 'America/Caracas')::date - interval '6 months')::date then
    raise exception 'Todavía no se cumplen seis meses sin retiro.' using errcode = '22023';
  end if;
  if v_paciente.fallecido is distinct from p_fallecido then
    update farmacia.pacientes
       set fallecido = p_fallecido, estado_vital_observacion = btrim(p_observacion)
     where id = p_paciente;
  end if;
  insert into farmacia.alertas_retiro_resueltas
    (paciente_id, fecha_base, nota_resolucion, fallecido_al_resolver, resuelto_por)
  values (p_paciente, v_base, btrim(p_observacion), p_fallecido, auth.uid());
end $$;

revoke all on function farmacia.marcar_estado_vital(uuid,boolean,text) from public, anon;
revoke all on function farmacia.resolver_alerta_retiro(uuid,boolean,text) from public, anon;
grant execute on function farmacia.marcar_estado_vital(uuid,boolean,text) to authenticated;
grant execute on function farmacia.resolver_alerta_retiro(uuid,boolean,text) to authenticated;

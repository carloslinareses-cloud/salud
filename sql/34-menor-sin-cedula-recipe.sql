-- El representante es un dato de contacto del récipe, no un paciente.
-- La ficha, el tratamiento y la entrega pertenecen siempre al menor.
-- Aplicar antes de publicar despacho.js. Repetible.

alter table farmacia.solicitudes
  add column if not exists menor_sin_cedula boolean not null default false;
alter table farmacia.solicitudes
  add column if not exists representante_nombre text;
alter table farmacia.solicitudes
  add column if not exists representante_cedula text;
alter table farmacia.solicitudes
  add column if not exists representante_telefono text;

alter table farmacia.solicitudes drop constraint if exists solicitud_menor_representante;
alter table farmacia.solicitudes add constraint solicitud_menor_representante check (
  not menor_sin_cedula or
  (via = 'recipe' and length(btrim(coalesce(representante_nombre, ''))) >= 4)
);

comment on column farmacia.solicitudes.representante_nombre is
  'Contacto del menor para este récipe. No referencia a un paciente ni a otros récipe.';

create or replace function farmacia.registrar_menor_recipe(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_paciente uuid;
  v_solicitud uuid;
  v_nombre text := btrim(coalesce(p_datos ->> 'nombre', ''));
  v_representante text := btrim(coalesce(p_datos ->> 'representante_nombre', ''));
  v_edad text := btrim(coalesce(p_datos ->> 'edad_texto', ''));
  v_cedula text := nullif(btrim(coalesce(p_datos ->> 'representante_cedula', '')), '');
begin
  if farmacia.mi_rol() not in ('admin', 'inventario', 'despacho') then
    raise exception 'Tu usuario no puede registrar récipes.' using errcode = '42501';
  end if;
  if length(v_nombre) < 4 or length(v_representante) < 4 or length(v_edad) < 1 then
    raise exception 'Escribe nombre y edad del menor y nombre del representante.' using errcode = '22023';
  end if;
  if v_cedula is not null and v_cedula !~ '^[0-9]{6,9}$' then
    raise exception 'La cédula del representante debe tener entre 6 y 9 números.' using errcode = '22023';
  end if;
  if v_edad ~* '^\s*(1[89]|[2-9][0-9])\s*(años?|anos?)?\s*$' then
    raise exception 'La edad indicada corresponde a una persona adulta.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_datos ->> 'sexo', '')), '') not in ('F', 'M') then
    if nullif(btrim(coalesce(p_datos ->> 'sexo', '')), '') is not null then
      raise exception 'El sexo indicado no es válido.' using errcode = '22023';
    end if;
  end if;

  insert into farmacia.pacientes
    (nombre, cedula, nacionalidad, cedula_cruda, sexo, edad_texto,
     telefono, direccion, estado)
  values
    (v_nombre, null, null, null, nullif(p_datos ->> 'sexo', ''), v_edad,
     nullif(btrim(coalesce(p_datos ->> 'telefono', '')), ''),
     nullif(btrim(coalesce(p_datos ->> 'direccion', '')), ''), 'activo')
  returning id into v_paciente;

  insert into farmacia.solicitudes
    (paciente_id, via, indicado_por, menor_sin_cedula,
     representante_nombre, representante_cedula, representante_telefono)
  values
    (v_paciente, 'recipe', nullif(btrim(coalesce(p_datos ->> 'indicado_por', '')), ''),
     true, v_representante, v_cedula,
     nullif(btrim(coalesce(p_datos ->> 'representante_telefono', '')), ''))
  returning id into v_solicitud;

  return jsonb_build_object('paciente_id', v_paciente, 'solicitud_id', v_solicitud);
end $$;

revoke all on function farmacia.registrar_menor_recipe(jsonb) from public, anon;
grant execute on function farmacia.registrar_menor_recipe(jsonb) to authenticated;

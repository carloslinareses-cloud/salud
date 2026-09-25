-- Gestión de Personas para Administración e Inventario.
-- El borrado real sólo se permite cuando no existe movimiento de inventario,
-- detalle de entrega, corrección enlazada ni alerta clínica resuelta.
-- Con historial de existencias se retira la ficha de la lista activa.
-- Se puede aplicar varias veces.

alter table farmacia.pacientes
  add column if not exists retirada_motivo text,
  add column if not exists retirada_en timestamptz,
  add column if not exists retirada_por uuid;

create or replace function farmacia.fn_proteger_retiro_persona()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado is distinct from old.estado and
     (new.estado = 'inactivo' or old.estado = 'inactivo') then
    if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
      raise exception 'Solo Administración e Inventario pueden retirar o reactivar personas.' using errcode = '42501';
    end if;
    if new.estado = 'inactivo' and length(btrim(coalesce(new.retirada_motivo, ''))) < 10 then
      raise exception 'Explica el motivo del retiro con al menos 10 caracteres.' using errcode = '22023';
    end if;
  elsif new.retirada_motivo is distinct from old.retirada_motivo or
        new.retirada_en is distinct from old.retirada_en or
        new.retirada_por is distinct from old.retirada_por then
    raise exception 'Los datos del retiro solo cambian al retirar o reactivar la ficha.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tr_proteger_retiro_persona on farmacia.pacientes;
create trigger tr_proteger_retiro_persona before update on farmacia.pacientes
  for each row execute function farmacia.fn_proteger_retiro_persona();

-- El borrado siempre pasa por la función que exige motivo y revisa relaciones.
drop policy if exists pacientes_admin_borra on farmacia.pacientes;
revoke delete on farmacia.pacientes from authenticated;

create or replace function farmacia.persona_resumen_retiro(p_paciente uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_persona farmacia.pacientes%rowtype;
  v_entregas int;
  v_detalles int;
  v_movimientos int;
  v_correcciones int;
  v_solicitudes int;
  v_tratamientos int;
  v_patologias int;
  v_alertas int;
  v_referencias_externas int;
begin
  if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Administración e Inventario pueden gestionar el retiro de personas.' using errcode = '42501';
  end if;
  select * into v_persona from farmacia.pacientes where id = p_paciente;
  if not found then raise exception 'La persona ya no existe.' using errcode = 'P0002'; end if;

  select count(*) into v_entregas from farmacia.entregas where paciente_id = p_paciente;
  select count(*) into v_detalles from farmacia.entrega_detalle d
    join farmacia.entregas e on e.id = d.entrega_id where e.paciente_id = p_paciente;
  select count(*) into v_movimientos from farmacia.movimientos m
    join farmacia.entregas e on e.id = m.entrega_id where e.paciente_id = p_paciente;
  select count(*) into v_correcciones from farmacia.entregas e
    where e.corrige_entrega_id in
      (select id from farmacia.entregas where paciente_id = p_paciente)
      and e.paciente_id is distinct from p_paciente;
  select count(*) into v_solicitudes from farmacia.solicitudes where paciente_id = p_paciente;
  select count(*) into v_tratamientos from farmacia.tratamientos_paciente where paciente_id = p_paciente;
  select count(*) into v_patologias from farmacia.patologias_paciente where paciente_id = p_paciente;
  select count(*) into v_alertas from farmacia.alertas_retiro_resueltas where paciente_id = p_paciente;
  select count(*) into v_referencias_externas from farmacia.entregas e
    where e.solicitud_id in (select id from farmacia.solicitudes where paciente_id = p_paciente)
      and e.paciente_id is distinct from p_paciente;

  return jsonb_build_object(
    'id', v_persona.id, 'nombre', v_persona.nombre,
    'cedula', v_persona.cedula, 'estado', v_persona.estado,
    'retirada_motivo', v_persona.retirada_motivo,
    'entregas', v_entregas, 'detalles', v_detalles,
    'movimientos', v_movimientos, 'correcciones_externas', v_correcciones,
    'solicitudes', v_solicitudes, 'tratamientos', v_tratamientos,
    'patologias', v_patologias, 'alertas_resueltas', v_alertas,
    'referencias_externas', v_referencias_externas,
    'puede_eliminar', v_detalles = 0 and v_movimientos = 0 and
      v_correcciones = 0 and v_alertas = 0 and v_referencias_externas = 0
  );
end $$;

create or replace function farmacia.persona_retirar(
  p_paciente uuid, p_nombre text, p_motivo text, p_accion text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_persona farmacia.pacientes%rowtype;
  v_resumen jsonb;
  v_entregas int;
  v_tratamientos int;
begin
  if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Administración e Inventario pueden retirar personas.' using errcode = '42501';
  end if;
  if p_accion is null or p_accion not in ('eliminar', 'desactivar') then
    raise exception 'Elige eliminar o desactivar.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explica el motivo con al menos 10 caracteres.' using errcode = '22023';
  end if;
  select * into v_persona from farmacia.pacientes where id = p_paciente for update;
  if not found or v_persona.estado = 'inactivo' then
    raise exception 'La ficha ya no está activa.' using errcode = 'P0002';
  end if;
  if upper(btrim(coalesce(p_nombre, ''))) is distinct from upper(btrim(v_persona.nombre)) then
    raise exception 'El nombre de confirmación no coincide. No se cambió la ficha.' using errcode = '22023';
  end if;
  perform 1 from farmacia.entregas where paciente_id = p_paciente order by id for update;
  perform 1 from farmacia.solicitudes where paciente_id = p_paciente order by id for update;
  v_resumen := farmacia.persona_resumen_retiro(p_paciente);

  if p_accion = 'desactivar' then
    update farmacia.pacientes set estado = 'inactivo',
      retirada_motivo = btrim(p_motivo), retirada_en = now(), retirada_por = auth.uid()
      where id = p_paciente;
    return v_resumen || jsonb_build_object('accion', 'desactivada');
  end if;
  if not (v_resumen ->> 'puede_eliminar')::boolean then
    raise exception 'Hay historial de inventario o relaciones protegidas. Desactiva la ficha para conservarlo.' using errcode = '23503';
  end if;

  delete from farmacia.entregas where paciente_id = p_paciente;
  get diagnostics v_entregas = row_count;
  delete from farmacia.tratamientos_paciente where paciente_id = p_paciente;
  get diagnostics v_tratamientos = row_count;
  delete from farmacia.solicitudes where paciente_id = p_paciente;
  delete from farmacia.patologias_paciente where paciente_id = p_paciente;
  delete from farmacia.pacientes where id = p_paciente;
  if not found then raise exception 'No se pudo eliminar la ficha.'; end if;
  insert into farmacia.bitacora
    (usuario_id, usuario_nombre, usuario_rol, tabla, operacion, registro_id, nota)
  values (auth.uid(), farmacia.mi_nombre(), farmacia.mi_rol(), 'pacientes',
    'DEPURACION_SOLICITADA', p_paciente::text, btrim(p_motivo));
  return v_resumen || jsonb_build_object(
    'accion', 'eliminada', 'entregas_eliminadas', v_entregas,
    'tratamientos_eliminados', v_tratamientos);
end $$;

create or replace function farmacia.persona_reactivar(p_paciente uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Administración e Inventario pueden reactivar personas.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explica el motivo con al menos 10 caracteres.' using errcode = '22023';
  end if;
  update farmacia.pacientes set estado = 'activo',
    retirada_motivo = null, retirada_en = null, retirada_por = null
    where id = p_paciente and estado = 'inactivo';
  if not found then raise exception 'La ficha no existe o ya está activa.' using errcode = 'P0002'; end if;
  insert into farmacia.bitacora
    (usuario_id, usuario_nombre, usuario_rol, tabla, operacion, registro_id, nota)
  values (auth.uid(), farmacia.mi_nombre(), farmacia.mi_rol(), 'pacientes',
    'REACTIVACION_SOLICITADA', p_paciente::text, btrim(p_motivo));
end $$;

revoke all on function farmacia.persona_resumen_retiro(uuid) from public, anon;
revoke all on function farmacia.persona_retirar(uuid,text,text,text) from public, anon;
revoke all on function farmacia.persona_reactivar(uuid,text) from public, anon;
grant execute on function farmacia.persona_resumen_retiro(uuid) to authenticated;
grant execute on function farmacia.persona_retirar(uuid,text,text,text) to authenticated;
grant execute on function farmacia.persona_reactivar(uuid,text) to authenticated;

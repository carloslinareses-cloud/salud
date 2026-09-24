-- Prueba real en la base productiva; toda la transacción se revierte.
begin;
do $$
declare
  v_inventario uuid;
  v_admin uuid;
  v_una uuid;
  v_otra uuid;
begin
  select id into v_inventario from farmacia.perfiles where rol = 'inventario' and activo limit 1;
  select id into v_admin from farmacia.perfiles where rol = 'admin' and activo limit 1;
  if v_inventario is null or v_admin is null then
    raise exception 'Falta un perfil activo para probar los permisos.';
  end if;
  perform set_config('request.jwt.claim.sub', v_inventario::text, true);

  insert into farmacia.pacientes(nombre, estado, creado_en)
    values('ZZZ PRUEBA ALERTA RETIRO UNO', 'activo', now() - interval '7 months')
    returning id into v_una;
  insert into farmacia.pacientes(nombre, estado, creado_en)
    values('ZZZ PRUEBA ALERTA RETIRO DOS', 'activo', now() - interval '7 months')
    returning id into v_otra;
  insert into farmacia.tratamientos_paciente(paciente_id, texto_original, activo)
    values(v_una, 'MEDICINA DE PRUEBA', true), (v_otra, 'MEDICINA DE PRUEBA', true);

  if (select count(*) from farmacia.v_alertas_retiro where id in (v_una, v_otra)) <> 2 then
    raise exception 'No aparecieron las dos alertas tras siete meses sin retiro.';
  end if;

  perform farmacia.marcar_estado_vital(v_una, true, 'Fallecimiento informado para la prueba');
  if not exists (select 1 from farmacia.pacientes where id = v_una and fallecido
      and estado_vital_actualizado_por = v_inventario)
      or not exists (select 1 from farmacia.v_alertas_retiro where id = v_una) then
    raise exception 'Marcar fallecimiento borró la alerta o no registró el autor.';
  end if;

  perform farmacia.resolver_alerta_retiro(v_una, true, 'Familia informó fallecimiento; se cierra la alerta');
  perform farmacia.resolver_alerta_retiro(v_otra, false, 'La persona sigue viva; se verificó que no retiró');
  if exists (select 1 from farmacia.v_alertas_retiro where id in (v_una, v_otra))
    or (select count(*) from farmacia.alertas_retiro_resueltas
        where paciente_id in (v_una, v_otra)) <> 2 then
    raise exception 'Las alertas resueltas continuaron visibles o faltó la constancia.';
  end if;
  if not exists (select 1 from farmacia.pacientes where id = v_otra and not fallecido) then
    raise exception 'Resolver una alerta de persona viva cambió su estado vital.';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if exists (select 1 from farmacia.v_alertas_retiro where id in (v_una, v_otra))
    or exists (select 1 from farmacia.v_pacientes_estado where id in (v_una, v_otra)) then
    raise exception 'Administración pudo consultar las vistas exclusivas de Inventario.';
  end if;
  begin
    perform farmacia.marcar_estado_vital(v_otra, true, 'Intento de cambio desde Administración');
    raise exception 'Administración pudo marcar un fallecimiento.';
  exception when sqlstate '42501' then null;
  end;
  begin
    update farmacia.pacientes set fallecido = true,
      estado_vital_observacion = 'Intento directo desde Administración' where id = v_otra;
    raise exception 'Administración pudo cambiar el estado directamente.';
  exception when sqlstate '42501' then null;
  end;
end $$;
rollback;

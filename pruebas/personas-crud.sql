-- Prueba directa en producción, revertida por completo.
begin;
do $$
declare
  v_admin uuid;
  v_inventario uuid;
  v_despacho uuid;
  v_borrable uuid;
  v_protegida uuid;
  v_con_inventario uuid;
  v_resumen jsonb;
  v_error boolean := false;
begin
  select id into v_admin from farmacia.perfiles where rol='admin' and activo limit 1;
  select id into v_inventario from farmacia.perfiles where rol='inventario' and activo limit 1;
  select id into v_despacho from farmacia.perfiles where rol='despacho' and activo limit 1;
  if v_admin is null or v_inventario is null or v_despacho is null then
    raise exception 'Falta un perfil activo de Administración, Inventario o Despacho.';
  end if;

  insert into farmacia.pacientes(nombre, estado)
    values ('ZZZ PRUEBA CRUD PERSONAS BORRABLE', 'activo') returning id into v_borrable;
  insert into farmacia.tratamientos_paciente(paciente_id,texto_original)
    values (v_borrable, 'TRATAMIENTO DE PRUEBA');
  insert into farmacia.entregas(fecha,tipo_destinatario,paciente_id,origen)
    values (date '2026-01-01','paciente',v_borrable,'migracion_excel');
  perform set_config('request.jwt.claim.sub', v_inventario::text, true);
  v_resumen := farmacia.persona_resumen_retiro(v_borrable);
  if (v_resumen->>'puede_eliminar')::boolean is not true or
     (v_resumen->>'entregas')::int <> 1 then
    raise exception 'El resumen de una entrega sin inventario es incorrecto.';
  end if;
  perform farmacia.persona_retirar(v_borrable,
    'ZZZ PRUEBA CRUD PERSONAS BORRABLE', 'Datos erróneos para volver a registrar', 'eliminar');
  if exists (select 1 from farmacia.pacientes where id=v_borrable) or
     exists (select 1 from farmacia.entregas where paciente_id=v_borrable) or
     exists (select 1 from farmacia.tratamientos_paciente where paciente_id=v_borrable) then
    raise exception 'El borrado dejó registros enlazados.';
  end if;

  insert into farmacia.pacientes(nombre, estado)
    values ('ZZZ PRUEBA CRUD PERSONAS PROTEGIDA', 'activo') returning id into v_protegida;
  insert into farmacia.alertas_retiro_resueltas
    (paciente_id,fecha_base,nota_resolucion,fallecido_al_resolver,resuelto_por)
    values(v_protegida,date '2026-01-01','Alerta clínica de prueba',false,v_admin);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select e.paciente_id into v_con_inventario from farmacia.entrega_detalle d
    join farmacia.entregas e on e.id=d.entrega_id
    where e.paciente_id is not null limit 1;
  if v_con_inventario is not null and
     (farmacia.persona_resumen_retiro(v_con_inventario)->>'puede_eliminar')::boolean is not false then
    raise exception 'Una ficha con detalle real de inventario apareció como borrable.';
  end if;
  v_resumen := farmacia.persona_resumen_retiro(v_protegida);
  if (v_resumen->>'puede_eliminar')::boolean is not false then
    raise exception 'La ficha con alerta resuelta apareció como borrable.';
  end if;
  begin
    perform farmacia.persona_retirar(v_protegida,
      'ZZZ PRUEBA CRUD PERSONAS PROTEGIDA', 'Comprobación de historial protegido', 'eliminar');
  exception when foreign_key_violation then v_error := true;
  end;
  if not v_error or not exists (select 1 from farmacia.pacientes where id=v_protegida) then
    raise exception 'Se borró una ficha protegida o faltó el rechazo.';
  end if;
  v_error := false;
  begin
    perform farmacia.persona_retirar(v_protegida,
      'ZZZ PRUEBA CRUD PERSONAS PROTEGIDA', 'Comprobación de acción nula', null);
  exception when invalid_parameter_value then v_error := true;
  end;
  if not v_error then raise exception 'Una acción nula pudo llegar al borrado.'; end if;
  perform farmacia.persona_retirar(v_protegida,
    'ZZZ PRUEBA CRUD PERSONAS PROTEGIDA', 'Se retira la ficha conservando su historial', 'desactivar');
  if not exists (select 1 from farmacia.pacientes where id=v_protegida and estado='inactivo') then
    raise exception 'No se desactivó la ficha.';
  end if;
  perform farmacia.persona_reactivar(v_protegida,'Ficha revisada y reactivada por prueba');
  if not exists (select 1 from farmacia.pacientes where id=v_protegida and estado='activo') then
    raise exception 'No se reactivó la ficha.';
  end if;

  perform set_config('request.jwt.claim.sub', v_despacho::text, true);
  v_error := false;
  begin
    perform farmacia.persona_resumen_retiro(v_protegida);
  exception when insufficient_privilege then v_error := true;
  end;
  if not v_error then raise exception 'Despacho pudo consultar el retiro.'; end if;
  v_error := false;
  begin
    update farmacia.pacientes set estado='inactivo', retirada_motivo='Intento no autorizado'
      where id=v_protegida;
  exception when insufficient_privilege then v_error := true;
  end;
  if not v_error or not exists (select 1 from farmacia.pacientes where id=v_protegida and estado='activo') then
    raise exception 'Despacho pudo desactivar directamente una ficha.';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  v_error := false;
  begin
    perform farmacia.persona_resumen_retiro(v_protegida);
  exception when insufficient_privilege then v_error := true;
  end;
  if not v_error then raise exception 'Una sesión sin perfil pudo consultar el retiro.'; end if;
end $$;
rollback;

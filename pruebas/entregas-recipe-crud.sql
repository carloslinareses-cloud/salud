-- Prueba real en la base productiva. Toda la transacción se deshace.
begin;
do $$
declare
  v_admin uuid;
  v_paciente uuid;
  v_otro uuid;
  v_producto uuid;
  v_lote uuid;
  v_recipe uuid;
  v_primera uuid;
  v_corregida uuid;
  v_saldo numeric;
  v_historica uuid;
  v_rechazado boolean := false;
begin
  select id into v_admin from farmacia.perfiles where rol = 'admin' and activo limit 1;
  if v_admin is null then raise exception 'No hay administrador activo para probar.'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into farmacia.pacientes(nombre, estado) values('ZZZ PRUEBA CRUD RÉCIPE', 'activo') returning id into v_paciente;
  insert into farmacia.pacientes(nombre, estado) values('ZZZ PRUEBA OTRA PERSONA', 'activo') returning id into v_otro;
  insert into farmacia.productos(nombre, dosificacion, presentacion)
    values('ZZZ PRUEBA CRUD ' || gen_random_uuid()::text, '1 MG', 'TABLETAS') returning id into v_producto;
  insert into farmacia.lotes(producto_id, codigo, vence)
    values(v_producto, 'ZZZ-CRUD', current_date + 365) returning id into v_lote;
  insert into farmacia.movimientos(lote_id, tipo, cantidad, motivo)
    values(v_lote, 'entrada', 10, 'Prueba transaccional');
  insert into farmacia.solicitudes(paciente_id, via)
    values(v_paciente, 'recipe') returning id into v_recipe;

  v_primera := farmacia.entrega_guardar(null, jsonb_build_object(
    'tipo_destinatario', 'paciente', 'paciente_id', v_paciente, 'solicitud_id', v_recipe,
    'items', jsonb_build_array(jsonb_build_object('lote_id', v_lote, 'cantidad', 3))));
  select sum(cantidad) into v_saldo from farmacia.movimientos where lote_id = v_lote;
  if v_saldo <> 7 or not exists
    (select 1 from farmacia.entregas where id = v_primera and solicitud_id = v_recipe) then
    raise exception 'El alta no enlazó el récipe o no descontó 3 unidades.';
  end if;

  v_corregida := farmacia.entrega_guardar(v_primera, jsonb_build_object(
    'tipo_destinatario', 'paciente', 'paciente_id', v_paciente, 'solicitud_id', v_recipe,
    'motivo_correccion', 'Cantidad corregida por prueba',
    'items', jsonb_build_array(jsonb_build_object('lote_id', v_lote, 'cantidad', 5))));
  select sum(cantidad) into v_saldo from farmacia.movimientos where lote_id = v_lote;
  if v_saldo <> 5 or not exists
    (select 1 from farmacia.entregas where id = v_primera and anulada) or not exists
    (select 1 from farmacia.entregas where id = v_corregida and corrige_entrega_id = v_primera) then
    raise exception 'La corrección no conservó historia o dejó mal el inventario.';
  end if;

  perform farmacia.entrega_anular(v_corregida, 'Anulación de prueba');
  select sum(cantidad) into v_saldo from farmacia.movimientos where lote_id = v_lote;
  if v_saldo <> 10 then raise exception 'La anulación no devolvió las 10 unidades iniciales.'; end if;
  insert into farmacia.entregas(tipo_destinatario,paciente_id,origen,observacion,fecha)
    values('paciente',v_paciente,'migracion_excel','Texto original de prueba',current_date - 20)
    returning id into v_historica;
  perform farmacia.entrega_historica_corregir(v_historica,current_date - 10,
    'Medicamento corregido de prueba','Corrección del texto de prueba');
  if not exists(select 1 from farmacia.entregas where id=v_historica and
      fecha=current_date-10 and observacion='Medicamento corregido de prueba') then
    raise exception 'No se corrigió la entrega histórica.';
  end if;
  perform farmacia.entrega_anular(v_historica,'Entrega histórica duplicada de prueba');
  if not exists(select 1 from farmacia.entregas where id=v_historica and anulada) then
    raise exception 'No se anuló la entrega histórica.';
  end if;

  begin
    perform farmacia.entrega_guardar(null, jsonb_build_object(
      'tipo_destinatario', 'paciente', 'paciente_id', v_otro, 'solicitud_id', v_recipe,
      'items', jsonb_build_array(jsonb_build_object('lote_id', v_lote, 'cantidad', 1))));
    raise exception 'Aceptó el récipe de otra persona.';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform farmacia.entrega_anular(v_historica,'Intento sin perfil de prueba');
  exception when insufficient_privilege then v_rechazado := true;
  end;
  if not v_rechazado then raise exception 'Una sesión sin perfil pasó el control de permisos.'; end if;
end $$;
rollback;

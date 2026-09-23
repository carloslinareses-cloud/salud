-- Prueba de integración en producción: todo se revierte al terminar.
begin;
do $$
declare
  v_usuario uuid;
  v_existente uuid;
  v_menor uuid;
  v_recipe uuid;
  v_producto uuid;
  v_lote uuid;
  v_entrega uuid;
  v_res jsonb;
begin
  select id into v_usuario from farmacia.perfiles where rol = 'despacho' and activo limit 1;
  if v_usuario is null then raise exception 'No hay usuario de despacho activo para probar.'; end if;
  perform set_config('request.jwt.claim.sub', v_usuario::text, true);

  insert into farmacia.pacientes(nombre, nacionalidad, cedula, estado)
    values('ZZZ REPRESENTANTE DE PRUEBA', 'V', '987654321', 'activo') returning id into v_existente;

  v_res := farmacia.registrar_menor_recipe(jsonb_build_object(
    'nombre', 'ZZZ MENOR DE PRUEBA', 'edad_texto', '8 años', 'sexo', 'F',
    'representante_nombre', 'ZZZ REPRESENTANTE DE PRUEBA',
    'representante_cedula', '987654321', 'representante_telefono', '04240000000'));
  v_menor := (v_res ->> 'paciente_id')::uuid;
  v_recipe := (v_res ->> 'solicitud_id')::uuid;
  if v_menor = v_existente or not exists
    (select 1 from farmacia.pacientes where id = v_menor and cedula is null and nombre = 'ZZZ MENOR DE PRUEBA')
    or not exists
    (select 1 from farmacia.solicitudes where id = v_recipe and paciente_id = v_menor
      and menor_sin_cedula and representante_cedula = '987654321')
    or exists
    (select 1 from farmacia.solicitudes where id = v_recipe and paciente_id = v_existente) then
    raise exception 'El récipe no pertenece exclusivamente al menor.';
  end if;

  insert into farmacia.productos(nombre, dosificacion, presentacion)
    values('ZZZ PRUEBA MENOR ' || gen_random_uuid()::text, '1 MG', 'TABLETAS') returning id into v_producto;
  insert into farmacia.lotes(producto_id, codigo, vence)
    values(v_producto, 'ZZZ-MENOR', current_date + 365) returning id into v_lote;
  insert into farmacia.movimientos(lote_id, tipo, cantidad, motivo)
    values(v_lote, 'entrada', 2, 'Prueba transaccional de menor');
  v_entrega := farmacia.entrega_guardar(null, jsonb_build_object(
    'tipo_destinatario', 'paciente', 'paciente_id', v_menor, 'solicitud_id', v_recipe,
    'items', jsonb_build_array(jsonb_build_object('lote_id', v_lote, 'cantidad', 1))));
  if not exists
    (select 1 from farmacia.entregas where id = v_entrega and paciente_id = v_menor
      and solicitud_id = v_recipe) then
    raise exception 'La entrega no quedó vinculada al menor.';
  end if;
end $$;
rollback;

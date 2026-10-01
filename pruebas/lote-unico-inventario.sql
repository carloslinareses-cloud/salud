-- Pruebas reales de ambos perfiles; todo se revierte al finalizar.
begin;
create temp table resultados_lotes(caso text, correcto boolean);
grant insert, select on resultados_lotes to authenticated;
do $$
declare
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  lote_nuevo uuid; lote_otro uuid; usuario uuid; perfil text; codigo text;
begin
  insert into farmacia.productos(id,nombre,categoria,unidad) values
    (p1,'PRUEBA TRANSACCIONAL LOTE UNICO A','medicamento','unidad'),
    (p2,'PRUEBA TRANSACCIONAL LOTE UNICO B','medicamento','unidad');
  foreach perfil in array array['admin','inventario'] loop
    select id into usuario from farmacia.perfiles where activo and rol = perfil limit 1;
    if usuario is null then raise exception 'Falta perfil para probar'; end if;
    perform set_config('request.jwt.claim.sub',usuario::text,true);
    perform set_config('request.jwt.claims',json_build_object('sub',usuario,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    codigo := 'PRUEBA-' || gen_random_uuid()::text;
    insert into farmacia.lotes(producto_id,codigo,vence) values(p1,codigo,'2029-01-01') returning id into lote_nuevo;
    insert into resultados_lotes values(perfil || ': lote nuevo',true);
    insert into resultados_lotes values(perfil || ': consulta de duplicado',not farmacia.lote_codigo_disponible(lower(codigo)));
    begin
      insert into farmacia.lotes(producto_id,codigo,vence) values(p1,codigo,'2030-01-01');
      raise exception 'Se permitió el mismo lote con otra fecha';
    exception when unique_violation then
      insert into resultados_lotes values(perfil || ': mismo medicamento y otra fecha',true);
    end;
    begin
      insert into farmacia.lotes(producto_id,codigo,vence) values(p2,'  ' || lower(codigo) || '  ','2031-01-01');
      raise exception 'Se permitió el mismo lote para otro medicamento';
    exception when unique_violation then
      insert into resultados_lotes values(perfil || ': otro medicamento, mayúsculas y espacios',true);
    end;
    begin
      insert into farmacia.lotes(producto_id,codigo) values(p2,'   ');
      raise exception 'Se permitió un lote vacío';
    exception when check_violation then
      insert into resultados_lotes values(perfil || ': lote obligatorio',true);
    end;
    insert into farmacia.lotes(producto_id,codigo) values(p2,'PRUEBA-' || gen_random_uuid()::text) returning id into lote_otro;
    begin
      execute 'update farmacia.lotes set codigo = $1 where id = $2' using codigo,lote_otro;
      raise exception 'Se permitió cambiar otro lote a un código ocupado';
    exception when unique_violation then
      insert into resultados_lotes values(perfil || ': edición a lote ocupado',true);
    end;
    insert into farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
      values(lote_nuevo,'entrada',1,'Prueba transaccional de lote único','sistema');
    begin
      insert into farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
        values(lote_nuevo,'entrada',1,'Prueba de entrada repetida','sistema');
      raise exception 'Se permitió sumar una segunda entrada';
    exception when unique_violation then
      insert into resultados_lotes values(perfil || ': segunda entrada bloqueada',true);
    end;
    insert into farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
      values(lote_nuevo,'ajuste',1,'Corrección de conteo de prueba','sistema');
    insert into resultados_lotes values(perfil || ': ajuste de existencia conservado',true);
    execute 'reset role';
  end loop;
end $$;
select * from resultados_lotes order by caso;
rollback;

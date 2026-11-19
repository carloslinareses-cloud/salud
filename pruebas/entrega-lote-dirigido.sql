-- Prueba de integración sin efectos persistentes: ejecutar completa, incluido ROLLBACK.
-- Sólo usa un centro, producto y lotes sintéticos dentro de esta transacción.
begin;
set local statement_timeout = '20s';
do $$
declare
  administrador uuid; despachador uuid; producto uuid; centro uuid; entrega uuid;
  a uuid; b uuid; vencido uuid; agotado uuid; baja uuid; rechazado boolean;
  prefijo text := 'QA-ENTREGA-LOTE-20261119-' || gen_random_uuid()::text;
  saldo_a numeric; saldo_b numeric; encabezados bigint; comprobaciones integer := 0;
begin
  begin
    select id into strict administrador from farmacia.perfiles where activo and rol='admin' limit 1;
    select id into strict despachador from farmacia.perfiles where activo and rol='despacho' limit 1;
    perform set_config('request.jwt.claim.sub',administrador::text,true);
    perform set_config('request.jwt.claims',json_build_object('sub',administrador,'role','authenticated')::text,true);
    insert into farmacia.productos(nombre) values(prefijo) returning id into producto;
    insert into farmacia.instituciones(nombre,tipo) values(prefijo,'CDI') returning id into centro;
    insert into farmacia.lotes(producto_id,codigo,vence) values(producto,prefijo||'-A',current_date+100) returning id into a;
    insert into farmacia.lotes(producto_id,codigo,vence) values(producto,prefijo||'-B',current_date+200) returning id into b;
    insert into farmacia.lotes(producto_id,codigo,vence) values(producto,prefijo||'-V',current_date-1) returning id into vencido;
    insert into farmacia.lotes(producto_id,codigo,vence) values(producto,prefijo||'-Z',current_date+200) returning id into agotado;
    insert into farmacia.lotes(producto_id,codigo,vence) values(producto,prefijo||'-D',current_date+200) returning id into baja;
    insert into farmacia.movimientos(lote_id,tipo,cantidad,motivo) values
      (a,'entrada',10,'Prueba transaccional'),(b,'entrada',8,'Prueba transaccional'),
      (vencido,'entrada',4,'Prueba transaccional'),(baja,'entrada',3,'Prueba transaccional');
    update farmacia.lotes set estado='dado_de_baja' where id=baja;
    perform set_config('request.jwt.claim.sub',despachador::text,true);
    perform set_config('request.jwt.claims',json_build_object('sub',despachador,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    if farmacia.mi_rol() <> 'despacho' or current_user <> 'authenticated' then raise exception 'Identidad de prueba incorrecta'; end if;
    entrega := farmacia.entrega_guardar(null,jsonb_build_object(
      'tipo_destinatario','institucion','institucion_id',centro,'recibe_nombre','Receptor sintético QA',
      'items',jsonb_build_array(jsonb_build_object('lote_id',b,'cantidad',3))));
    select existencia into saldo_a from farmacia.v_existencia_lote where lote_id=a;
    select existencia into saldo_b from farmacia.v_existencia_lote where lote_id=b;
    if saldo_a is distinct from 10 or saldo_b is distinct from 5 then raise exception 'Descuento fuera del lote elegido'; end if;
    if (select count(*) from farmacia.entrega_detalle where entrega_id=entrega and lote_id=b and cantidad=3) <> 1
      or (select count(*) from farmacia.movimientos where entrega_id=entrega and lote_id=b and tipo='salida' and cantidad=-3) <> 1 then
      raise exception 'Detalle o movimiento sin el lote elegido';
    end if;
    comprobaciones := comprobaciones+1;
    select count(*) into encabezados from farmacia.entregas where institucion_id=centro;
    rechazado := false;
    begin
      perform farmacia.entrega_guardar(null,jsonb_build_object(
        'tipo_destinatario','institucion','institucion_id',centro,'recibe_nombre','Receptor sintético QA',
        'items',jsonb_build_array(jsonb_build_object('lote_id',a,'cantidad',1),jsonb_build_object('lote_id',b,'cantidad',6))));
    exception when others then
      if sqlerrm not ilike '%No hay suficiente%' then raise; end if;
      rechazado := true;
    end;
    if not rechazado or (select existencia from farmacia.v_existencia_lote where lote_id=a) is distinct from 10
      or (select existencia from farmacia.v_existencia_lote where lote_id=b) is distinct from 5
      or (select count(*) from farmacia.entregas where institucion_id=centro) <> encabezados then
      raise exception 'La entrega sin saldo no fue atómica';
    end if;
    comprobaciones := comprobaciones+1;
    for b in select unnest(array[vencido,agotado,baja]) loop
      rechazado := false;
      begin
        perform farmacia.entrega_guardar(null,jsonb_build_object(
          'tipo_destinatario','institucion','institucion_id',centro,'recibe_nombre','Receptor sintético QA',
          'items',jsonb_build_array(jsonb_build_object('lote_id',b,'cantidad',1))));
      exception when others then
        if sqlerrm not ilike '%vencid%' and sqlerrm not ilike '%No hay suficiente%' and sqlerrm not ilike '%dado de baja%' then raise; end if;
        rechazado := true;
      end;
      if not rechazado then raise exception 'Se permitió un lote bloqueado'; end if;
      comprobaciones := comprobaciones+1;
    end loop;
    perform set_config('qa.entrega_lote_resultado',json_build_object('ok',true,'rol',farmacia.mi_rol(),
      'saldo_otro_lote',saldo_a,'saldo_lote_elegido',saldo_b,'comprobaciones',comprobaciones,'atomicidad',true)::text,true);
  exception when others then
    perform set_config('qa.entrega_lote_resultado',json_build_object('ok',false,'error',sqlerrm)::text,true);
  end;
end $$;
select current_setting('qa.entrega_lote_resultado')::jsonb as resultado;
rollback;

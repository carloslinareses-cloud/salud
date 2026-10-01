BEGIN;
CREATE TEMP TABLE resultado_auditoria(caso text,correcto boolean) ON COMMIT DROP;
GRANT SELECT,INSERT ON resultado_auditoria TO authenticated;
DO $$
DECLARE perfil text; usuario uuid; p1 uuid; p2 uuid; l1 uuid; l2 uuid; salida uuid;
 codigo text; original text; saldo numeric; n integer; rechazado boolean;
BEGIN
 FOREACH perfil IN ARRAY ARRAY['admin','inventario'] LOOP
  SELECT id INTO usuario FROM farmacia.perfiles WHERE activo AND rol=perfil LIMIT 1;
  IF usuario IS NULL THEN RAISE EXCEPTION 'Falta perfil %',perfil; END IF;
  PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',usuario,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  original:='ZZZ AUDITORIA '||gen_random_uuid()::text;
  INSERT INTO farmacia.productos(nombre,presentacion,stock_minimo,empaque,unidades_por_empaque)
    VALUES(original,'TABLETAS',17,'caja',10) RETURNING id INTO p1;
  INSERT INTO farmacia.productos(nombre,presentacion,stock_minimo)
    VALUES(original||' B','JARABE',23) RETURNING id INTO p2;
  codigo:='AUDITORIA-'||gen_random_uuid()::text;
  INSERT INTO farmacia.lotes(producto_id,codigo,vence) VALUES(p1,codigo,'2020-01-01') RETURNING id INTO l1;
  INSERT INTO farmacia.lotes(producto_id,codigo,vence) VALUES(p2,'AUDITORIA-'||gen_random_uuid()::text,'2040-01-01') RETURNING id INTO l2;
  INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen) VALUES(l1,'entrada',10,'Prueba transaccional','sistema'),(l2,'entrada',10,'Prueba transaccional','sistema');

  UPDATE farmacia.productos SET nombre=original||' CORREGIDO' WHERE id=p1;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 OR NOT EXISTS(SELECT 1 FROM farmacia.v_catalogo WHERE producto_id=p1 AND stock_minimo=17 AND empaque='caja') THEN
    RAISE EXCEPTION 'No se corrigio la ficha o perdio su configuracion'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': corregir medicamento conservando configuracion',true);

  PERFORM farmacia.inventario_guardar_conteo(jsonb_build_object(l2::text,jsonb_build_object('productoId',p2,'producto',original||' B CORREGIDO','presentacion','FRASCO','real',7,'sis',10)),'Conteo de prueba');
  SELECT existencia INTO saldo FROM farmacia.v_existencia_lote WHERE lote_id=l2;
  IF saldo<>7 OR NOT EXISTS(SELECT 1 FROM farmacia.productos WHERE id=p2 AND presentacion='FRASCO' AND stock_minimo=23) THEN
    RAISE EXCEPTION 'Conteo incorrecto'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': corregir nombre presentacion y cantidad juntos',true);

  rechazado:=false;
  BEGIN
   PERFORM farmacia.inventario_guardar_conteo(jsonb_build_object(l1::text,jsonb_build_object('productoId',p1,'producto',original||' NO DEBE QUEDAR','real',8,'sis',10),l2::text,jsonb_build_object('lote',codigo)),'Conteo de prueba');
  EXCEPTION WHEN unique_violation THEN rechazado:=true;
  END;
  IF NOT rechazado OR NOT EXISTS(SELECT 1 FROM farmacia.productos WHERE id=p1 AND nombre=original||' CORREGIDO') OR
    (SELECT existencia FROM farmacia.v_existencia_lote WHERE lote_id=l1)<>10 THEN RAISE EXCEPTION 'Se guardo una correccion a medias'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': colision revierte todas las correcciones',true);

  rechazado:=false;
  BEGIN
   PERFORM farmacia.inventario_guardar_conteo(jsonb_build_object(l2::text,jsonb_build_object('real',2,'sis',8)),'Conteo de prueba');
  EXCEPTION WHEN serialization_failure THEN rechazado:=true;
  END;
  IF NOT rechazado OR (SELECT existencia FROM farmacia.v_existencia_lote WHERE lote_id=l2)<>7 THEN RAISE EXCEPTION 'Se acepto una existencia antigua'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': conteo antiguo no cambia existencias',true);

  rechazado:=false;
  BEGIN PERFORM farmacia.inventario_baja(l1,9); EXCEPTION WHEN serialization_failure THEN rechazado:=true; END;
  IF NOT rechazado OR (SELECT estado FROM farmacia.lotes WHERE id=l1)<>'disponible' OR
    (SELECT existencia FROM farmacia.v_existencia_lote WHERE lote_id=l1)<>10 THEN RAISE EXCEPTION 'Baja antigua cambio datos'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': baja antigua rechazada completa',true);
  saldo:=farmacia.inventario_baja(l1,10);
  IF saldo<>10 OR (SELECT estado FROM farmacia.lotes WHERE id=l1)<>'dado_de_baja' OR
    (SELECT existencia FROM farmacia.v_existencia_lote WHERE lote_id=l1)<>0 THEN RAISE EXCEPTION 'Baja incompleta'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': baja y movimiento atomicos',true);
  rechazado:=false;
  BEGIN PERFORM farmacia.inventario_baja(l1,10); EXCEPTION WHEN invalid_parameter_value THEN rechazado:=true; END;
  IF NOT rechazado THEN RAISE EXCEPTION 'Se acepto una baja repetida'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': baja repetida rechazada',true);
  IF perfil='admin' THEN
  INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen) VALUES(l2,'salida',-2,'Auditoria transaccional','sistema') RETURNING id INTO salida;
  rechazado:=false;
  BEGIN INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen,anula_a) VALUES(l2,'entrada',3,'Devolucion incorrecta','sistema',salida);
  EXCEPTION WHEN check_violation THEN rechazado:=true; END;
  IF NOT rechazado THEN RAISE EXCEPTION 'Devolucion de cantidad diferente aceptada'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': devolucion debe tener cantidad exacta',true);
  INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen,anula_a) VALUES(l2,'entrada',2,'Devolucion de prueba','sistema',salida);
  IF (SELECT existencia FROM farmacia.v_existencia_lote WHERE lote_id=l2)<>7 THEN RAISE EXCEPTION 'Devolucion no restauro existencia'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': devolucion restaura existencia',true);
  rechazado:=false;
  BEGIN INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen,anula_a) VALUES(l2,'entrada',2,'Devolucion repetida','sistema',salida);
  EXCEPTION WHEN unique_violation THEN rechazado:=true; END;
  IF NOT rechazado THEN RAISE EXCEPTION 'Devolucion duplicada aceptada'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': devolucion duplicada rechazada',true);
  rechazado:=false;
  BEGIN INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen) VALUES(l2,'entrada',2,'Nueva entrada repetida','sistema');
  EXCEPTION WHEN unique_violation THEN rechazado:=true; END;
  IF NOT rechazado THEN RAISE EXCEPTION 'Nueva entrada repetida aceptada'; END IF;
  INSERT INTO resultado_auditoria VALUES(perfil||': una nueva recepcion sigue exigiendo lote distinto',true);
  END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 SELECT id INTO usuario FROM farmacia.perfiles WHERE activo AND rol='despacho' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',usuario,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 rechazado:=false;
 BEGIN PERFORM farmacia.inventario_baja(l2,7); EXCEPTION WHEN insufficient_privilege THEN rechazado:=true; END;
 IF NOT rechazado THEN RAISE EXCEPTION 'Despacho pudo dar de baja'; END IF;
 INSERT INTO resultado_auditoria VALUES('despacho: baja denegada',true);
 rechazado:=false;
 BEGIN PERFORM farmacia.inventario_guardar_conteo(jsonb_build_object(l2::text,jsonb_build_object('real',2,'sis',7)),'Conteo de prueba'); EXCEPTION WHEN insufficient_privilege THEN rechazado:=true; END;
 IF NOT rechazado THEN RAISE EXCEPTION 'Despacho pudo corregir inventario'; END IF;
 INSERT INTO resultado_auditoria VALUES('despacho: correccion denegada',true);
 EXECUTE 'RESET ROLE';
END $$;
SELECT count(*) casos_correctos FROM resultado_auditoria WHERE correcto;
ROLLBACK;

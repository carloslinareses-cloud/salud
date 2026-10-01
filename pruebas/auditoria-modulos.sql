-- Ejecuto CRUD con permisos reales. Todos los datos y cambios se revierten.
BEGIN;
CREATE TEMP TABLE resultados_modulos(caso text) ON COMMIT DROP;
GRANT INSERT,SELECT ON resultados_modulos TO authenticated;
DO $$
DECLARE usuario uuid; rol_prueba text; centro uuid; req uuid; evento uuid; registro uuid;
 producto uuid; control uuid; n integer; datos jsonb; ced text; fallado boolean;
BEGIN
 FOREACH rol_prueba IN ARRAY ARRAY['admin','inventario'] LOOP
  SELECT id INTO usuario FROM farmacia.perfiles WHERE activo AND rol=rol_prueba LIMIT 1;
  IF usuario IS NULL THEN RAISE EXCEPTION 'Falta perfil %',rol_prueba; END IF;
  PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',usuario,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO farmacia.productos(nombre,categoria) VALUES('ZZZ AUDITORIA MODULOS '||gen_random_uuid(),'insumo') RETURNING id INTO producto;
  INSERT INTO farmacia.instituciones(nombre,tipo) VALUES('ZZZ AUDITORIA CENTRO '||gen_random_uuid(),'CDI') RETURNING id INTO centro;
  UPDATE farmacia.instituciones SET responsable='ZZZ CORREGIDO' WHERE id=centro;
  IF NOT EXISTS(SELECT 1 FROM farmacia.instituciones WHERE id=centro AND responsable='ZZZ CORREGIDO') THEN RAISE EXCEPTION 'Centro no corregido'; END IF;
  INSERT INTO farmacia.requerimientos_institucion(institucion_id,producto_id,cantidad) VALUES(centro,producto,3) RETURNING id INTO req;
  UPDATE farmacia.requerimientos_institucion SET cantidad=5 WHERE id=req;
  IF NOT EXISTS(SELECT 1 FROM farmacia.requerimientos_institucion WHERE id=req AND cantidad=5) THEN RAISE EXCEPTION 'Requerimiento no corregido'; END IF;
  UPDATE farmacia.requerimientos_institucion SET activo=false WHERE id=req;
  IF NOT EXISTS(SELECT 1 FROM farmacia.requerimientos_institucion WHERE id=req AND NOT activo) THEN RAISE EXCEPTION 'Requerimiento no quitado'; END IF;
  INSERT INTO resultados_modulos VALUES(rol_prueba||': centros crear leer corregir y quitar requerimiento');

  INSERT INTO farmacia.jornadas_eventos(tipo,fecha,lugar,firmas) VALUES('jornadas',current_date,'ZZZ AUDITORIA','[]') RETURNING id INTO evento;
  INSERT INTO farmacia.jornadas_registros(evento_id,conjunto,nombre,estado) VALUES(evento,'jornadas','ZZZ AUDITORIA PERSONA','activo') RETURNING id INTO registro;
  UPDATE farmacia.jornadas_registros SET tratamiento='ZZZ CORREGIDO' WHERE id=registro;
  IF NOT EXISTS(SELECT 1 FROM farmacia.jornadas_registros WHERE id=registro AND tratamiento='ZZZ CORREGIDO') THEN RAISE EXCEPTION 'Jornada no corregida'; END IF;
  DELETE FROM farmacia.jornadas_registros WHERE id=registro;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF rol_prueba='admin' THEN
   IF n<>1 OR EXISTS(SELECT 1 FROM farmacia.jornadas_registros WHERE id=registro) THEN RAISE EXCEPTION 'Jornada no borrada'; END IF;
  ELSE
   IF n<>0 OR NOT EXISTS(SELECT 1 FROM farmacia.jornadas_registros WHERE id=registro) THEN RAISE EXCEPTION 'Inventario pudo borrar Jornadas'; END IF;
  END IF;
  INSERT INTO resultados_modulos VALUES(rol_prueba||': jornadas crear leer corregir y comprobar permiso de borrar');

  datos:=jsonb_build_object('fecha',current_date::text,'persona','ZZZ AUDITORIA','categoria','MEDICINA','items',jsonb_build_array(jsonb_build_object('descripcion','ZZZ INSUMO','cantidad',2)));
  control:=farmacia.insumos_control_guardar(null,datos);
  IF NOT EXISTS(SELECT 1 FROM farmacia.insumos_control_entregas_items WHERE entrega_id=control AND cantidad=2) THEN RAISE EXCEPTION 'Control no creado'; END IF;
  datos:=jsonb_set(datos,'{items,0,cantidad}','4');
  PERFORM farmacia.insumos_control_guardar(control,datos);
  IF NOT EXISTS(SELECT 1 FROM farmacia.insumos_control_entregas_items WHERE entrega_id=control AND cantidad=4) THEN RAISE EXCEPTION 'Control no corregido'; END IF;
  IF rol_prueba='admin' THEN
   PERFORM farmacia.insumos_control_anular(control,'Auditoria transaccional');
   IF NOT EXISTS(SELECT 1 FROM farmacia.insumos_control_entregas WHERE id=control AND anulada) THEN RAISE EXCEPTION 'Control no anulado'; END IF;
  ELSE
   fallado:=false;
   BEGIN PERFORM farmacia.insumos_control_anular(control,'Auditoria transaccional');
   EXCEPTION WHEN raise_exception THEN fallado:=true; END;
   IF NOT fallado OR NOT EXISTS(SELECT 1 FROM farmacia.insumos_control_entregas WHERE id=control AND NOT anulada) THEN RAISE EXCEPTION 'Inventario pudo anular control'; END IF;
  END IF;
  INSERT INTO resultados_modulos VALUES(rol_prueba||': control de insumos crear leer corregir y comprobar permiso de anular');
  EXECUTE 'RESET ROLE';
 END LOOP;

 SELECT id INTO usuario FROM farmacia.perfiles WHERE activo AND rol='admin' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',usuario::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',usuario,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 LOOP
  ced:=(800000000+floor(random()*99999999))::bigint::text;
  EXIT WHEN NOT EXISTS(SELECT 1 FROM farmacia.asistencia_personal WHERE cedula=ced);
 END LOOP;
 PERFORM farmacia.asis_admin_crear_personal(ced,'ZZZ AUDITORIA PERSONAL',null,null,'ClavePruebaTemporal-37');
 IF NOT EXISTS(SELECT 1 FROM farmacia.asistencia_personal WHERE cedula=ced AND activo) THEN RAISE EXCEPTION 'Personal no creado'; END IF;
 PERFORM farmacia.asis_admin_registrar_manual(ced,current_date,'08:00','16:00','Auditoria transaccional');
 IF NOT EXISTS(SELECT 1 FROM farmacia.asistencia_registros WHERE cedula=ced AND fecha=current_date AND hora_salida IS NOT NULL) THEN RAISE EXCEPTION 'Asistencia manual no guardada'; END IF;
 PERFORM farmacia.asis_admin_registrar_manual(ced,current_date,'08:15','16:15','Correccion transaccional');
 IF (SELECT count(*) FROM farmacia.asistencia_registros WHERE cedula=ced AND fecha=current_date)<>1 THEN RAISE EXCEPTION 'Asistencia duplicada'; END IF;
 UPDATE farmacia.asistencia_personal SET activo=false WHERE cedula=ced;
 IF NOT EXISTS(SELECT 1 FROM farmacia.asistencia_personal WHERE cedula=ced AND NOT activo) THEN RAISE EXCEPTION 'Personal no desactivado'; END IF;
 INSERT INTO resultados_modulos VALUES('admin: personal y asistencia manual crear leer corregir y desactivar');
 EXECUTE 'RESET ROLE';
END $$;
SELECT count(*) casos_correctos FROM resultados_modulos;
ROLLBACK;

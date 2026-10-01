-- Unificacion fisica autorizada por Carlos: conservar el vencimiento mas cercano.
-- Acetaminofen: retirar las 13 unidades ya contabilizadas manualmente, sin sumarlas.
-- Los movimientos conservan sus identificadores, cantidades, autores y fechas.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='60s';
LOCK TABLE farmacia.productos, farmacia.lotes, farmacia.movimientos,
 farmacia.entrega_detalle, farmacia.insumos_salidas, farmacia.tratamientos_paciente,
 farmacia.requerimientos_institucion, farmacia.insumos_entregas_cds_items
 IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS farmacia.unificaciones_lotes (
 clave text PRIMARY KEY,
 creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 respaldo jsonb NOT NULL,
 resultado jsonb NOT NULL
);
ALTER TABLE farmacia.unificaciones_lotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON farmacia.unificaciones_lotes FROM PUBLIC,anon,authenticated;

DO $$
DECLARE
 clave_operacion text:='unificacion-fisica-lotes-20261001';
 principal_producto uuid:='bd234c33-ac30-4f2c-8a5d-060c8ec829dc';
 alias_producto uuid:='8c67628c-593c-4c2c-b71c-6bc0c49dbbfc';
 duplicado_manual uuid:='0b6d7904-cef9-4c76-af76-2d4e36eaf8ee';
 fila record; lote_principal uuid; saldo_manual numeric; total_inicial numeric;
 cantidad_movimientos bigint; saldo_resultante numeric;
 existencias_antes jsonb; respaldo_operacion jsonb; informe jsonb:='[]';
 fuentes jsonb; vencimiento date; lotes_eliminados integer:=0; n integer;
BEGIN
 IF EXISTS(SELECT 1 FROM farmacia.unificaciones_lotes WHERE clave=clave_operacion) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%') THEN
  RAISE EXCEPTION 'No se encontro al administrador responsable';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%' LIMIT 1),true);

 -- Las dos fichas de acetaminofen deben coincidir en todo salvo nombre, id y fechas.
 IF (SELECT count(*) FROM farmacia.productos WHERE id IN (principal_producto,alias_producto))<>2 OR
   (SELECT to_jsonb(p)-ARRAY['id','nombre','creado_en'] FROM farmacia.productos p WHERE id=principal_producto)
   IS DISTINCT FROM
   (SELECT to_jsonb(p)-ARRAY['id','nombre','creado_en'] FROM farmacia.productos p WHERE id=alias_producto) OR
   (SELECT regexp_replace(upper(nombre),'\s','','g') FROM farmacia.productos WHERE id=principal_producto)
   IS DISTINCT FROM
   (SELECT regexp_replace(upper(nombre),'\s','','g') FROM farmacia.productos WHERE id=alias_producto) THEN
  RAISE EXCEPTION 'Las fichas de acetaminofen no son equivalentes';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM farmacia.lotes WHERE id=duplicado_manual AND producto_id=alias_producto AND codigo='230921' AND estado='disponible') OR
   (SELECT count(*) FROM farmacia.lotes WHERE producto_id=alias_producto)<>1 THEN
  RAISE EXCEPTION 'El duplicado manual no coincide con el registro autorizado';
 END IF;
 SELECT coalesce(sum(cantidad),0) INTO saldo_manual FROM farmacia.movimientos WHERE lote_id=duplicado_manual;
 IF saldo_manual<>13 THEN RAISE EXCEPTION 'El registro de 13 unidades cambio; revisar antes de retirar'; END IF;

 CREATE TEMP TABLE fusion_grupos ON COMMIT DROP AS
 SELECT producto_id,farmacia.normalizar_codigo_lote(codigo) codigo,array_agg(id ORDER BY id) ids,
        min(vence) vence_min FROM farmacia.lotes WHERE farmacia.normalizar_codigo_lote(codigo)<>''
 GROUP BY producto_id,farmacia.normalizar_codigo_lote(codigo) HAVING count(*)>1;
 IF (SELECT count(*) FROM fusion_grupos)<>23 OR EXISTS(
  SELECT 1 FROM farmacia.lotes l JOIN fusion_grupos g ON l.id=ANY(g.ids) WHERE l.estado<>'disponible'
 ) THEN RAISE EXCEPTION 'El alcance de duplicados cambio'; END IF;
 CREATE TEMP TABLE fusion_ids ON COMMIT DROP AS
 SELECT unnest(ids) id FROM fusion_grupos UNION SELECT duplicado_manual;

 SELECT jsonb_build_object(
  'productos',(SELECT jsonb_agg(p) FROM farmacia.productos p WHERE id IN (SELECT producto_id FROM fusion_grupos UNION SELECT alias_producto)),
  'lotes',(SELECT jsonb_agg(l) FROM farmacia.lotes l WHERE id IN (SELECT id FROM fusion_ids)),
  'movimientos',(SELECT jsonb_agg(m) FROM farmacia.movimientos m WHERE lote_id IN (SELECT id FROM fusion_ids)),
  'entrega_detalle',(SELECT jsonb_agg(d) FROM farmacia.entrega_detalle d WHERE lote_id IN (SELECT id FROM fusion_ids)),
  'insumos_salidas',(SELECT jsonb_agg(s) FROM farmacia.insumos_salidas s WHERE lote_id IN (SELECT id FROM fusion_ids)),
  'tratamientos_alias',(SELECT jsonb_agg(t) FROM farmacia.tratamientos_paciente t WHERE producto_id=alias_producto),
  'requerimientos_alias',(SELECT jsonb_agg(r) FROM farmacia.requerimientos_institucion r WHERE producto_id=alias_producto),
  'insumos_items_alias',(SELECT jsonb_agg(i) FROM farmacia.insumos_entregas_cds_items i WHERE producto_id=alias_producto)
 ) INTO respaldo_operacion;
 SELECT jsonb_object_agg(producto_id,saldo) INTO existencias_antes FROM (
  SELECT l.producto_id,sum(m.cantidad) saldo FROM farmacia.lotes l JOIN farmacia.movimientos m ON m.lote_id=l.id
  WHERE l.producto_id IN (SELECT producto_id FROM fusion_grupos) GROUP BY l.producto_id
 ) a;
 SELECT count(*) INTO cantidad_movimientos FROM farmacia.movimientos;
 SELECT sum(cantidad) INTO total_inicial FROM farmacia.movimientos;

 -- Este ajuste retira el duplicado manual; no agrega unidades al lote principal.
 INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
 VALUES(duplicado_manual,'ajuste',-13,'Retiro registro duplicado: Carlos indica que las 13 unidades de acetaminofen ya fueron contabilizadas manualmente.','sistema');

 -- Excepcion limitada a esta transaccion: cambiar solamente la referencia de lote.
 -- El candado se restablece antes de validar; cualquier error revierte todo.
 ALTER TABLE farmacia.movimientos DISABLE TRIGGER tr_movimiento_inmutable;
 FOR fila IN SELECT * FROM fusion_grupos ORDER BY producto_id,codigo LOOP
  -- Conservar el registro con mayor existencia; los movimientos se trasladan, no se duplican.
  SELECT l.id INTO lote_principal FROM farmacia.lotes l LEFT JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id
   WHERE l.id=ANY(fila.ids) ORDER BY coalesce(v.existencia,0) DESC,l.id LIMIT 1;
  vencimiento:=fila.vence_min;
  IF fila.producto_id=principal_producto AND fila.codigo='230921' THEN
   fila.ids:=array_append(fila.ids,duplicado_manual);
   SELECT min(vence) INTO vencimiento FROM farmacia.lotes WHERE id=ANY(fila.ids);
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',l.id,'codigo',l.codigo,'vence',l.vence,'existencia',
   (SELECT coalesce(sum((m->>'cantidad')::numeric),0) FROM jsonb_array_elements(respaldo_operacion->'movimientos') m
    WHERE (m->>'lote_id')::uuid=l.id))) INTO fuentes FROM farmacia.lotes l WHERE l.id=ANY(fila.ids);
  UPDATE farmacia.movimientos SET lote_id=lote_principal WHERE lote_id=ANY(fila.ids) AND lote_id<>lote_principal;
  UPDATE farmacia.entrega_detalle SET lote_id=lote_principal WHERE lote_id=ANY(fila.ids) AND lote_id<>lote_principal;
  UPDATE farmacia.insumos_salidas SET lote_id=lote_principal WHERE lote_id=ANY(fila.ids) AND lote_id<>lote_principal;
  DELETE FROM farmacia.lotes WHERE id=ANY(fila.ids) AND id<>lote_principal;
  GET DIAGNOSTICS n=ROW_COUNT; lotes_eliminados:=lotes_eliminados+n;
  UPDATE farmacia.lotes SET vence=vencimiento,nota=concat_ws(E'\n',nullif(nota,''),
   'Unificacion fisica autorizada: conservo el vencimiento mas cercano. Registros y fechas originales respaldados en la operacion '||clave_operacion||'.') WHERE id=lote_principal;
  SELECT coalesce(sum(cantidad),0) INTO saldo_resultante FROM farmacia.movimientos WHERE lote_id=lote_principal;
  informe:=informe||jsonb_build_array(jsonb_build_object('producto_id',fila.producto_id,'producto',
   (SELECT nombre FROM farmacia.productos WHERE id=fila.producto_id),'codigo',fila.codigo,'lote_id',lote_principal,
   'cantidad',saldo_resultante,'vence',vencimiento,'registros_anteriores',cardinality(fila.ids),'fuentes',fuentes,
   'retirado_sin_sumar',CASE WHEN fila.producto_id=principal_producto AND fila.codigo='230921' THEN 13 ELSE 0 END));
 END LOOP;
 ALTER TABLE farmacia.movimientos ENABLE TRIGGER tr_movimiento_inmutable;

 -- Mantener las referencias a la ficha de acetaminofen sin perder tratamientos o entregas.
 UPDATE farmacia.tratamientos_paciente SET producto_id=principal_producto WHERE producto_id=alias_producto;
 UPDATE farmacia.requerimientos_institucion SET producto_id=principal_producto WHERE producto_id=alias_producto;
 UPDATE farmacia.insumos_entregas_cds_items SET producto_id=principal_producto WHERE producto_id=alias_producto;
 UPDATE farmacia.insumos_salidas SET producto_id=principal_producto WHERE producto_id=alias_producto;
 DELETE FROM farmacia.productos WHERE id=alias_producto;
 IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE producto_id=alias_producto) OR
   (SELECT count(*) FROM farmacia.lotes WHERE producto_id=principal_producto AND farmacia.normalizar_codigo_lote(codigo)='230921')<>1 OR
   EXISTS(SELECT 1 FROM farmacia.lotes GROUP BY producto_id,farmacia.normalizar_codigo_lote(codigo)
          HAVING count(*)>1 AND farmacia.normalizar_codigo_lote(codigo)<>'') THEN
  RAISE EXCEPTION 'Quedaron duplicados en inventario';
 END IF;
 IF (SELECT sum(cantidad) FROM farmacia.movimientos) IS DISTINCT FROM total_inicial-13 OR
  (SELECT count(*) FROM farmacia.movimientos)<>cantidad_movimientos+1 OR
  (SELECT md5(string_agg((to_jsonb(m)-'lote_id')::text,'|' ORDER BY id)) FROM farmacia.movimientos m
   WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(respaldo_operacion->'movimientos') x))
   IS DISTINCT FROM
  (SELECT md5(string_agg((x-'lote_id')::text,'|' ORDER BY (x->>'id')::uuid)) FROM jsonb_array_elements(respaldo_operacion->'movimientos') x) THEN
  RAISE EXCEPTION 'Las cantidades o los movimientos historicos cambiaron indebidamente';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(existencias_antes) e WHERE e.value::numeric IS DISTINCT FROM (
   SELECT coalesce(sum(m.cantidad),0) FROM farmacia.movimientos m JOIN farmacia.lotes l ON l.id=m.lote_id WHERE l.producto_id=e.key::uuid
 )) THEN RAISE EXCEPTION 'Cambio la existencia de un medicamento'; END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='farmacia.movimientos'::regclass AND tgname='tr_movimiento_inmutable')<>'O' THEN
  RAISE EXCEPTION 'El candado historico no quedo restablecido';
 END IF;
 INSERT INTO farmacia.unificaciones_lotes(clave,respaldo,resultado) VALUES(clave_operacion,respaldo_operacion,
  jsonb_build_object('grupos',informe,'lotes_eliminados',lotes_eliminados,'retirado_manual',13,'cantidades_conservadas',true,'historial_conservado',true));
END $$;
SELECT clave,creado_en,resultado FROM farmacia.unificaciones_lotes WHERE clave='unificacion-fisica-lotes-20261001';
COMMIT;

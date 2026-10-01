-- Carlos confirma que V224 y LV224 corresponden al mismo lote de aciclovir 400 mg.
-- Conservo V224, sumo las unidades y preservo los codigos originales en el respaldo.
BEGIN;
SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='60s';
LOCK TABLE farmacia.productos,farmacia.lotes,farmacia.movimientos,farmacia.entrega_detalle,farmacia.insumos_salidas,farmacia.tratamientos_paciente,farmacia.requerimientos_institucion,farmacia.insumos_entregas_cds_items IN SHARE ROW EXCLUSIVE MODE;
DO $$
#variable_conflict use_column
DECLARE clave_op text:='aciclovir-v224-lv224-confirmado-20261002'; r record; g record; principal uuid; respaldo_op jsonb; informe jsonb:='[]'; fuentes jsonb; total numeric; huella text; n integer; eliminados integer:=0; saldo numeric;
BEGIN
IF EXISTS(SELECT 1 FROM farmacia.unificaciones_lotes WHERE clave=clave_op) THEN RETURN; END IF;
IF NOT EXISTS(SELECT 1 FROM farmacia.lotes WHERE id='4ecdbcbb-86dc-4c57-9a6d-849be57af72d' AND codigo='LV224' AND producto_id='902ed303-958b-4050-9c29-8389024a0c33') OR NOT EXISTS(SELECT 1 FROM farmacia.lotes WHERE id='aeeadc00-5c5e-42f6-8734-488984311b49' AND codigo='V224' AND producto_id='c59eeeed-f927-4da5-9eac-f6b2548a53eb') THEN RAISE EXCEPTION 'Los lotes confirmados cambiaron'; END IF;
PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%' LIMIT 1),true);
CREATE TEMP TABLE equivalencias(principal uuid,alias uuid,nombre text,nombre_alias text) ON COMMIT DROP;
INSERT INTO equivalencias VALUES ('c59eeeed-f927-4da5-9eac-f6b2548a53eb'::uuid,'902ed303-958b-4050-9c29-8389024a0c33'::uuid,'ACICLOVIR 400 MG','ACICLOVIR 400MG');
IF EXISTS(SELECT 1 FROM equivalencias e LEFT JOIN farmacia.productos p ON p.id=e.principal LEFT JOIN farmacia.productos q ON q.id=e.alias WHERE p.nombre IS DISTINCT FROM e.nombre OR q.nombre IS DISTINCT FROM e.nombre_alias OR (to_jsonb(p)-ARRAY['id','nombre','presentacion','creado_en','stock_minimo']) IS DISTINCT FROM (to_jsonb(q)-ARRAY['id','nombre','presentacion','creado_en','stock_minimo'])) THEN RAISE EXCEPTION 'Las fichas revisadas cambiaron o difieren en su unidad de inventario'; END IF;
CREATE TEMP TABLE ids_fusion ON COMMIT DROP AS SELECT l.id FROM farmacia.lotes l WHERE l.producto_id IN(SELECT principal FROM equivalencias UNION SELECT alias FROM equivalencias);
IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE id IN(SELECT id FROM ids_fusion) AND estado<>'disponible') THEN RAISE EXCEPTION 'Un lote no esta disponible'; END IF;
SELECT jsonb_build_object('productos',(SELECT jsonb_agg(p) FROM farmacia.productos p WHERE id IN(SELECT principal FROM equivalencias UNION SELECT alias FROM equivalencias)),'lotes',(SELECT jsonb_agg(l) FROM farmacia.lotes l WHERE id IN(SELECT id FROM ids_fusion)),'movimientos',(SELECT jsonb_agg(m) FROM farmacia.movimientos m WHERE lote_id IN(SELECT id FROM ids_fusion)),'entrega_detalle',(SELECT jsonb_agg(d) FROM farmacia.entrega_detalle d WHERE lote_id IN(SELECT id FROM ids_fusion)),'insumos_salidas',(SELECT jsonb_agg(s) FROM farmacia.insumos_salidas s WHERE producto_id IN(SELECT alias FROM equivalencias)),'tratamientos',(SELECT jsonb_agg(t) FROM farmacia.tratamientos_paciente t WHERE producto_id IN(SELECT alias FROM equivalencias)),'requerimientos',(SELECT jsonb_agg(t) FROM farmacia.requerimientos_institucion t WHERE producto_id IN(SELECT alias FROM equivalencias)),'insumos_items',(SELECT jsonb_agg(t) FROM farmacia.insumos_entregas_cds_items t WHERE producto_id IN(SELECT alias FROM equivalencias))) INTO respaldo_op;
SELECT sum(cantidad),md5(string_agg((to_jsonb(m)-'lote_id')::text,'|' ORDER BY id)) INTO total,huella FROM farmacia.movimientos m;
ALTER TABLE farmacia.movimientos DISABLE TRIGGER tr_movimiento_inmutable;
FOR r IN SELECT * FROM equivalencias LOOP
 FOR g IN SELECT CASE WHEN l.id='4ecdbcbb-86dc-4c57-9a6d-849be57af72d'::uuid THEN 'V224' ELSE farmacia.normalizar_codigo_lote(l.codigo) END codigo,array_agg(l.id) ids,min(l.vence) vence_min FROM farmacia.lotes l WHERE l.producto_id IN(r.principal,r.alias) AND farmacia.normalizar_codigo_lote(l.codigo)<>'' GROUP BY 1 HAVING count(*)>1 LOOP
  SELECT l.id INTO principal FROM farmacia.lotes l JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id WHERE l.id=ANY(g.ids) ORDER BY (l.producto_id=r.principal) DESC,v.existencia DESC,l.id LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('id',l.id,'codigo',l.codigo,'vence',l.vence,'existencia',v.existencia)) INTO fuentes FROM farmacia.lotes l JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id WHERE l.id=ANY(g.ids);
  SELECT sum(cantidad) INTO saldo FROM farmacia.movimientos WHERE lote_id=ANY(g.ids);
  UPDATE farmacia.movimientos SET lote_id=principal WHERE lote_id=ANY(g.ids) AND lote_id<>principal;
  UPDATE farmacia.entrega_detalle SET lote_id=principal WHERE lote_id=ANY(g.ids) AND lote_id<>principal;
  UPDATE farmacia.insumos_salidas SET lote_id=principal WHERE lote_id=ANY(g.ids) AND lote_id<>principal;
  DELETE FROM farmacia.lotes WHERE id=ANY(g.ids) AND id<>principal; GET DIAGNOSTICS n=ROW_COUNT; eliminados:=eliminados+n;
  UPDATE farmacia.lotes SET producto_id=r.principal,vence=g.vence_min,nota=concat_ws(E'\n',nullif(nota,''),'Unificacion de fichas equivalentes: vencimiento mas cercano; respaldo '||clave_op) WHERE id=principal;
  IF (SELECT sum(cantidad) FROM farmacia.movimientos WHERE lote_id=principal) IS DISTINCT FROM saldo THEN RAISE EXCEPTION 'La cantidad del lote cambio'; END IF;
  informe:=informe||jsonb_build_array(jsonb_build_object('producto_id',r.principal,'producto',r.nombre,'codigo',g.codigo,'lote_id',principal,'cantidad',coalesce(saldo,0),'vence',g.vence_min,'registros_anteriores',cardinality(g.ids),'fuentes',fuentes,'retirado_sin_sumar',0));
 END LOOP;
 UPDATE farmacia.lotes SET producto_id=r.principal WHERE producto_id=r.alias;
 UPDATE farmacia.tratamientos_paciente SET producto_id=r.principal WHERE producto_id=r.alias;
 UPDATE farmacia.requerimientos_institucion SET producto_id=r.principal WHERE producto_id=r.alias;
 UPDATE farmacia.insumos_entregas_cds_items SET producto_id=r.principal WHERE producto_id=r.alias;
 UPDATE farmacia.insumos_salidas SET producto_id=r.principal WHERE producto_id=r.alias;
 DELETE FROM farmacia.productos WHERE id=r.alias;
END LOOP;
FOR r IN SELECT DISTINCT e.principal FROM equivalencias e LOOP
 IF (SELECT coalesce(sum(m.cantidad),0) FROM farmacia.movimientos m JOIN farmacia.lotes l ON l.id=m.lote_id WHERE l.producto_id=r.principal) IS DISTINCT FROM (SELECT coalesce(sum((m->>'cantidad')::numeric),0) FROM jsonb_array_elements(respaldo_op->'movimientos') m JOIN jsonb_array_elements(respaldo_op->'lotes') l ON l->>'id'=m->>'lote_id' WHERE (l->>'producto_id')::uuid IN(SELECT e.alias FROM equivalencias e WHERE e.principal=r.principal UNION SELECT r.principal)) THEN RAISE EXCEPTION 'La suma por medicamento no se conservo'; END IF;
END LOOP;
ALTER TABLE farmacia.movimientos ENABLE TRIGGER tr_movimiento_inmutable;
IF (SELECT sum(cantidad) FROM farmacia.movimientos) IS DISTINCT FROM total OR (SELECT md5(string_agg((to_jsonb(m)-'lote_id')::text,'|' ORDER BY id)) FROM farmacia.movimientos m) IS DISTINCT FROM huella THEN RAISE EXCEPTION 'Cambio el historial o la cantidad total'; END IF;
IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE producto_id IN(SELECT principal FROM equivalencias) GROUP BY producto_id,farmacia.normalizar_codigo_lote(codigo) HAVING count(*)>1 AND farmacia.normalizar_codigo_lote(codigo)<>'') THEN RAISE EXCEPTION 'Quedaron lotes duplicados'; END IF;
IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='farmacia.movimientos'::regclass AND tgname='tr_movimiento_inmutable')<>'O' THEN RAISE EXCEPTION 'Candado no restablecido'; END IF;
INSERT INTO farmacia.unificaciones_lotes(clave,respaldo,resultado) VALUES(clave_op,respaldo_op,jsonb_build_object('grupos',informe,'lotes_eliminados',eliminados,'fichas_unificadas',(SELECT count(*) FROM equivalencias),'cantidades_conservadas',true,'historial_conservado',true));
END $$;
SELECT resultado FROM farmacia.unificaciones_lotes WHERE clave='aciclovir-v224-lv224-confirmado-20261002';
COMMIT;

BEGIN;
DO $$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM farmacia.unificaciones_lotes WHERE clave IN('unificacion-fichas-lotes-20261002','unificacion-fichas-lotes-20261002b'))<>2 THEN RAISE EXCEPTION 'Operaciones incompletas'; END IF;
 IF (SELECT sum((resultado->>'lotes_eliminados')::integer) FROM farmacia.unificaciones_lotes WHERE clave IN('unificacion-fichas-lotes-20261002','unificacion-fichas-lotes-20261002b'))<>31 THEN RAISE EXCEPTION 'Cantidad retirada incorrecta'; END IF;
 FOR r IN SELECT g FROM farmacia.unificaciones_lotes a CROSS JOIN LATERAL jsonb_array_elements(a.resultado->'grupos') g WHERE a.clave IN('unificacion-fichas-lotes-20261002','unificacion-fichas-lotes-20261002b') LOOP
  IF NOT EXISTS(SELECT 1 FROM farmacia.lotes l WHERE l.id=(r.g->>'lote_id')::uuid) AND NOT EXISTS(SELECT 1 FROM farmacia.unificaciones_lotes a CROSS JOIN LATERAL jsonb_array_elements(a.resultado->'grupos') g CROSS JOIN LATERAL jsonb_array_elements(g->'fuentes') f WHERE f->>'id'=r.g->>'lote_id' AND f->>'id'<>g->>'lote_id') THEN RAISE EXCEPTION 'Lote conservado sin seguimiento'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE farmacia.normalizar_codigo_lote(codigo)<>'' GROUP BY producto_id,farmacia.normalizar_codigo_lote(codigo) HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicados por ficha y lote'; END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='farmacia.movimientos'::regclass AND tgname='tr_movimiento_inmutable')<>'O' THEN RAISE EXCEPTION 'Candado desactivado'; END IF;
 PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%' LIMIT 1),true);
 IF EXISTS(SELECT 1 FROM farmacia.v_lotes_unificados GROUP BY lote_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Informe duplicado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM farmacia.v_lotes_unificados WHERE lote='230921' AND existencia=297 AND retirado_sin_sumar=13) THEN RAISE EXCEPTION 'Cambio la excepcion manual'; END IF;
 IF (SELECT count(*) FROM farmacia.lotes WHERE codigo='20250620' AND producto_id IN(SELECT id FROM farmacia.productos WHERE nombre LIKE 'JERINGA 20%'))<>1 THEN RAISE EXCEPTION 'Jeringas duplicadas'; END IF;
END $$;
SELECT 'Unificaciones sucesivas, historial, informe y excepcion manual correctos' comprobacion;
ROLLBACK;

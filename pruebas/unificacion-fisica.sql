BEGIN;
DO $$
DECLARE u uuid; perfil text; n integer; informe jsonb;
BEGIN
 SELECT resultado INTO informe FROM farmacia.unificaciones_lotes WHERE clave='unificacion-fisica-lotes-20261001';
 IF informe IS NULL OR jsonb_array_length(informe->'grupos')<>23 OR (informe->>'retirado_manual')::numeric<>13 THEN RAISE EXCEPTION 'Resultado incompleto'; END IF;
 IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE farmacia.normalizar_codigo_lote(codigo)<>'' GROUP BY producto_id,farmacia.normalizar_codigo_lote(codigo) HAVING count(*)>1) THEN RAISE EXCEPTION 'Persisten duplicados'; END IF;
 IF (SELECT count(*) FROM farmacia.lotes WHERE farmacia.normalizar_codigo_lote(codigo)='230921')<>1 OR EXISTS(SELECT 1 FROM farmacia.lotes WHERE id='0b6d7904-cef9-4c76-af76-2d4e36eaf8ee') THEN RAISE EXCEPTION 'Acetaminofen duplicado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM farmacia.lotes WHERE codigo='230921' AND vence='2028-08-09') THEN RAISE EXCEPTION 'Vencimiento incorrecto'; END IF;
 FOREACH perfil IN ARRAY ARRAY['admin','inventario','despacho'] LOOP
  SELECT id INTO u FROM farmacia.perfiles WHERE activo AND rol=perfil LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'Falta perfil %',perfil; END IF;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM farmacia.v_lotes_unificados;
  IF (perfil IN ('admin','inventario') AND n<>23) OR (perfil='despacho' AND n<>0) THEN RAISE EXCEPTION 'Permiso del informe incorrecto'; END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT 'Unificacion fisica, excepcion manual y permisos correctos' resultado;
ROLLBACK;

BEGIN;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM farmacia.productos WHERE regexp_replace(upper(nombre),'[[:space:]]','','g')='ACICLOVIR400MG';
 IF n<>1 THEN RAISE EXCEPTION 'Quedaron fichas duplicadas de aciclovir'; END IF;
 IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE id='4ecdbcbb-86dc-4c57-9a6d-849be57af72d') OR NOT EXISTS(SELECT 1 FROM farmacia.lotes l JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id WHERE l.id='aeeadc00-5c5e-42f6-8734-488984311b49' AND l.codigo='V224' AND l.vence='2027-05-10' AND v.existencia=328) THEN RAISE EXCEPTION 'Unificacion incorrecta de aciclovir'; END IF;
 PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%' LIMIT 1),true);
 IF (SELECT count(*) FROM farmacia.v_lotes_unificados WHERE producto='ACICLOVIR 400 MG')<>1 OR NOT EXISTS(SELECT 1 FROM farmacia.v_lotes_unificados WHERE producto='ACICLOVIR 400 MG' AND registros_anteriores=3 AND existencia=328) THEN RAISE EXCEPTION 'Informe acumulado incorrecto'; END IF;
END $$;
SELECT 'Aciclovir: una ficha, un lote, 328 unidades e informe sin duplicados' comprobacion;
ROLLBACK;

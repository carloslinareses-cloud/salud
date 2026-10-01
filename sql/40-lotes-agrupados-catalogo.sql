-- Un codigo por medicamento. El detalle por vencimiento y sus movimientos se conserva.
BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP TABLE snapshot_lotes_unificados ON COMMIT DROP AS SELECT
 md5((SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb)::text FROM farmacia.lotes l)) lotes,
 md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text FROM farmacia.movimientos m)) movimientos,
 (SELECT jsonb_agg(to_jsonb(c)-'lotes'-'lotes_con_existencia' ORDER BY producto_id) FROM farmacia.v_catalogo c) catalogo;
CREATE OR REPLACE VIEW farmacia.v_catalogo AS
 SELECT p.id AS producto_id,
    p.nombre AS producto,
    p.dosificacion,
    p.presentacion,
    p.categoria,
    p.unidad,
    p.stock_minimo,
    p.empaque,
    p.unidades_por_empaque,
    COALESCE(e.disponible, 0::numeric) AS disponible,
    COALESCE(e.vencido, 0::numeric) AS vencido,
    COALESCE(e.total, 0::numeric) AS total,
    COALESCE(e.lotes, 0::bigint) AS lotes,
    COALESCE(e.lotes_con_existencia, 0::bigint) AS lotes_con_existencia,
    e.vence_primero,
    farmacia.en_cajas(COALESCE(e.disponible, 0::numeric), p.unidades_por_empaque, p.empaque) AS en_cajas,
        CASE
            WHEN COALESCE(e.disponible, 0::numeric) <= 0::numeric AND COALESCE(e.vencido, 0::numeric) > 0::numeric THEN 'solo_vencido'::text
            WHEN COALESCE(e.disponible, 0::numeric) <= 0::numeric THEN 'sin_existencia'::text
            WHEN e.vence_primero IS NOT NULL AND e.vence_primero <= (CURRENT_DATE + 30) THEN 'por_vencer_30'::text
            WHEN e.vence_primero IS NOT NULL AND e.vence_primero <= (CURRENT_DATE + 90) THEN 'por_vencer_90'::text
            WHEN p.stock_minimo IS NOT NULL AND p.stock_minimo > 0 AND COALESCE(e.disponible, 0::numeric) < p.stock_minimo::numeric THEN 'bajo_minimo'::text
            ELSE 'bien'::text
        END AS situacion,
    farmacia.sin_acentos(upper(p.nombre)) AS busqueda
   FROM farmacia.productos p
     LEFT JOIN ( SELECT v.producto_id,
            sum(v.existencia) FILTER (WHERE v.situacion = ANY (ARRAY['vigente'::text, 'por_vencer_30'::text, 'por_vencer_90'::text, 'sin_fecha'::text])) AS disponible,
            sum(v.existencia) FILTER (WHERE v.situacion = 'vencido'::text) AS vencido,
            sum(v.existencia) AS total,
            count(DISTINCT CASE WHEN farmacia.normalizar_codigo_lote(v.lote) = '' THEN 'id:' || v.lote_id::text ELSE 'codigo:' || farmacia.normalizar_codigo_lote(v.lote) END) AS lotes,
            count(DISTINCT CASE WHEN farmacia.normalizar_codigo_lote(v.lote) = '' THEN 'id:' || v.lote_id::text ELSE 'codigo:' || farmacia.normalizar_codigo_lote(v.lote) END) FILTER (WHERE v.existencia > 0::numeric) AS lotes_con_existencia,
            min(v.vence) FILTER (WHERE v.situacion <> 'vencido'::text AND v.vence IS NOT NULL) AS vence_primero
           FROM farmacia.v_existencia_lote v
          WHERE v.estado = 'disponible'::text
          GROUP BY v.producto_id) e ON e.producto_id = p.id
  WHERE p.activo;
DO $$ BEGIN
 IF (SELECT lotes FROM snapshot_lotes_unificados) IS DISTINCT FROM
 md5((SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb)::text FROM farmacia.lotes l))
 OR (SELECT movimientos FROM snapshot_lotes_unificados) IS DISTINCT FROM
 md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text FROM farmacia.movimientos m))
 OR (SELECT catalogo FROM snapshot_lotes_unificados) IS DISTINCT FROM
 (SELECT jsonb_agg(to_jsonb(c)-'lotes'-'lotes_con_existencia' ORDER BY producto_id) FROM farmacia.v_catalogo c)
 THEN RAISE EXCEPTION 'La agrupacion altero datos originales'; END IF;
END $$;
COMMIT;

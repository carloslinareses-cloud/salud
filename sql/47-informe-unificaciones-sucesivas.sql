-- Conservo en el informe las unificaciones anteriores aunque su lote se haya fusionado otra vez.
BEGIN;
CREATE OR REPLACE VIEW farmacia.v_lotes_unificados WITH (security_barrier=true) AS
WITH RECURSIVE grupos AS (
 SELECT a.clave,g.ordinality numero,a.creado_en,g.valor,
 (g.valor->>'lote_id')::uuid lote_id
 FROM farmacia.unificaciones_lotes a
 CROSS JOIN LATERAL jsonb_array_elements(a.resultado->'grupos') WITH ORDINALITY g(valor,ordinality)
), enlaces AS (
 SELECT DISTINCT (f->>'id')::uuid origen,g.lote_id destino
 FROM grupos g CROSS JOIN LATERAL jsonb_array_elements(g.valor->'fuentes') f
 WHERE (f->>'id')::uuid<>g.lote_id
), destino AS (
 SELECT clave,numero,creado_en,valor,lote_id,0 profundidad FROM grupos
 UNION ALL
 SELECT d.clave,d.numero,d.creado_en,d.valor,e.destino,d.profundidad+1
 FROM destino d JOIN enlaces e ON e.origen=d.lote_id WHERE d.profundidad<20
), resumen AS (
 SELECT d.lote_id,1+sum((d.valor->>'registros_anteriores')::integer-1) registros_anteriores,
 sum(coalesce((d.valor->>'retirado_sin_sumar')::numeric,0)) retirado_sin_sumar,
 max(d.creado_en) unificado_en
 FROM destino d JOIN farmacia.lotes l ON l.id=d.lote_id GROUP BY d.lote_id
)
SELECT l.id lote_id,l.producto_id,p.nombre producto,p.dosificacion,p.presentacion,l.codigo lote,
 l.vence,v.existencia,r.registros_anteriores::integer,r.retirado_sin_sumar,r.unificado_en
FROM resumen r JOIN farmacia.lotes l ON l.id=r.lote_id
JOIN farmacia.productos p ON p.id=l.producto_id
JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id
WHERE farmacia.mi_rol() IN ('admin','inventario');
REVOKE ALL ON farmacia.v_lotes_unificados FROM PUBLIC,anon;
GRANT SELECT ON farmacia.v_lotes_unificados TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

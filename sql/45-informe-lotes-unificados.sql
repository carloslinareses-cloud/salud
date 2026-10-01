-- Proyectar exclusivamente el resultado de inventario; el respaldo privado no se publica.
BEGIN;
CREATE OR REPLACE VIEW farmacia.v_lotes_unificados WITH (security_barrier=true) AS
SELECT l.id lote_id,l.producto_id,p.nombre producto,p.dosificacion,p.presentacion,l.codigo lote,
 l.vence,v.existencia,(g->>'registros_anteriores')::integer registros_anteriores,
 (g->>'retirado_sin_sumar')::numeric retirado_sin_sumar,a.creado_en unificado_en
FROM farmacia.unificaciones_lotes a
CROSS JOIN LATERAL jsonb_array_elements(a.resultado->'grupos') g
JOIN farmacia.lotes l ON l.id=(g->>'lote_id')::uuid
JOIN farmacia.productos p ON p.id=l.producto_id
JOIN farmacia.v_existencia_lote v ON v.lote_id=l.id
WHERE farmacia.mi_rol() IN ('admin','inventario');
REVOKE ALL ON farmacia.v_lotes_unificados FROM PUBLIC,anon;
GRANT SELECT ON farmacia.v_lotes_unificados TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

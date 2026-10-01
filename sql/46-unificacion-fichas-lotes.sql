-- Unifico fichas equivalentes del mismo medicamento o insumo, sin convertir cantidades.
BEGIN;
SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='60s';
LOCK TABLE farmacia.productos,farmacia.lotes,farmacia.movimientos,farmacia.entrega_detalle,farmacia.insumos_salidas,farmacia.tratamientos_paciente,farmacia.requerimientos_institucion,farmacia.insumos_entregas_cds_items IN SHARE ROW EXCLUSIVE MODE;
DO $$
#variable_conflict use_column
DECLARE clave_op text:='unificacion-fichas-lotes-20261002'; r record; g record; principal uuid; respaldo_op jsonb; informe jsonb:='[]'; fuentes jsonb; total numeric; huella text; n integer; eliminados integer:=0; saldo numeric;
BEGIN
IF EXISTS(SELECT 1 FROM farmacia.unificaciones_lotes WHERE clave=clave_op) THEN RETURN; END IF;
PERFORM set_config('request.jwt.claim.sub',(SELECT id::text FROM farmacia.perfiles WHERE activo AND rol='admin' AND lower(nombre) LIKE 'carlos%' LIMIT 1),true);
CREATE TEMP TABLE equivalencias(principal uuid,alias uuid,nombre text,nombre_alias text) ON COMMIT DROP;
INSERT INTO equivalencias VALUES ('c492b08f-3b6c-4b6f-be38-3faa03e096de'::uuid,'e2e50b74-3286-4478-930b-87c16ee6acaf'::uuid,'ERYTROMICINA 250 MG','ERYTROMYCIN 250 MG'),
('eadf92a3-1efb-4482-ab22-e2987b364f16'::uuid,'d37b71bf-c129-4f7b-8d33-962d271d41e2'::uuid,'JERINGA 20 ML','JERINGA 20ML'),
('22ca8898-57a0-4d63-a591-0a629f3c7bda'::uuid,'f145f358-897b-4c1e-ba50-a56cb9aca7c0'::uuid,'DICLOFENAC SODICO 75 MG / 3 ML','DICLOFENAC SODICO 75MG/3ML'),
('0395293a-67ae-44c1-b85f-473b6c99fa42'::uuid,'c311bad8-9adb-4ea8-9750-52a7de8d0e59'::uuid,'TAMSULOSINA CLORHIDRATO 0.4 MG','TANSULOSINA CLORHIDRATO 0.4MG'),
('d57ee456-2d25-401d-8227-64e2ea389f59'::uuid,'bea4554c-577b-49df-b5ed-7ef86aeaa029'::uuid,'JELCO 14','JELCO 14G'),
('43401c3d-89c9-450e-bc58-d2385197b4d1'::uuid,'f8d672da-b256-4d32-9f20-e127ff23afd7'::uuid,'JELCO 16','JELCO 16G'),
('21de61f3-0c56-4ae6-9b1e-3f275e07134c'::uuid,'453201ed-ca79-4d75-b7f0-f4d145773f3f'::uuid,'SOLUCION 0.45%','SOLUCON 0.45 %'),
('0fcb25f2-045f-4c87-9075-beedee5ab46d'::uuid,'7373a4a9-e9c5-41a4-a97d-3fc06c9e30b8'::uuid,'JELCO 22','JELCO 22G'),
('4951bd03-c796-4a3c-a822-847a5be0d31a'::uuid,'03de6eb7-2be9-4484-9a3a-016bb42810f0'::uuid,'CARBAMAZEPINA 200 MG','CARBAMAZEPINA 200MG'),
('a00ed2c3-314d-4c9f-a696-f010fc129cf2'::uuid,'ec9bf879-2e81-4fbb-a3be-696f02f05930'::uuid,'ENALAPRIL 20 MG','ENALAPRIL 20MG'),
('d7e8f3d1-8cfb-4e21-aa48-d84da435b0a2'::uuid,'e465aac9-15a0-48f9-8d1c-187d6ce8764f'::uuid,'ACIDO IBANDRONICO 150MG','ACIDO IBANDRONIDO 150 MG'),
('1ba8c810-0670-4adf-b9b3-a0079f311acb'::uuid,'3e86af2b-503c-4d23-b6e4-33d8bb55017a'::uuid,'JELCO 18','JELCO 18G'),
('73d26203-8911-44f3-9897-f165eff869e5'::uuid,'4b138a8d-eb52-4d2c-8d88-0c94c92bf3ed'::uuid,'JELCO 20','JELCO 20G'),
('c59eeeed-f927-4da5-9eac-f6b2548a53eb'::uuid,'590ac2e9-246f-4574-9baf-e0a89c6ce167'::uuid,'ACICLOVIR 400 MG','ACICLOVIR 400MG X 10'),
('45a311d9-69ba-4a48-b4a6-f8ce9f84109d'::uuid,'ba8ff02e-95e3-4066-96c6-fa039b29aeca'::uuid,'DOXICICLINA 100 MG','DOXICICLINA 100MG'),
('44d48f2a-424c-41b2-8f3c-03dd4fd44a9a'::uuid,'d76a3b57-babb-4bea-b45d-b38647566ed5'::uuid,'AMIODARONA 200 MG','AMIODARONA 200MG'),
('122b8c66-bf88-4696-9be7-a51b2742d553'::uuid,'ef0b6c92-8aa2-49fd-8bc7-f42e24cf2316'::uuid,'CLOPIDOGREL 75 MG','CLOPIDOGREL 75MG'),
('32a11060-773e-4406-a535-c4e78cb4d202'::uuid,'ed725e52-0362-4539-9671-d86ac276433a'::uuid,'DIGOXINA 0.25 MG','DIGOXINA 0.25MG X 10'),
('5501c4f2-6d19-44bb-b0b1-e7611501e5c1'::uuid,'efa8ccad-f85a-455e-899d-9b769364f4f1'::uuid,'CITICOLINA 500 MG','CITICOLINA 500MG X 10'),
('a6a956a9-f7f1-49d4-a168-56e8ce5c4fe3'::uuid,'7abede5f-1885-4635-86e1-5dc89210a2df'::uuid,'PARACETAMOL 500 MG','PARACETAMOL 500MG X 10'),
('ba1c1d49-fdfa-4e6e-8ebb-3688af0492d7'::uuid,'e48621a2-2c2f-47b3-87b4-c7da338f28b2'::uuid,'ALENDRONATO SODICO 70 MG','ALENDRONATO SODICO 70MG X 4'),
('ba1c1d49-fdfa-4e6e-8ebb-3688af0492d7'::uuid,'6d28c9ff-5ca8-4235-8daf-cce320cc0199'::uuid,'ALENDRONATO SODICO 70 MG','ALENDRONATO SODICO'),
('cba2ce23-ecd8-449c-8c20-dbfce5f995e4'::uuid,'00659eb6-8400-428f-b813-c1c20827242a'::uuid,'LEVOTIROXINA 50 MG','LOVOTIROXINA SODICA 50 MG'),
('cba2ce23-ecd8-449c-8c20-dbfce5f995e4'::uuid,'d028652b-b51c-43a0-97e5-eb2ba04b715d'::uuid,'LEVOTIROXINA 50 MG','LEVOTIRAXINA SODICA 50MG X 90'),
('4f37d18c-fd46-442a-a957-6cc0ee273219'::uuid,'57d21fe7-6705-418e-84b5-39ef6f31f77e'::uuid,'GICLAZIDA 80 MG','GLICLAZIDA 80MG X 10'),
('8344caed-691d-4a1b-8d46-3f6ff9a971b6'::uuid,'90f56362-b28e-4f1b-bbb1-b16929e3d4b6'::uuid,'ESTREPTOMICINA 1 GR','ESTREPTOMICINA 1000 MG'),
('e57e8318-0ee8-4c6b-99f5-73ffdc1ddb6b'::uuid,'63d52ab8-069f-4a54-a7fa-41efb290a7d9'::uuid,'METRONIDAZOL 500 MG','METRONIDAZOL 500MG'),
('dfb3e663-f5cd-4b54-a61f-7ccfc7a9e506'::uuid,'dc162607-aa45-441a-88b6-fce331281519'::uuid,'LOSARTAN POTASICO 50 MG','LOSARTAN POTASICO 50MG');
IF EXISTS(SELECT 1 FROM equivalencias e LEFT JOIN farmacia.productos p ON p.id=e.principal LEFT JOIN farmacia.productos q ON q.id=e.alias WHERE p.nombre IS DISTINCT FROM e.nombre OR q.nombre IS DISTINCT FROM e.nombre_alias OR (to_jsonb(p)-ARRAY['id','nombre','presentacion','creado_en','stock_minimo']) IS DISTINCT FROM (to_jsonb(q)-ARRAY['id','nombre','presentacion','creado_en','stock_minimo'])) THEN RAISE EXCEPTION 'Las fichas revisadas cambiaron o difieren en su unidad de inventario'; END IF;
CREATE TEMP TABLE ids_fusion ON COMMIT DROP AS SELECT l.id FROM farmacia.lotes l WHERE l.producto_id IN(SELECT principal FROM equivalencias UNION SELECT alias FROM equivalencias);
IF EXISTS(SELECT 1 FROM farmacia.lotes WHERE id IN(SELECT id FROM ids_fusion) AND estado<>'disponible') THEN RAISE EXCEPTION 'Un lote no esta disponible'; END IF;
SELECT jsonb_build_object('productos',(SELECT jsonb_agg(p) FROM farmacia.productos p WHERE id IN(SELECT principal FROM equivalencias UNION SELECT alias FROM equivalencias)),'lotes',(SELECT jsonb_agg(l) FROM farmacia.lotes l WHERE id IN(SELECT id FROM ids_fusion)),'movimientos',(SELECT jsonb_agg(m) FROM farmacia.movimientos m WHERE lote_id IN(SELECT id FROM ids_fusion)),'entrega_detalle',(SELECT jsonb_agg(d) FROM farmacia.entrega_detalle d WHERE lote_id IN(SELECT id FROM ids_fusion)),'insumos_salidas',(SELECT jsonb_agg(s) FROM farmacia.insumos_salidas s WHERE producto_id IN(SELECT alias FROM equivalencias)),'tratamientos',(SELECT jsonb_agg(t) FROM farmacia.tratamientos_paciente t WHERE producto_id IN(SELECT alias FROM equivalencias)),'requerimientos',(SELECT jsonb_agg(t) FROM farmacia.requerimientos_institucion t WHERE producto_id IN(SELECT alias FROM equivalencias)),'insumos_items',(SELECT jsonb_agg(t) FROM farmacia.insumos_entregas_cds_items t WHERE producto_id IN(SELECT alias FROM equivalencias))) INTO respaldo_op;
SELECT sum(cantidad),md5(string_agg((to_jsonb(m)-'lote_id')::text,'|' ORDER BY id)) INTO total,huella FROM farmacia.movimientos m;
ALTER TABLE farmacia.movimientos DISABLE TRIGGER tr_movimiento_inmutable;
FOR r IN SELECT * FROM equivalencias LOOP
 FOR g IN SELECT farmacia.normalizar_codigo_lote(l.codigo) codigo,array_agg(l.id) ids,min(l.vence) vence_min FROM farmacia.lotes l WHERE l.producto_id IN(r.principal,r.alias) AND farmacia.normalizar_codigo_lote(l.codigo)<>'' GROUP BY 1 HAVING count(*)>1 LOOP
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
SELECT resultado FROM farmacia.unificaciones_lotes WHERE clave='unificacion-fichas-lotes-20261002';
COMMIT;

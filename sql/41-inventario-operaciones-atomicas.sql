BEGIN;

CREATE OR REPLACE FUNCTION farmacia.inventario_baja(p_lote_id uuid, p_existencia_esperada numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lote farmacia.lotes%rowtype; v_saldo numeric;
BEGIN
  IF farmacia.mi_rol() IS NULL OR farmacia.mi_rol() NOT IN ('admin','inventario') THEN
    RAISE EXCEPTION 'Solo Administración e Inventario pueden dar de baja lotes.' USING errcode='42501';
  END IF;
  SELECT * INTO v_lote FROM farmacia.lotes WHERE id=p_lote_id FOR UPDATE;
  IF NOT FOUND OR v_lote.estado<>'disponible' THEN
    RAISE EXCEPTION 'El lote ya no está disponible.' USING errcode='22023';
  END IF;
  IF v_lote.vence IS NULL OR v_lote.vence>=current_date THEN
    RAISE EXCEPTION 'La baja por vencimiento requiere un lote vencido.' USING errcode='22023';
  END IF;
  SELECT coalesce(sum(cantidad),0) INTO v_saldo FROM farmacia.movimientos WHERE lote_id=p_lote_id;
  IF v_saldo<=0 OR p_existencia_esperada IS NULL OR v_saldo<>p_existencia_esperada THEN
    RAISE EXCEPTION 'La existencia cambió. Recarga las alertas antes de dar de baja.' USING errcode='40001';
  END IF;
  INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
    VALUES(p_lote_id,'baja',-v_saldo,'Baja por vencimiento','sistema');
  UPDATE farmacia.lotes SET estado='dado_de_baja' WHERE id=p_lote_id;
  RETURN v_saldo;
END $$;

CREATE OR REPLACE FUNCTION farmacia.inventario_guardar_conteo(p_cambios jsonb, p_motivo text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_fila record; v_producto record; v_saldo numeric; v_total integer;
BEGIN
  IF farmacia.mi_rol() IS NULL OR farmacia.mi_rol() NOT IN ('admin','inventario') THEN
    RAISE EXCEPTION 'Solo Administración e Inventario pueden corregir el inventario.' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_cambios) IS DISTINCT FROM 'object' OR length(btrim(coalesce(p_motivo,'')))<4 THEN
    RAISE EXCEPTION 'Indica las correcciones y un motivo de al menos 4 caracteres.' USING errcode='22023';
  END IF;
  SELECT count(*) INTO v_total FROM jsonb_each(p_cambios);
  IF v_total<1 OR v_total>500 THEN RAISE EXCEPTION 'Selecciona entre 1 y 500 correcciones.' USING errcode='22023'; END IF;
  PERFORM 1 FROM farmacia.lotes WHERE id IN (SELECT key::uuid FROM jsonb_each(p_cambios)) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM farmacia.lotes WHERE id IN (SELECT key::uuid FROM jsonb_each(p_cambios)) AND estado='disponible')<>v_total THEN
    RAISE EXCEPTION 'Una fila ya no está disponible. Recarga la hoja.' USING errcode='22023';
  END IF;
  -- Validar todo antes de modificar. El bloqueo conserva la misma existencia hasta terminar.
  FOR v_fila IN SELECT e.key::uuid id,e.value cambio,l.producto_id FROM jsonb_each(p_cambios) e JOIN farmacia.lotes l ON l.id=e.key::uuid LOOP
    IF v_fila.cambio ? 'productoId' AND (v_fila.cambio->>'productoId')::uuid<>v_fila.producto_id THEN
      RAISE EXCEPTION 'La fila no corresponde al medicamento indicado.' USING errcode='22023';
    END IF;
    IF v_fila.cambio ? 'real' THEN
      IF jsonb_typeof(v_fila.cambio->'real') IS DISTINCT FROM 'number' OR
         jsonb_typeof(v_fila.cambio->'sis') IS DISTINCT FROM 'number' OR (v_fila.cambio->>'real')::numeric<0 THEN
        RAISE EXCEPTION 'La existencia debe ser un número mayor o igual a cero.' USING errcode='22023';
      END IF;
      SELECT coalesce(sum(cantidad),0) INTO v_saldo FROM farmacia.movimientos WHERE lote_id=v_fila.id;
      IF v_saldo<>(v_fila.cambio->>'sis')::numeric THEN
        RAISE EXCEPTION 'El inventario cambió mientras contabas. Recarga la hoja antes de guardar.' USING errcode='40001';
      END IF;
    END IF;
  END LOOP;
  FOR v_producto IN
    SELECT l.producto_id,
      max(e.value->>'producto') FILTER (WHERE e.value ? 'producto') nombre,
      max(e.value->>'presentacion') FILTER (WHERE e.value ? 'presentacion') presentacion,
      count(*) FILTER (WHERE e.value ? 'producto') nombres,
      count(*) FILTER (WHERE e.value ? 'presentacion') presentaciones,
      count(DISTINCT e.value->>'producto') distintos_nombres,
      count(DISTINCT coalesce(e.value->>'presentacion','')) FILTER (WHERE e.value ? 'presentacion') distintas_presentaciones
    FROM jsonb_each(p_cambios) e JOIN farmacia.lotes l ON l.id=e.key::uuid GROUP BY l.producto_id ORDER BY l.producto_id
  LOOP
    IF v_producto.distintos_nombres>1 OR v_producto.distintas_presentaciones>1 THEN
      RAISE EXCEPTION 'Un medicamento no puede recibir dos nombres o presentaciones diferentes.' USING errcode='22023';
    END IF;
    IF v_producto.nombres>0 AND length(btrim(coalesce(v_producto.nombre,'')))<1 THEN
      RAISE EXCEPTION 'El nombre del medicamento es obligatorio.' USING errcode='22023';
    END IF;
    IF v_producto.nombres>0 OR v_producto.presentaciones>0 THEN
      UPDATE farmacia.productos SET
        nombre=CASE WHEN v_producto.nombres>0 THEN btrim(v_producto.nombre) ELSE nombre END,
        presentacion=CASE WHEN v_producto.presentaciones>0 THEN nullif(btrim(v_producto.presentacion),'') ELSE presentacion END
      WHERE id=v_producto.producto_id;
    END IF;
  END LOOP;
  FOR v_fila IN SELECT e.key::uuid id,e.value cambio FROM jsonb_each(p_cambios) e ORDER BY e.key LOOP
    IF v_fila.cambio ? 'lote' OR v_fila.cambio ? 'vence' THEN
      UPDATE farmacia.lotes SET
        codigo=CASE WHEN v_fila.cambio ? 'lote' THEN nullif(btrim(v_fila.cambio->>'lote'),'') ELSE codigo END,
        vence=CASE WHEN v_fila.cambio ? 'vence' THEN nullif(v_fila.cambio->>'vence','')::date ELSE vence END
      WHERE id=v_fila.id;
    END IF;
    IF v_fila.cambio ? 'real' AND (v_fila.cambio->>'real')::numeric<>(v_fila.cambio->>'sis')::numeric THEN
      INSERT INTO farmacia.movimientos(lote_id,tipo,cantidad,motivo,origen)
      VALUES(v_fila.id,'ajuste',(v_fila.cambio->>'real')::numeric-(v_fila.cambio->>'sis')::numeric,btrim(p_motivo),'sistema');
    END IF;
  END LOOP;
  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION farmacia.inventario_baja(uuid,numeric), farmacia.inventario_guardar_conteo(jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION farmacia.inventario_baja(uuid,numeric), farmacia.inventario_guardar_conteo(jsonb,text) TO authenticated;

COMMIT;

-- =====================================================================
-- Poder deshacer algo recién creado por equivocación.
--
-- Hasta ahora no se podía borrar NADA: no había ninguna política de
-- borrado, así que un medicamento creado de prueba se quedaba para
-- siempre en el catálogo estorbando.
--
-- La regla: se puede borrar SOLO lo que todavía no tiene historial.
-- En cuanto algo tiene un lote, un movimiento o una entrega, ya es parte
-- de lo que pasó de verdad y no se borra: se desactiva.
--
-- El candado está en la base, no en la pantalla, porque la pantalla se
-- puede saltar. Y el borrado queda anotado en la bitácora igual que
-- todo lo demás.
--
-- Se puede correr varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Primero el permiso de la tabla. Sin esto, Postgres rechaza el borrado
-- ANTES de mirar la política, con un "permission denied" seco: las
-- políticas RLS filtran QUÉ filas, pero el permiso decide si se puede
-- borrar del todo. Hacían falta las dos cosas.
-- ---------------------------------------------------------------------
grant delete on farmacia.productos     to authenticated;
grant delete on farmacia.lotes         to authenticated;
grant delete on farmacia.pacientes     to authenticated;
grant delete on farmacia.instituciones to authenticated;

-- ---------------------------------------------------------------------
-- Un medicamento se borra solo si no tiene ningún lote.
-- ---------------------------------------------------------------------
drop policy if exists productos_admin_borra on farmacia.productos;
create policy productos_admin_borra on farmacia.productos
  for delete to authenticated
  using (
    farmacia.es_admin()
    and not exists (select 1 from farmacia.lotes l where l.producto_id = productos.id)
    and not exists (select 1 from farmacia.tratamientos_paciente t where t.producto_id = productos.id)
  );

-- ---------------------------------------------------------------------
-- Un lote se borra solo si no tiene ningún movimiento: ni entrada, ni
-- salida, ni ajuste. Si tiene, la existencia se corrige o se da de baja.
-- ---------------------------------------------------------------------
drop policy if exists lotes_admin_borra on farmacia.lotes;
create policy lotes_admin_borra on farmacia.lotes
  for delete to authenticated
  using (
    farmacia.es_admin()
    and not exists (select 1 from farmacia.movimientos m where m.lote_id = lotes.id)
    and not exists (select 1 from farmacia.entrega_detalle d where d.lote_id = lotes.id)
  );

-- ---------------------------------------------------------------------
-- Una persona se borra solo si nunca retiró nada y no tiene tratamiento
-- cargado. Si ya retiró, se desactiva: su historial no se toca.
-- ---------------------------------------------------------------------
drop policy if exists pacientes_admin_borra on farmacia.pacientes;
create policy pacientes_admin_borra on farmacia.pacientes
  for delete to authenticated
  using (
    farmacia.es_admin()
    and not exists (select 1 from farmacia.entregas e where e.paciente_id = pacientes.id)
    and not exists (select 1 from farmacia.tratamientos_paciente t where t.paciente_id = pacientes.id)
  );

-- ---------------------------------------------------------------------
-- Un centro de salud se borra solo si nunca recibió nada.
-- ---------------------------------------------------------------------
drop policy if exists instituciones_admin_borra on farmacia.instituciones;
create policy instituciones_admin_borra on farmacia.instituciones
  for delete to authenticated
  using (
    farmacia.es_admin()
    and not exists (select 1 from farmacia.entregas e where e.institucion_id = instituciones.id)
  );

-- ---------------------------------------------------------------------
-- Lo que NO se puede borrar nunca, y así se queda:
--   · movimientos      — son el inventario mismo
--   · entregas         — son lo que se le dio a alguien
--   · entrega_detalle
--   · bitacora         — es la prueba de todo lo anterior
-- Ninguna tiene política de borrado, así que la base las rechaza.
-- ---------------------------------------------------------------------

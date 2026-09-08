-- =====================================================================
-- EL HISTORIAL DE ENTREGAS DE CADA PERSONA Y DE CADA CENTRO
--
-- No hace falta ninguna tabla ni vista nueva: `v_entregas_renglon` ya
-- trae todo lo que hay que enseñar —el día, la hora (`creado_en`), quién
-- despachó y qué se entregó, renglón por renglón—. La pantalla solo lo
-- lee y lo junta por entrega.
--
-- Lo único que faltaba era un índice. Buscar por persona ya tenía el
-- suyo (`ix_entregas_paciente`); buscar por centro no, así que cada vez
-- que se abría la ficha de un CDI la base recorría la tabla de entregas
-- entera. Con 5.000 filas no se nota, pero esta tabla solo crece.
--
-- Se puede correr varias veces.
-- =====================================================================

create index if not exists ix_entregas_institucion
  on farmacia.entregas (institucion_id, fecha desc)
  where institucion_id is not null;

comment on index farmacia.ix_entregas_institucion is
  'Para abrir el historial de un centro sin recorrer la tabla completa.';

-- =====================================================================
-- DASHBOARD EN TIEMPO REAL
--
-- El Dashboard vuelve a calcular las cantidades reales cuando cambia
-- cualquiera de sus fuentes. Supabase solo emite esos cambios si la tabla
-- pertenece a la publicación `supabase_realtime`.
--
-- Es idempotente: se puede ejecutar todas las veces que haga falta.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'pacientes',
    'jornadas_registros',
    'jornadas_eventos',
    'instituciones',
    'entregas',
    'entrega_detalle',
    'solicitudes',
    'tratamientos_paciente',
    'productos',
    'insumos_entregas_cds',
    'insumos_entregas_cds_items',
    'insumos_control_entregas',
    'insumos_control_entregas_items'
  ]
  loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'farmacia'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table farmacia.%I', t);
    end if;
  end loop;
end $$;

select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'farmacia'
 order by tablename;

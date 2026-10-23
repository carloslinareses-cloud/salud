-- El menú puede acotarse por cuenta sin alterar los demás perfiles.
-- NULL conserva el menú completo; una lista contiene las opciones visibles.
-- La autorización de las operaciones continúa a cargo del rol y las RPC.
alter table farmacia.perfiles
  add column if not exists opciones_inventario text[] default null;

alter table farmacia.perfiles
  drop constraint if exists perfiles_opciones_inventario_validas;
alter table farmacia.perfiles
  add constraint perfiles_opciones_inventario_validas check (
    opciones_inventario is null or (
      array_position(opciones_inventario, null) is null and
      opciones_inventario <@ array['recipe','cargar','catalogo','consulta',
        'personas','jornadas','centros','insumos','entregas','alertas','conteo','dashboard']::text[]
    )
  );

comment on column farmacia.perfiles.opciones_inventario is
  'Opciones visibles del menú de Inventario por cuenta. NULL conserva todas. No sustituye permisos de operaciones.';

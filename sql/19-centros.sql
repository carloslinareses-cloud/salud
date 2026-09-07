-- =====================================================================
-- LO QUE NECESITA CADA CENTRO DE SALUD
--
-- A los CDI, ambulatorios y consultorios no se les despacha de uno en
-- uno como a una persona: se les manda un pedido de veinte renglones,
-- casi siempre los mismos y casi siempre en las mismas cantidades. Hoy
-- eso está en la cabeza de quien despacha y en un papel.
--
-- Con esta tabla el centro lleva su propia lista: qué insumos necesita y
-- cuánto de cada uno. Al ir a entregarle salen todos con su cantidad ya
-- puesta y se arma el pedido de un toque, igual que el tratamiento de un
-- paciente.
--
-- La cantidad es SUGERIDA, no obligatoria: es lo que suele necesitar, no
-- lo que se le va a dar. Lo que de verdad sale sigue saliendo del
-- renglón de la entrega, que es el único que descuenta del inventario.
--
-- Se puede correr varias veces.
-- =====================================================================

create table if not exists farmacia.requerimientos_institucion (
  id             uuid primary key default gen_random_uuid(),
  institucion_id uuid not null references farmacia.instituciones(id) on delete cascade,
  producto_id    uuid references farmacia.productos(id) on delete set null,
  texto_original text,
  cantidad       numeric(12,2),
  nota           text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

-- O está enlazado al catálogo, o está escrito a mano. Nunca ninguno de
-- los dos: un renglón sin nada no dice qué hace falta.
alter table farmacia.requerimientos_institucion drop constraint if exists req_dice_que_hace_falta;
alter table farmacia.requerimientos_institucion add  constraint req_dice_que_hace_falta
  check (producto_id is not null or length(trim(coalesce(texto_original, ''))) >= 3);

alter table farmacia.requerimientos_institucion drop constraint if exists req_cantidad_positiva;
alter table farmacia.requerimientos_institucion add  constraint req_cantidad_positiva
  check (cantidad is null or cantidad > 0);

create index if not exists ix_requerimientos_institucion
  on farmacia.requerimientos_institucion (institucion_id);

-- El mismo centro no pide dos veces el mismo producto.
create unique index if not exists ux_requerimiento_producto
  on farmacia.requerimientos_institucion (institucion_id, producto_id)
  where activo and producto_id is not null;

create unique index if not exists ux_requerimiento_texto
  on farmacia.requerimientos_institucion
     (institucion_id, farmacia.sin_acentos(upper(texto_original)))
  where activo and producto_id is null;

comment on column farmacia.requerimientos_institucion.cantidad is
  'Lo que SUELE necesitar, para proponerlo al armar la entrega. No descuenta nada.';

-- ---------------------------------------------------------------------
-- Bitácora y permisos: los mismos que el catálogo. Lo mantiene quien
-- lleva el inventario; lo consulta también quien despacha, porque es de
-- donde saca el pedido.
-- ---------------------------------------------------------------------
drop trigger if exists tr_bitacora_requerimientos_institucion on farmacia.requerimientos_institucion;
create trigger tr_bitacora_requerimientos_institucion
  after insert or update or delete on farmacia.requerimientos_institucion
  for each row execute function farmacia.fn_bitacora();

alter table farmacia.requerimientos_institucion enable row level security;
grant select, insert, update on farmacia.requerimientos_institucion to authenticated;

drop policy if exists requerimientos_ver on farmacia.requerimientos_institucion;
create policy requerimientos_ver on farmacia.requerimientos_institucion
  for select to authenticated using (farmacia.mi_rol() is not null);

drop policy if exists requerimientos_crea on farmacia.requerimientos_institucion;
create policy requerimientos_crea on farmacia.requerimientos_institucion
  for insert to authenticated with check (farmacia.mi_rol() is not null);

drop policy if exists requerimientos_edita on farmacia.requerimientos_institucion;
create policy requerimientos_edita on farmacia.requerimientos_institucion
  for update to authenticated
  using (farmacia.mi_rol() is not null) with check (farmacia.mi_rol() is not null);

-- ---------------------------------------------------------------------
-- La lista de cada centro, con lo que hay en existencia al lado: así se
-- ve de una vez qué se le puede mandar hoy y qué no.
-- ---------------------------------------------------------------------
drop view if exists farmacia.v_requerimientos_institucion cascade;

create view farmacia.v_requerimientos_institucion as
select
  r.id            as requerimiento_id,
  r.institucion_id,
  r.producto_id,
  r.texto_original,
  r.cantidad,
  r.nota,
  c.producto,
  c.dosificacion,
  c.presentacion,
  c.categoria,
  c.unidad,
  c.empaque,
  c.unidades_por_empaque,
  c.disponible,
  c.vence_primero,
  c.situacion,
  -- Si lo que necesita es más de lo que hay, hay que saberlo ANTES de
  -- salir a repartir, no en el mostrador.
  case
    when r.producto_id is null                    then 'sin_enlazar'
    when coalesce(c.disponible, 0) <= 0           then 'sin_existencia'
    when r.cantidad is null                       then 'hay'
    when coalesce(c.disponible, 0) >= r.cantidad  then 'alcanza'
    else 'no_alcanza'
  end as cobertura
from farmacia.requerimientos_institucion r
left join farmacia.v_catalogo c on c.producto_id = r.producto_id
where r.activo;

grant select on farmacia.v_requerimientos_institucion to authenticated, service_role;
alter view farmacia.v_requerimientos_institucion set (security_invoker = true);

-- ---------------------------------------------------------------------
-- La ficha del centro, ahora con lo que pide y con lo que ya recibió.
-- Se añaden columnas al final: `create or replace view` no deja meter
-- una en medio.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_instituciones_ficha as
select
  i.id,
  i.nombre,
  i.tipo,
  i.direccion,
  i.responsable,
  i.telefono,
  i.activo,
  coalesce(e.entregas, 0) as entregas,
  e.ultima_entrega,
  farmacia.sin_acentos(upper(i.nombre)) as busqueda,

  coalesce(r.insumos, 0)    as insumos,       -- cuántos renglones pide
  coalesce(d.unidades, 0)   as unidades_recibidas
from farmacia.instituciones i
left join (
  select institucion_id, count(*) as entregas, max(fecha) as ultima_entrega
    from farmacia.entregas
   where institucion_id is not null and not coalesce(anulada, false)
   group by institucion_id
) e on e.institucion_id = i.id
left join (
  select institucion_id, count(*) as insumos
    from farmacia.requerimientos_institucion where activo group by institucion_id
) r on r.institucion_id = i.id
left join (
  select en.institucion_id, sum(de.cantidad) as unidades
    from farmacia.entregas en
    join farmacia.entrega_detalle de on de.entrega_id = en.id
   where en.institucion_id is not null and not coalesce(en.anulada, false)
   group by en.institucion_id
) d on d.institucion_id = i.id;

grant select on farmacia.v_instituciones_ficha to authenticated, service_role;
alter view farmacia.v_instituciones_ficha set (security_invoker = true);

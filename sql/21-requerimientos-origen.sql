-- =====================================================================
-- DE DÓNDE SALIÓ CADA RENGLÓN DE LA LISTA DE UN CENTRO
--
-- Igual que con el tratamiento de las personas: antes de traer en bloque
-- lo que dice el cuaderno hay que poder distinguirlo de lo que escribió
-- alguien aquí, y poder deshacerlo entero:
--
--     delete from farmacia.requerimientos_institucion where origen = 'cuaderno';
--
-- Se puede correr varias veces.
-- =====================================================================

alter table farmacia.requerimientos_institucion
  add column if not exists origen text not null default 'sistema';

alter table farmacia.requerimientos_institucion
  drop constraint if exists requerimiento_origen_valido;
alter table farmacia.requerimientos_institucion
  add  constraint requerimiento_origen_valido
  check (origen in ('sistema', 'cuaderno'));

comment on column farmacia.requerimientos_institucion.origen is
  'sistema = lo escribió alguien en la aplicación;
   cuaderno = se dedujo de lo que ya se le ha entregado, según el Excel de insumos.';

create index if not exists ix_requerimientos_origen
  on farmacia.requerimientos_institucion (origen);

-- La lista del centro necesita decir de dónde viene cada renglón.
drop view if exists farmacia.v_requerimientos_institucion cascade;

create view farmacia.v_requerimientos_institucion as
select
  r.id            as requerimiento_id,
  r.institucion_id,
  r.producto_id,
  r.texto_original,
  r.cantidad,
  r.nota,
  r.origen,
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

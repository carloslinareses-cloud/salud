-- =====================================================================
-- CAJAS Y UNIDADES
--
-- La farmacia recibe CAJAS, pero entrega UNIDADES. Hasta ahora el sistema
-- solo sabía de unidades sueltas: si llegaban 4 cajas de 30 tabletas,
-- quedaba anotado "120" y no había forma de saber cuántas cajas eran.
-- Al ir al anaquel a contar, no cuadraba con lo que se veía.
--
-- Se agregan dos datos al medicamento:
--
--   empaque              cómo viene: caja, frasco, blíster, sobre…
--   unidades_por_empaque cuántas unidades trae ese empaque (30)
--
-- Con eso, 120 unidades se pueden decir también como "4 cajas de 30".
-- La existencia se sigue guardando en UNIDADES, que es lo que se entrega:
-- las cajas son una forma de leer el mismo número, no otro número.
--
-- Se puede correr varias veces.
-- =====================================================================

alter table farmacia.productos
  add column if not exists empaque text,
  add column if not exists unidades_por_empaque integer;

-- Una caja de cero o de una unidad no es una caja: es la unidad suelta.
alter table farmacia.productos
  drop constraint if exists productos_empaque_valido;
alter table farmacia.productos
  add constraint productos_empaque_valido check (
    unidades_por_empaque is null or unidades_por_empaque > 1
  );

comment on column farmacia.productos.empaque is
  'Cómo viene empacado: caja, frasco, blíster. Nulo si se cuenta suelto.';
comment on column farmacia.productos.unidades_por_empaque is
  'Cuántas unidades trae un empaque. Nulo o 1 = se cuenta suelto.';

-- ---------------------------------------------------------------------
-- Cómo se dice una cantidad en cajas y sueltas.
--   contar(125, 30) -> '4 cajas y 5 sueltas'
--   contar(120, 30) -> '4 cajas'
--   contar(25,  30) -> '25 sueltas'
-- ---------------------------------------------------------------------
create or replace function farmacia.en_cajas(
  unidades numeric, por_empaque integer, empaque text
) returns text
language sql immutable as $$
  select case
    when unidades is null or por_empaque is null or por_empaque <= 1 then null
    when unidades <= 0 then null
    else
      nullif(trim(
        case when floor(unidades / por_empaque) > 0
             then floor(unidades / por_empaque)::text || ' ' ||
                  coalesce(empaque, 'caja') ||
                  case when floor(unidades / por_empaque) = 1 then '' else 's' end
             else '' end
        || case when (unidades::int % por_empaque) > 0
                then case when floor(unidades / por_empaque) > 0 then ' y ' else '' end ||
                     (unidades::int % por_empaque)::text || ' suelta' ||
                     case when (unidades::int % por_empaque) = 1 then '' else 's' end
                else '' end
      ), '')
  end
$$;

-- ---------------------------------------------------------------------
-- Rehacer las vistas.
--
-- `create or replace view` no deja insertar una columna en medio, y aquí
-- hacen falta dos nuevas. Así que se tumban y se vuelven a crear TODAS
-- las que dependían de la de lotes, en orden. Ninguna se pierde: quedan
-- listadas abajo una por una.
-- ---------------------------------------------------------------------
drop view if exists farmacia.v_tratamiento_paciente  cascade;
drop view if exists farmacia.v_alertas               cascade;
drop view if exists farmacia.v_lotes_para_despachar  cascade;
drop view if exists farmacia.v_existencia_producto   cascade;
drop view if exists farmacia.v_catalogo              cascade;
drop view if exists farmacia.v_existencia_lote       cascade;

-- ---------------------------------------------------------------------
-- 1. Cada lote, con su equivalencia en cajas.
-- ---------------------------------------------------------------------
create view farmacia.v_existencia_lote as
select
  l.id            as lote_id,
  l.producto_id,
  p.nombre        as producto,
  p.dosificacion,
  p.presentacion,
  p.categoria,
  p.unidad,
  p.empaque,
  p.unidades_por_empaque,
  l.codigo        as lote,
  l.vence,
  l.estado,
  coalesce(sum(m.cantidad), 0::numeric) as existencia,
  farmacia.en_cajas(coalesce(sum(m.cantidad), 0::numeric),
                    p.unidades_por_empaque, p.empaque) as en_cajas,
  case
    when l.estado = 'dado_de_baja' then 'dado_de_baja'
    when l.vence is null           then 'sin_fecha'
    when l.vence < current_date    then 'vencido'
    when l.vence <= current_date + 30 then 'por_vencer_30'
    when l.vence <= current_date + 90 then 'por_vencer_90'
    else 'vigente'
  end as situacion
from farmacia.lotes l
join farmacia.productos p on p.id = l.producto_id
left join farmacia.movimientos m on m.lote_id = l.id
group by l.id, l.producto_id, p.nombre, p.dosificacion, p.presentacion, p.categoria,
         p.unidad, p.empaque, p.unidades_por_empaque, l.codigo, l.vence, l.estado;

-- ---------------------------------------------------------------------
-- 2. El catálogo, ahora con el empaque.
-- ---------------------------------------------------------------------
create view farmacia.v_catalogo as
select
  p.id                     as producto_id,
  p.nombre                 as producto,
  p.dosificacion,
  p.presentacion,
  p.categoria,
  p.unidad,
  p.stock_minimo,
  p.empaque,
  p.unidades_por_empaque,

  coalesce(e.disponible, 0)           as disponible,
  coalesce(e.vencido, 0)              as vencido,
  coalesce(e.total, 0)                as total,
  coalesce(e.lotes, 0)                as lotes,
  coalesce(e.lotes_con_existencia, 0) as lotes_con_existencia,
  e.vence_primero,

  -- Lo mismo, dicho en cajas. Nulo si el medicamento se cuenta suelto.
  farmacia.en_cajas(coalesce(e.disponible, 0), p.unidades_por_empaque, p.empaque) as en_cajas,

  case
    when coalesce(e.disponible, 0) <= 0 and coalesce(e.vencido, 0) > 0 then 'solo_vencido'
    when coalesce(e.disponible, 0) <= 0                                then 'sin_existencia'
    when e.vence_primero is not null and e.vence_primero <= current_date + 30 then 'por_vencer_30'
    when e.vence_primero is not null and e.vence_primero <= current_date + 90 then 'por_vencer_90'
    when p.stock_minimo is not null and p.stock_minimo > 0
         and coalesce(e.disponible, 0) < p.stock_minimo then 'bajo_minimo'
    else 'bien'
  end as situacion,

  farmacia.sin_acentos(upper(p.nombre)) as busqueda

from farmacia.productos p
left join (
  select
    v.producto_id,
    sum(v.existencia) filter (
      where v.situacion in ('vigente', 'por_vencer_30', 'por_vencer_90', 'sin_fecha')) as disponible,
    sum(v.existencia) filter (where v.situacion = 'vencido')                            as vencido,
    sum(v.existencia)                                                                   as total,
    count(*)                                                                            as lotes,
    count(*) filter (where v.existencia > 0)                                            as lotes_con_existencia,
    min(v.vence) filter (where v.situacion <> 'vencido' and v.vence is not null)        as vence_primero
  from farmacia.v_existencia_lote v
  where v.estado = 'disponible'
  group by v.producto_id
) e on e.producto_id = p.id
where p.activo;

-- ---------------------------------------------------------------------
-- 3. Las que dependían de la de lotes, tal como estaban, más el empaque.
-- ---------------------------------------------------------------------
create view farmacia.v_alertas as
select 'vencido'::text as tipo, lote_id, producto, dosificacion, lote, vence, existencia,
       empaque, unidades_por_empaque, en_cajas
  from farmacia.v_existencia_lote
 where situacion = 'vencido' and existencia > 0 and estado = 'disponible'
union all
select 'por_vencer_30'::text, lote_id, producto, dosificacion, lote, vence, existencia,
       empaque, unidades_por_empaque, en_cajas
  from farmacia.v_existencia_lote
 where situacion = 'por_vencer_30' and existencia > 0 and estado = 'disponible'
union all
select 'por_vencer_90'::text, lote_id, producto, dosificacion, lote, vence, existencia,
       empaque, unidades_por_empaque, en_cajas
  from farmacia.v_existencia_lote
 where situacion = 'por_vencer_90' and existencia > 0 and estado = 'disponible';

create view farmacia.v_lotes_para_despachar as
select lote_id, producto_id, producto, dosificacion, presentacion, categoria,
       unidad, empaque, unidades_por_empaque, lote, vence, estado, existencia,
       en_cajas, situacion
  from farmacia.v_existencia_lote
 where estado = 'disponible' and existencia > 0 and situacion <> 'vencido'
 order by (vence is null), vence;

create view farmacia.v_existencia_producto as
select producto_id, producto, dosificacion, presentacion, categoria,
       sum(existencia) filter (where situacion in ('vigente','por_vencer_30','por_vencer_90','sin_fecha')) as disponible,
       sum(existencia) filter (where situacion = 'vencido') as vencido,
       sum(existencia) as total,
       min(vence) filter (where situacion <> 'vencido' and vence is not null) as vence_primero
  from farmacia.v_existencia_lote
 where estado = 'disponible'
 group by producto_id, producto, dosificacion, presentacion, categoria;

-- ---------------------------------------------------------------------
-- 4. El tratamiento del paciente. Se vuelve a crear porque dependía del
--    catálogo, que se tumbó arriba. Es la misma de sql/13-fichas.sql.
-- ---------------------------------------------------------------------
create view farmacia.v_tratamiento_paciente as
select t.id as tratamiento_id, t.paciente_id, t.producto_id, t.texto_original,
       c.producto, c.dosificacion, c.presentacion, c.categoria,
       c.disponible, c.vence_primero, c.situacion
  from farmacia.tratamientos_paciente t
  join farmacia.v_catalogo c on c.producto_id = t.producto_id
 where t.activo
union all
select distinct e.tratamiento_id, e.paciente_id, c.producto_id, e.texto_original,
       c.producto, c.dosificacion, c.presentacion, c.categoria,
       c.disponible, c.vence_primero, c.situacion
from (
  select b.id as tratamiento_id, b.paciente_id, b.texto_original,
         trim(regexp_replace(x.pieza, '\s+', ' ', 'g')) as pieza
    from (select t.id, t.paciente_id, t.texto_original
            from farmacia.tratamientos_paciente t
           where t.activo and t.producto_id is null and t.texto_original is not null) b
    cross join lateral (
      select b.texto_original as pieza
      union all
      select p from regexp_split_to_table(b.texto_original, '/') p
    ) x
) e
join farmacia.v_catalogo c
  on farmacia.sin_acentos(upper(c.producto)) = farmacia.sin_acentos(upper(e.pieza))
where length(e.pieza) >= 3
union all
select t.id, t.paciente_id, null::uuid, t.texto_original,
       null, null, null, null, null, null::date, null
from farmacia.tratamientos_paciente t
where t.activo and t.producto_id is null and t.texto_original is not null
  and not exists (
    select 1
      from lateral (
        select t.texto_original as pieza
        union all
        select p from regexp_split_to_table(t.texto_original, '/') p
      ) y
      join farmacia.v_catalogo c2
        on farmacia.sin_acentos(upper(c2.producto))
         = farmacia.sin_acentos(upper(trim(regexp_replace(y.pieza, '\s+', ' ', 'g'))))
     where length(trim(y.pieza)) >= 3
  );

-- ---------------------------------------------------------------------
-- 5. Permisos de todas.
-- ---------------------------------------------------------------------
grant select on farmacia.v_existencia_lote       to authenticated, service_role;
grant select on farmacia.v_catalogo              to authenticated, service_role;
grant select on farmacia.v_alertas               to authenticated, service_role;
grant select on farmacia.v_lotes_para_despachar  to authenticated, service_role;
grant select on farmacia.v_existencia_producto   to authenticated, service_role;
grant select on farmacia.v_tratamiento_paciente  to authenticated, service_role;

alter view farmacia.v_existencia_lote      set (security_invoker = true);
alter view farmacia.v_catalogo             set (security_invoker = true);
alter view farmacia.v_alertas              set (security_invoker = true);
alter view farmacia.v_lotes_para_despachar set (security_invoker = true);
alter view farmacia.v_existencia_producto  set (security_invoker = true);
alter view farmacia.v_tratamiento_paciente set (security_invoker = true);

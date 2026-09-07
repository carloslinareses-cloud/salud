-- =====================================================================
-- Vistas para que las pantallas informen de verdad.
--
-- Antes, al buscar un medicamento para registrar mercancía o para
-- entregar, la lista solo decía el nombre. No decía cuánto había, ni
-- cuántos lotes, ni si algo estaba por vencerse. Había que elegir a
-- ciegas y descubrirlo en la pantalla siguiente.
--
-- Se puede correr varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EL CATÁLOGO COMPLETO
--
-- Parte de `productos`, no de los lotes. Eso importa: un medicamento que
-- todavía no tiene ningún lote NO aparecía en v_existencia_producto, y
-- es justo el que hay que poder encontrar para cargarle la primera
-- entrada. (Hoy hay 8 presentaciones de LOSARTAN en esa situación.)
-- ---------------------------------------------------------------------
create or replace view farmacia.v_catalogo as
select
  p.id                     as producto_id,
  p.nombre                 as producto,
  p.dosificacion,
  p.presentacion,
  p.categoria,
  p.unidad,
  p.stock_minimo,

  coalesce(e.disponible, 0)          as disponible,
  coalesce(e.vencido, 0)             as vencido,
  coalesce(e.total, 0)               as total,
  coalesce(e.lotes, 0)               as lotes,
  coalesce(e.lotes_con_existencia, 0) as lotes_con_existencia,
  e.vence_primero,

  -- Cómo está este medicamento, en una sola palabra, para poder pintarlo
  -- con su color sin hacer cuentas en la pantalla.
  case
    when coalesce(e.disponible, 0) <= 0 and coalesce(e.vencido, 0) > 0 then 'solo_vencido'
    when coalesce(e.disponible, 0) <= 0                                then 'sin_existencia'
    when e.vence_primero is not null and e.vence_primero <= current_date + 30 then 'por_vencer_30'
    when e.vence_primero is not null and e.vence_primero <= current_date + 90 then 'por_vencer_90'
    when p.stock_minimo is not null and coalesce(e.disponible, 0) < p.stock_minimo then 'bajo_minimo'
    else 'bien'
  end as situacion,

  -- Para buscar sin que estorben los acentos ni las mayúsculas.
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
-- 2. EL TRATAMIENTO DE CADA PACIENTE, CON SU EXISTENCIA
--
-- El Excel traía qué medicamentos toma cada persona, pero en una sola
-- celda y con varios medicamentos juntos separados por "/":
--
--   "NIFEDIPINO 20mg / HIDROCLOROTIAZIDA 12.5mg / ASAPROL 81mg"
--
-- Al migrar no se pudieron separar, porque la barra también va DENTRO de
-- algunos nombres ("DESLORATADINA 0,5MG/ML", "CLARITROMICINA 250mg / 5ml").
-- Partir a ciegas habría inventado medicamentos que no existen.
--
-- Ahora sí se puede, porque hay con qué comprobar: el catálogo de 441
-- medicamentos. Se prueba el texto entero Y cada trozo, y se acepta
-- ÚNICAMENTE lo que coincida EXACTAMENTE con un medicamento del catálogo
-- (sin distinguir acentos, mayúsculas ni espacios de más). Lo que no
-- coincide no se enlaza: se sigue mostrando como vino del Excel.
--
-- Nada se cambia en la base: esto es solo una forma de leer lo que ya hay.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_tratamiento_paciente as

-- a) los que ya venían enlazados a un medicamento
select
  t.id            as tratamiento_id,
  t.paciente_id,
  t.producto_id,
  t.texto_original,
  c.producto, c.dosificacion, c.presentacion, c.categoria,
  c.disponible, c.vence_primero, c.situacion
from farmacia.tratamientos_paciente t
join farmacia.v_catalogo c on c.producto_id = t.producto_id
where t.activo

union all

-- b) los que no: se parte el texto y se reconoce lo que existe de verdad
select distinct
  e.tratamiento_id,
  e.paciente_id,
  c.producto_id,
  e.texto_original,
  c.producto, c.dosificacion, c.presentacion, c.categoria,
  c.disponible, c.vence_primero, c.situacion
from (
  select b.id as tratamiento_id, b.paciente_id, b.texto_original,
         trim(regexp_replace(x.pieza, '\s+', ' ', 'g')) as pieza
    from (select t.id, t.paciente_id, t.texto_original
            from farmacia.tratamientos_paciente t
           where t.activo and t.producto_id is null and t.texto_original is not null) b
    cross join lateral (
      select b.texto_original as pieza                              -- el texto entero
      union all
      select p from regexp_split_to_table(b.texto_original, '/') p  -- y cada trozo
    ) x
) e
join farmacia.v_catalogo c
  on farmacia.sin_acentos(upper(c.producto)) = farmacia.sin_acentos(upper(e.pieza))
where length(e.pieza) >= 3

union all

-- c) los que no se pudieron reconocer: se muestran como vinieron
select
  t.id, t.paciente_id, null::uuid, t.texto_original,
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
-- 3. Permisos: las vistas heredan las políticas de las tablas que leen,
--    pero hay que dejar consultarlas.
-- ---------------------------------------------------------------------
grant select on farmacia.v_catalogo             to authenticated, service_role;
grant select on farmacia.v_tratamiento_paciente to authenticated, service_role;

-- Las vistas corren con los permisos de quien consulta, no de quien las
-- creó: así siguen valiendo las políticas RLS de las tablas de abajo.
alter view farmacia.v_catalogo             set (security_invoker = true);
alter view farmacia.v_tratamiento_paciente set (security_invoker = true);

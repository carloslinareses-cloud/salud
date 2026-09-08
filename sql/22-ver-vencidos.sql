-- =====================================================================
-- QUE LOS VENCIDOS SE VEAN
--
-- Hasta ahora, al buscar un medicamento para entregar, los lotes vencidos
-- sencillamente NO aparecian. La idea era buena —no se pueden entregar—
-- pero el efecto era el contrario del que se quiere: quien atiende busca
-- y no encuentra nada, y no sabe si es que no hay, si nunca se cargo, o
-- si hay dos cajas en el estante que estan vencidas y hay que sacarlas.
--
-- Esta vista los muestra TODOS, con lo vencido de ultimo y marcado. La
-- pantalla los pinta apagados y con su etiqueta: se ven, se sabe que
-- estan ahi, y no se pueden tocar.
--
-- OJO: `v_lotes_para_despachar` NO se toca. De ella salen los lotes que
-- el sistema propone solo (el que vence primero, FEFO), y ahi un vencido
-- seria un error grave. Esta es para MIRAR; aquella para ELEGIR.
--
-- Se puede correr varias veces.
-- =====================================================================

create or replace view farmacia.v_lotes_para_ver as
select
  lote_id, producto_id, producto, dosificacion, presentacion, categoria,
  unidad, empaque, unidades_por_empaque, lote, vence, estado,
  existencia, en_cajas, situacion,
  -- Para ordenar: lo que se puede entregar primero, lo vencido al final.
  -- PostgREST no sabe ordenar por una expresion, asi que viene resuelta.
  case when situacion = 'vencido' then 1 else 0 end as es_vencido
from farmacia.v_existencia_lote
where estado = 'disponible' and existencia > 0;

comment on view farmacia.v_lotes_para_ver is
  'Todos los lotes con existencia, INCLUIDOS los vencidos, para mostrarlos marcados.
   Para elegir un lote al despachar se usa v_lotes_para_despachar, que los excluye.';

grant select on farmacia.v_lotes_para_ver to authenticated, service_role;
alter view farmacia.v_lotes_para_ver set (security_invoker = true);

-- ---------------------------------------------------------------------
-- La lista de un centro tambien tiene que distinguirlo: no es lo mismo
-- "no hay" que "hay, pero esta vencido y hay que darlo de baja".
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
  r.origen,
  c.producto,
  c.dosificacion,
  c.presentacion,
  c.categoria,
  c.unidad,
  c.empaque,
  c.unidades_por_empaque,
  c.disponible,
  c.vencido,
  c.vence_primero,
  c.situacion,
  case
    when r.producto_id is null                        then 'sin_enlazar'
    when coalesce(c.disponible, 0) <= 0
     and coalesce(c.vencido, 0) > 0                   then 'solo_vencido'
    when coalesce(c.disponible, 0) <= 0               then 'sin_existencia'
    when r.cantidad is null                           then 'hay'
    when coalesce(c.disponible, 0) >= r.cantidad      then 'alcanza'
    else 'no_alcanza'
  end as cobertura
from farmacia.requerimientos_institucion r
left join farmacia.v_catalogo c on c.producto_id = r.producto_id
where r.activo;

grant select on farmacia.v_requerimientos_institucion to authenticated, service_role;
alter view farmacia.v_requerimientos_institucion set (security_invoker = true);

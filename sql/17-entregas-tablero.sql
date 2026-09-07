-- =====================================================================
-- EL TABLERO DE ENTREGAS
--
-- Para contar y sacar en Excel y en PDF todo lo que salió de la farmacia
-- en un día, una semana, un mes o entre dos fechas cualesquiera.
--
-- Hay que entender una cosa antes de leer la vista, porque explica su
-- forma: en la farmacia conviven DOS clases de entrega.
--
--   · Las que se registran en el sistema. Tienen renglones: qué
--     medicamento, de qué lote y CUÁNTAS unidades. Se pueden sumar.
--   · Las 4.999 que vinieron de los Excel. Solo dicen a quién y, en
--     texto libre, qué se le dio. El 99,9 % no anotaba la cantidad.
--     Se pueden contar como entregas, pero NO se pueden sumar en
--     unidades: sumarlas sería inventar números.
--
-- Por eso el `left join` con el detalle: una entrega vieja aparece igual
-- en la vista, con `cantidad` en nulo y su texto en `lo_entregado`. El
-- tablero las muestra aparte y jamás las mezcla en el total de unidades.
--
-- Se puede correr varias veces.
-- =====================================================================

drop view if exists farmacia.v_entregas_renglon cascade;

create view farmacia.v_entregas_renglon as
select
  -- ---- la entrega ----
  e.id                      as entrega_id,
  e.fecha,
  e.fecha_original,
  e.creado_en,
  e.origen,
  e.anulada,
  e.anulada_motivo,
  e.observacion             as lo_entregado,
  coalesce(e.entregado_por_nombre, 'No consta (viene del Excel)') as entregado_por,
  e.entregado_por_rol,

  -- ---- a quién ----
  e.tipo_destinatario,
  e.paciente_id,
  e.institucion_id,
  coalesce(p.nombre, i.nombre)                     as destinatario,
  case when e.tipo_destinatario = 'institucion' then i.tipo end as centro_tipo,
  p.nacionalidad,
  p.cedula,
  e.recibe_nombre,
  e.recibe_cedula,

  -- ---- qué se entregó (nulo en las entregas del Excel) ----
  d.id                      as renglon_id,
  d.cantidad,
  pr.id                     as producto_id,
  pr.nombre                 as producto,
  pr.dosificacion,
  pr.presentacion,
  pr.categoria,
  pr.unidad,
  pr.empaque,
  pr.unidades_por_empaque,
  farmacia.en_cajas(d.cantidad, pr.unidades_por_empaque, pr.empaque) as en_cajas,
  l.codigo                  as lote,
  l.vence

from farmacia.entregas e
left join farmacia.pacientes       p  on p.id  = e.paciente_id
left join farmacia.instituciones   i  on i.id  = e.institucion_id
left join farmacia.entrega_detalle d  on d.entrega_id = e.id
left join farmacia.lotes           l  on l.id  = d.lote_id
left join farmacia.productos       pr on pr.id = l.producto_id;

comment on view farmacia.v_entregas_renglon is
  'Un renglón por medicamento entregado. Las entregas migradas del Excel salen con
   cantidad en nulo y su texto en lo_entregado: se cuentan como entregas, nunca en unidades.';

grant select on farmacia.v_entregas_renglon to authenticated, service_role;
alter view farmacia.v_entregas_renglon set (security_invoker = true);

-- El tablero siempre filtra por rango de fechas y ordena por fecha.
create index if not exists ix_entregas_fecha_origen
  on farmacia.entregas (fecha desc, origen);

-- ---------------------------------------------------------------------
-- El día de la entrega es el día de VENEZUELA, no el de UTC.
--
-- El servidor de la base corre en UTC. `current_date` a las 8 de la
-- noche de Charallave ya es el día siguiente, así que una entrega hecha
-- de noche se guardaba con la fecha de mañana y no salía en el reporte
-- "de hoy". Se fija la zona horaria en el valor por defecto, que es de
-- donde sale la fecha: así sigue poniéndola el servidor y nadie la
-- puede adelantar ni atrasar desde el navegador.
-- ---------------------------------------------------------------------
alter table farmacia.entregas
  alter column fecha set default (now() at time zone 'America/Caracas')::date;

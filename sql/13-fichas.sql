-- =====================================================================
-- Fichas de personas y de centros de salud, con lo que hace falta para
-- reconocerlos de un vistazo al ir a entregar.
--
-- Antes la lista de búsqueda solo mostraba el nombre y la cédula. Con dos
-- personas del mismo nombre no había cómo distinguirlas, y no se sabía si
-- esa persona ya había retirado antes ni qué le corresponde.
--
-- Se puede correr varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FICHA DE CADA PERSONA
-- ---------------------------------------------------------------------
create or replace view farmacia.v_pacientes_ficha as
select
  p.id,
  p.nombre,
  p.nacionalidad,
  p.cedula,
  p.cedula_cruda,
  p.rif_digito,
  p.sexo,
  p.fecha_nac,
  -- La edad se calcula aquí para no tener que hacerlo en cada pantalla.
  case when p.fecha_nac is not null
       then extract(year from age(p.fecha_nac))::int end as edad,
  p.telefono,
  p.direccion,
  p.estado,
  p.motivo_revision,

  coalesce(t.medicamentos, 0) as medicamentos,   -- cuántos toma
  coalesce(e.entregas, 0)     as entregas,       -- cuántas veces ha retirado
  e.ultima_entrega,

  -- Para buscar sin que estorben acentos ni mayúsculas.
  farmacia.sin_acentos(upper(p.nombre)) as busqueda

from farmacia.pacientes p
left join (
  select paciente_id, count(*) as medicamentos
    from farmacia.tratamientos_paciente where activo group by paciente_id
) t on t.paciente_id = p.id
left join (
  select paciente_id, count(*) as entregas, max(fecha) as ultima_entrega
    from farmacia.entregas
   where paciente_id is not null and not coalesce(anulada, false)
   group by paciente_id
) e on e.paciente_id = p.id
where p.estado <> 'inactivo';

-- ---------------------------------------------------------------------
-- 2. FICHA DE CADA CENTRO DE SALUD
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
  farmacia.sin_acentos(upper(i.nombre)) as busqueda
from farmacia.instituciones i
left join (
  select institucion_id, count(*) as entregas, max(fecha) as ultima_entrega
    from farmacia.entregas
   where institucion_id is not null and not coalesce(anulada, false)
   group by institucion_id
) e on e.institucion_id = i.id;

-- ---------------------------------------------------------------------
-- 3. Permisos. Las vistas corren con los permisos de quien consulta, así
--    que siguen valiendo las políticas RLS de las tablas de abajo.
-- ---------------------------------------------------------------------
grant select on farmacia.v_pacientes_ficha     to authenticated, service_role;
grant select on farmacia.v_instituciones_ficha to authenticated, service_role;
alter view farmacia.v_pacientes_ficha     set (security_invoker = true);
alter view farmacia.v_instituciones_ficha set (security_invoker = true);

-- ---------------------------------------------------------------------
-- 4. El único centro de salud que se migró estaba desactivado, así que
--    la pantalla de entrega a centros no encontraba ninguno y no había
--    forma de crear uno. Se reactiva.
-- ---------------------------------------------------------------------
update farmacia.instituciones set activo = true where not activo;

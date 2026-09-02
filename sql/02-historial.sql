-- =====================================================================
-- Ajustes para poder guardar el historial de entregas del Excel
-- sin inventar ningun dato. Repetible.
-- =====================================================================

-- Una entrega historica puede no tener fecha legible ("2626-05-11").
-- Antes que inventarla, se deja vacia y se guarda lo que decia el papel.
alter table farmacia.entregas alter column fecha drop not null;

alter table farmacia.entregas add column if not exists fecha_original text;
alter table farmacia.entregas add column if not exists origen_fila text;

comment on column farmacia.entregas.fecha_original is
  'La fecha tal como estaba escrita en el Excel. Se conserva aunque no se haya podido leer.';

-- Pero una entrega NUEVA siempre tiene fecha: el descuido solo se tolera
-- en lo que vino del papel.
alter table farmacia.entregas drop constraint if exists entregas_fecha_obligatoria_en_sistema;
alter table farmacia.entregas add  constraint entregas_fecha_obligatoria_en_sistema
  check (origen <> 'sistema' or fecha is not null);

-- Vista del historial, para consultarlo junto con las entregas nuevas.
create or replace view farmacia.v_historial_entregas as
select e.id,
       e.fecha,
       e.fecha_original,
       e.origen,
       p.nombre                       as paciente,
       p.nacionalidad,
       p.cedula,
       coalesce(e.entregado_por_nombre, 'No consta (viene del Excel)') as entregado_por,
       e.observacion                  as lo_entregado,
       e.anulada
  from farmacia.entregas e
  left join farmacia.pacientes p on p.id = e.paciente_id;

grant select on farmacia.v_historial_entregas to authenticated, service_role;

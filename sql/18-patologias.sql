-- =====================================================================
-- LAS PATOLOGÍAS DE CADA PERSONA
--
-- Por qué una tabla y no una columna de texto:
--
--   Si fuera un campo libre acabaría lleno de "HIPERTENSION", "HTA",
--   "hipertensa", "TENSION ALTA" y "HIPERTENSIÓN ARTERIAL" — cinco formas
--   de escribir lo mismo, imposibles de contar. Ya pasó con los Excel de
--   la farmacia: "ASMATICO" y "ASMA AGUDA" convivían en la misma columna.
--
--   Con una fila por patología se puede contar cuántos hipertensos hay,
--   cruzar con lo que se les entrega y corregir una sola fila cuando
--   alguien la escribió mal. La pantalla además ofrece las más comunes
--   ya escritas, para que casi nunca haga falta teclearlas.
--
-- Son datos de salud de personas reales: viven aquí, detrás de RLS, y
-- nunca en el repositorio.
--
-- Se puede correr varias veces.
-- =====================================================================

create table if not exists farmacia.patologias_paciente (
  id          uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references farmacia.pacientes(id) on delete cascade,
  patologia   text not null,
  nota        text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

alter table farmacia.patologias_paciente drop constraint if exists patologia_no_vacia;
alter table farmacia.patologias_paciente add  constraint patologia_no_vacia
  check (length(trim(patologia)) >= 3);

create index if not exists ix_patologias_paciente
  on farmacia.patologias_paciente (paciente_id);

-- La misma persona no lleva dos veces la misma patología. Se compara sin
-- acentos ni mayúsculas, y solo entre las activas: si se quita y luego se
-- vuelve a poner, tiene que poder.
create unique index if not exists ux_patologia_por_persona
  on farmacia.patologias_paciente (paciente_id, farmacia.sin_acentos(upper(patologia)))
  where activo;

comment on table farmacia.patologias_paciente is
  'Una fila por patología de cada persona. Dato de salud: solo se ve detrás de RLS.';

-- ---------------------------------------------------------------------
-- Bitácora y permisos: exactamente los mismos que el tratamiento.
-- Quien atiende puede verlas, ponerlas y corregirlas.
-- ---------------------------------------------------------------------
drop trigger if exists tr_bitacora_patologias_paciente on farmacia.patologias_paciente;
create trigger tr_bitacora_patologias_paciente
  after insert or update or delete on farmacia.patologias_paciente
  for each row execute function farmacia.fn_bitacora();

alter table farmacia.patologias_paciente enable row level security;
grant select, insert, update on farmacia.patologias_paciente to authenticated;

drop policy if exists patologias_ver on farmacia.patologias_paciente;
create policy patologias_ver on farmacia.patologias_paciente for select to authenticated
  using (farmacia.mi_rol() is not null);

drop policy if exists patologias_crea on farmacia.patologias_paciente;
create policy patologias_crea on farmacia.patologias_paciente for insert to authenticated
  with check (farmacia.mi_rol() is not null);

drop policy if exists patologias_edita on farmacia.patologias_paciente;
create policy patologias_edita on farmacia.patologias_paciente for update to authenticated
  using (farmacia.mi_rol() is not null)
  with check (farmacia.mi_rol() is not null);

-- ---------------------------------------------------------------------
-- Las patologías que YA se han escrito, con cuánta gente las tiene.
-- La pantalla las ofrece al escribir: es lo que evita que la misma cosa
-- entre de cinco formas distintas.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_patologias as
select
  upper(trim(patologia))                    as patologia,
  count(distinct paciente_id)::int          as personas,
  farmacia.sin_acentos(upper(patologia))    as busqueda
from farmacia.patologias_paciente
where activo
group by 1, 3;

grant select on farmacia.v_patologias to authenticated, service_role;
alter view farmacia.v_patologias set (security_invoker = true);

-- ---------------------------------------------------------------------
-- La ficha de la persona las lleva encima, para verlas al ir a entregar
-- sin tener que pedir otra consulta.
--
-- Se AÑADEN al final: `create or replace view` no deja meter una columna
-- en medio, y tumbar esta vista arrastraría a las pantallas que la usan.
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
  case when p.fecha_nac is not null
       then extract(year from age(p.fecha_nac))::int end as edad,
  p.telefono,
  p.direccion,
  p.estado,
  p.motivo_revision,

  coalesce(t.medicamentos, 0) as medicamentos,
  coalesce(e.entregas, 0)     as entregas,
  e.ultima_entrega,

  farmacia.sin_acentos(upper(p.nombre)) as busqueda,

  coalesce(d.patologias, '')  as patologias,      -- separadas por " · "
  coalesce(d.n_patologias, 0) as n_patologias

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
left join (
  select paciente_id,
         string_agg(upper(trim(patologia)), ' · ' order by upper(trim(patologia))) as patologias,
         count(*)::int as n_patologias
    from farmacia.patologias_paciente where activo group by paciente_id
) d on d.paciente_id = p.id
where p.estado <> 'inactivo';

grant select on farmacia.v_pacientes_ficha to authenticated, service_role;
alter view farmacia.v_pacientes_ficha set (security_invoker = true);

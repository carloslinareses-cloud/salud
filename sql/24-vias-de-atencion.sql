-- =====================================================================
-- POR QUÉ VINO LA PERSONA: RÉCIPE U OPERACIÓN
--
-- Hasta ahora la farmacia tenía una sola forma de ver a alguien: una
-- persona con un tratamiento crónico, que viene cada mes por lo mismo.
-- Pero por el mostrador entran, y siempre entraron, otras dos:
--
--   · Con un RÉCIPE. Un médico le indicó unas medicinas concretas, hoy.
--     No es su tratamiento de siempre; es lo que dice ese papel.
--   · Para una OPERACIÓN. El hospital le entregó una lista de insumos
--     que tiene que llevar el día de la intervención, y viene a ver si
--     la Alcaldía se los cubre. Ahí lo que importa es DE QUÉ es la
--     operación, porque es lo que justifica el gasto.
--
-- Las dos terminan en lo mismo —una entrega— pero se piden distinto y
-- hay que poder contarlas por separado.
--
-- Se guarda como una SOLICITUD: una fila por cada vez que la persona
-- viene por una de estas dos vías. No es un campo de la persona porque
-- no es una propiedad suya: alguien puede traer un récipe en marzo y
-- operarse en septiembre, y las dos cosas son ciertas y distintas.
--
-- Se puede correr varias veces.
-- =====================================================================

create table if not exists farmacia.solicitudes (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references farmacia.pacientes(id) on delete cascade,
  via           text not null,
  motivo        text,
  indicado_por  text,
  nota          text,
  activa        boolean not null default true,
  creado_en     timestamptz not null default now(),
  creado_por    uuid,
  creado_por_nombre text,
  creado_por_rol    text
);

alter table farmacia.solicitudes drop constraint if exists solicitud_via_valida;
alter table farmacia.solicitudes add  constraint solicitud_via_valida
  check (via in ('recipe', 'operacion'));

-- El motivo es OBLIGATORIO en las operaciones: sin él, dentro de un año
-- nadie sabe por qué se entregaron esos insumos. En un récipe es
-- opcional, porque lo que manda ahí es la lista de medicinas.
alter table farmacia.solicitudes drop constraint if exists solicitud_operacion_con_motivo;
alter table farmacia.solicitudes add  constraint solicitud_operacion_con_motivo
  check (via <> 'operacion' or length(trim(coalesce(motivo, ''))) >= 4);

create index if not exists ix_solicitudes_paciente
  on farmacia.solicitudes (paciente_id, creado_en desc);
create index if not exists ix_solicitudes_via
  on farmacia.solicitudes (via, creado_en desc);

comment on table farmacia.solicitudes is
  'Cada vez que una persona viene con un récipe o para una operación.
   Dato de salud: solo se ve detrás de RLS.';
comment on column farmacia.solicitudes.motivo is
  'De qué es la operación. Obligatorio cuando via = operacion.';
comment on column farmacia.solicitudes.indicado_por is
  'Quién lo indicó: el médico o el centro. Se escribe tal cual dice el papel.';

-- ---------------------------------------------------------------------
-- Quién la registró. Igual que en las entregas: lo pone un trigger con
-- auth.uid(), NO un DEFAULT, porque el DEFAULT solo aplica si el
-- navegador omite la columna, y el navegador la puede mandar.
-- ---------------------------------------------------------------------
-- OJO: la tabla de usuarios de este esquema se llama `perfiles`, no
-- `usuarios`. Y no hace falta consultarla a mano: mi_nombre() y mi_rol()
-- ya lo hacen, son las que usa el resto del esquema (fn_sellar_entrega),
-- y van con search_path vacio para que nadie las pueda enganar.
create or replace function farmacia.fn_solicitud_autor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.creado_por        := auth.uid();
  new.creado_por_nombre := farmacia.mi_nombre();
  new.creado_por_rol    := farmacia.mi_rol();
  return new;
end $$;

drop trigger if exists tr_solicitud_autor on farmacia.solicitudes;
create trigger tr_solicitud_autor
  before insert on farmacia.solicitudes
  for each row execute function farmacia.fn_solicitud_autor();

drop trigger if exists tr_bitacora_solicitudes on farmacia.solicitudes;
create trigger tr_bitacora_solicitudes
  after insert or update or delete on farmacia.solicitudes
  for each row execute function farmacia.fn_bitacora();

alter table farmacia.solicitudes enable row level security;
grant select, insert, update on farmacia.solicitudes to authenticated;

drop policy if exists solicitudes_ver on farmacia.solicitudes;
create policy solicitudes_ver on farmacia.solicitudes for select to authenticated
  using (farmacia.mi_rol() is not null);

drop policy if exists solicitudes_crea on farmacia.solicitudes;
create policy solicitudes_crea on farmacia.solicitudes for insert to authenticated
  with check (farmacia.mi_rol() is not null);

drop policy if exists solicitudes_edita on farmacia.solicitudes;
create policy solicitudes_edita on farmacia.solicitudes for update to authenticated
  using (farmacia.mi_rol() is not null)
  with check (farmacia.mi_rol() is not null);

-- ---------------------------------------------------------------------
-- Las medicinas de un récipe, o los insumos de una operación, se anotan
-- donde ya se anota todo lo que una persona necesita. Lo único que se
-- añade es de dónde salieron, para poder distinguir "lo que toma
-- siempre" de "lo que le indicaron aquel día".
-- ---------------------------------------------------------------------
alter table farmacia.tratamientos_paciente
  add column if not exists solicitud_id uuid references farmacia.solicitudes(id) on delete set null;

create index if not exists ix_tratamientos_solicitud
  on farmacia.tratamientos_paciente (solicitud_id)
  where solicitud_id is not null;

alter table farmacia.tratamientos_paciente drop constraint if exists tratamiento_origen_valido;
alter table farmacia.tratamientos_paciente add  constraint tratamiento_origen_valido
  check (origen in ('sistema', 'migracion', 'cuaderno', 'recipe', 'operacion'));

comment on column farmacia.tratamientos_paciente.solicitud_id is
  'Si vino de un récipe o de una operación, cuál. Nulo en el tratamiento de siempre.';

-- ---------------------------------------------------------------------
-- La solicitud con su gente y con lo que se pidió en ella.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_solicitudes as
select
  s.id            as solicitud_id,
  s.paciente_id,
  s.via,
  s.motivo,
  s.indicado_por,
  s.nota,
  s.activa,
  s.creado_en,
  coalesce(s.creado_por_nombre, 'No consta') as registrada_por,
  p.nombre        as persona,
  p.nacionalidad,
  p.cedula,
  p.telefono,
  p.direccion,
  coalesce(r.renglones, 0) as renglones
from farmacia.solicitudes s
join farmacia.pacientes p on p.id = s.paciente_id
left join (
  select solicitud_id, count(*)::int as renglones
    from farmacia.tratamientos_paciente
   where solicitud_id is not null and activo
   group by solicitud_id
) r on r.solicitud_id = s.id;

grant select on farmacia.v_solicitudes to authenticated, service_role;
alter view farmacia.v_solicitudes set (security_invoker = true);

-- ---------------------------------------------------------------------
-- La ficha de la persona dice si vino por alguna de estas vías. Las
-- columnas se AÑADEN al final: `create or replace view` no deja meter
-- una en medio ni cambiarlas de sitio.
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
  coalesce(d.n_patologias, 0) as n_patologias,

  coalesce(s.solicitudes, 0)  as solicitudes,
  s.ultima_via,
  s.ultimo_motivo,
  s.ultima_solicitud

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
left join (
  -- La última de cada persona. `distinct on` con el mismo orden del
  -- `order by` devuelve una sola fila por paciente: la más reciente.
  select paciente_id, solicitudes, via as ultima_via, motivo as ultimo_motivo,
         creado_en as ultima_solicitud
    from (
      select distinct on (paciente_id)
             paciente_id, via, motivo, creado_en,
             count(*) over (partition by paciente_id)::int as solicitudes
        from farmacia.solicitudes
       where activa
       order by paciente_id, creado_en desc
    ) z
) s on s.paciente_id = p.id
where p.estado <> 'inactivo';

grant select on farmacia.v_pacientes_ficha to authenticated, service_role;
alter view farmacia.v_pacientes_ficha set (security_invoker = true);

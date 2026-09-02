-- =====================================================================
-- El RIF venezolano de una persona natural es la cédula MAS un dígito
-- verificador al final:  V-17685436-2  =  cédula 17685436 + dígito 2.
--
-- En la carga inicial se guardaron pegados (176854362) o con puntos
-- (17.114.309.2). Aquí se separan: la cédula queda limpia y el dígito
-- se guarda aparte, sin perder nada.
--
-- Repetible: correrlo dos veces no vuelve a recortar.
-- =====================================================================

alter table farmacia.pacientes add column if not exists rif_digito text;

alter table farmacia.pacientes drop constraint if exists pacientes_rif_digito_valido;
alter table farmacia.pacientes add  constraint pacientes_rif_digito_valido
  check (rif_digito is null or rif_digito ~ '^[0-9]$');

comment on column farmacia.pacientes.rif_digito is
  'Dígito verificador del RIF, el que va después del último guion.
   Se guarda aparte para que la cédula quede limpia y el RIF se pueda rearmar.';

-- Vista con el RIF ya armado, para los documentos que lo piden.
create or replace view farmacia.v_pacientes_identificacion as
select id, nombre, estado,
       nacionalidad, cedula, rif_digito, cedula_cruda,
       case when cedula is null then null
            else coalesce(nacionalidad,'V') || '-' || cedula
       end as cedula_completa,
       case when cedula is null or rif_digito is null then null
            else coalesce(nacionalidad,'V') || '-' || cedula || '-' || rif_digito
       end as rif
  from farmacia.pacientes;

grant select on farmacia.v_pacientes_identificacion to authenticated, service_role;

-- --------------------------------------------------------------------
-- Corrección de lo ya cargado: los que quedaron con 9 dígitos.
-- Solo se toca si al separarlo NO choca con otra persona.
-- --------------------------------------------------------------------
update farmacia.pacientes p
   set cedula     = left(p.cedula, length(p.cedula) - 1),
       rif_digito = right(p.cedula, 1)
 where p.cedula ~ '^[0-9]{9}$'
   and p.rif_digito is null
   and not exists (
       select 1 from farmacia.pacientes q
        where q.id <> p.id
          and q.nacionalidad = p.nacionalidad
          and q.cedula = left(p.cedula, length(p.cedula) - 1));

-- El que venía con guion explícito y quedó "por revisar".
update farmacia.pacientes
   set cedula          = '17685436',
       rif_digito      = '2',
       nacionalidad    = 'V',
       estado          = 'activo',
       motivo_revision = null
 where cedula_cruda = '17685436-2'
   and cedula is null
   and not exists (select 1 from farmacia.pacientes q
                    where q.cedula = '17685436' and q.nacionalidad = 'V');

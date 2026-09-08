-- =====================================================================
-- DE DÓNDE SALIÓ CADA RENGLÓN DEL TRATAMIENTO
--
-- El cuaderno anotaba el tratamiento en la casilla de cada entrega. Eso
-- se va a pasar al tratamiento de cada persona para que todo se vea y se
-- corrija en un solo sitio, que es como se trabaja de verdad.
--
-- Antes de moverlo hace falta poder distinguirlo. Con esta columna:
--
--   · se sabe qué renglón lo escribió una persona aquí y cuál vino del
--     cuaderno, sin tener que adivinarlo;
--   · el traslado se puede deshacer entero con una sola orden:
--         delete from farmacia.tratamientos_paciente where origen = 'cuaderno';
--   · si mañana hay que repetirlo, no duplica: se sabe qué ya se pasó.
--
-- Los renglones que ya existían se marcan 'migracion': vinieron de los
-- Excel de la farmacia, no los escribió nadie en el sistema.
--
-- Se puede correr varias veces.
-- =====================================================================

alter table farmacia.tratamientos_paciente
  add column if not exists origen text not null default 'sistema';

alter table farmacia.tratamientos_paciente drop constraint if exists tratamiento_origen_valido;
alter table farmacia.tratamientos_paciente add  constraint tratamiento_origen_valido
  check (origen in ('sistema', 'migracion', 'cuaderno'));

comment on column farmacia.tratamientos_paciente.origen is
  'sistema = lo escribió alguien en la aplicación; migracion = vino de los Excel;
   cuaderno = se dedujo de lo que dice la casilla de sus entregas.';

-- Los que ya estaban antes de que existiera esta columna no los escribió
-- nadie aquí: son de la migración. Solo se toca una vez.
update farmacia.tratamientos_paciente
   set origen = 'migracion'
 where origen = 'sistema'
   and creado_en < timestamptz '2026-09-05';

create index if not exists ix_tratamientos_origen
  on farmacia.tratamientos_paciente (origen);

-- La ficha necesita saberlo para poder decir de dónde viene cada renglón.
create or replace view farmacia.v_tratamiento_paciente as
select t.id as tratamiento_id, t.paciente_id, t.producto_id, t.texto_original,
       c.producto, c.dosificacion, c.presentacion, c.categoria,
       c.disponible, c.vence_primero, c.situacion, t.origen
  from farmacia.tratamientos_paciente t
  join farmacia.v_catalogo c on c.producto_id = t.producto_id
 where t.activo
union all
select distinct e.tratamiento_id, e.paciente_id, c.producto_id, e.texto_original,
       c.producto, c.dosificacion, c.presentacion, c.categoria,
       c.disponible, c.vence_primero, c.situacion, e.origen
from (
  select b.id as tratamiento_id, b.paciente_id, b.texto_original, b.origen,
         trim(regexp_replace(x.pieza, '\s+', ' ', 'g')) as pieza
    from (select t.id, t.paciente_id, t.texto_original, t.origen
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
       null, null, null, null, null, null::date, null, t.origen
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
        on farmacia.sin_acentos(upper(c2.producto)) =
           farmacia.sin_acentos(upper(trim(regexp_replace(y.pieza, '\s+', ' ', 'g'))))
     where length(trim(y.pieza)) >= 3
  );

grant select on farmacia.v_tratamiento_paciente to authenticated, service_role;
alter view farmacia.v_tratamiento_paciente set (security_invoker = true);

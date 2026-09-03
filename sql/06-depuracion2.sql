-- =====================================================================
-- Segunda pasada de depuración. Repetible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Corrige un error de la carga inicial: a quien tenía la fecha de
--    nacimiento ilegible se le borró TAMBIÉN la cédula, aunque la cédula
--    estaba perfecta. Se recupera del dato original.
-- ---------------------------------------------------------------------
update farmacia.pacientes p
   set cedula          = regexp_replace(p.cedula_cruda, '[^0-9]', '', 'g'),
       nacionalidad    = coalesce(p.nacionalidad, 'V'),
       estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se recuperó la cédula, que estaba correcta en el Excel. '
                         'Solo la fecha de nacimiento venía ilegible, y quedó vacía.'
 where p.estado = 'por_revisar'
   and p.cedula is null
   and p.cedula_cruda ~ '^[0-9]{6,8}$'
   and not exists (select 1 from farmacia.pacientes q
                    where q.id <> p.id
                      and q.cedula = regexp_replace(p.cedula_cruda, '[^0-9]', '', 'g')
                      and coalesce(q.nacionalidad,'V') = coalesce(p.nacionalidad,'V')
                      and q.estado <> 'inactivo');

-- ---------------------------------------------------------------------
-- 2. Cédulas con un signo pegado al final: 6993281/ es 6993281.
-- ---------------------------------------------------------------------
update farmacia.pacientes p
   set cedula          = regexp_replace(p.cedula_cruda, '[^0-9]', '', 'g'),
       nacionalidad    = coalesce(p.nacionalidad, 'V'),
       estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'La cédula venía con un signo pegado (' || p.cedula_cruda || '). '
                         'Se conservó solo el número.'
 where p.estado = 'por_revisar'
   and p.cedula is null
   and p.cedula_cruda ~ '^[0-9]{6,8}[^0-9]+$'
   and not exists (select 1 from farmacia.pacientes q
                    where q.id <> p.id
                      and q.cedula = regexp_replace(p.cedula_cruda, '[^0-9]', '', 'g')
                      and q.estado <> 'inactivo');

-- ---------------------------------------------------------------------
-- 3. Los que tienen nombre pero en la celda de la cédula venía otra cosa
--    (el propio nombre, una lista de medicamentos, una letra suelta).
--    La persona se identifica por su nombre y se puede atender: se
--    activan sin cédula, y queda anotado que falta cargarla.
-- ---------------------------------------------------------------------
update farmacia.pacientes
   set estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se activó sin cédula: en esa celda del Excel no venía una cédula '
                         'sino «' || left(coalesce(cedula_cruda, 'nada'), 40) || '». '
                         'Falta cargar la cédula cuando la persona la traiga.'
 where estado = 'por_revisar'
   and cedula is null
   and motivo_revision like '%no es una cédula%'
   -- solo quien tiene un nombre de persona de verdad
   and nombre !~* '^\(?sin nombre'
   and nombre !~* 'falta el nombre'
   -- y cuyo dato original NO sea una cédula recuperable (esos ya se hicieron arriba)
   and coalesce(cedula_cruda, '') !~ '^[0-9]{6,8}[^0-9]*$';

-- ---------------------------------------------------------------------
-- 4. Fichas repetidas de un mismo extranjero: el número escrito de
--    varias formas (con la E pegada, con la E y espacios, con puntos).
--    Si ese número ya lo tiene una ficha activa, las demás se unifican
--    en ella en vez de intentar repetir el número.
-- ---------------------------------------------------------------------
do $$
declare p record; v_bueno uuid;
begin
  for p in
    select id, regexp_replace(cedula_cruda, '[^0-9]', '', 'g') as num
      from farmacia.pacientes
     where estado <> 'inactivo'
       and cedula is null
       and cedula_cruda is not null
       and regexp_replace(cedula_cruda, '[^0-9]', '', 'g') ~ '^[0-9]{6,8}$'
  loop
    select id into v_bueno from farmacia.pacientes
     where nacionalidad = 'E' and cedula = p.num and estado = 'activo' limit 1;

    if v_bueno is not null and v_bueno <> p.id then
      update farmacia.entregas set paciente_id = v_bueno where paciente_id = p.id;
      update farmacia.tratamientos_paciente set paciente_id = v_bueno where paciente_id = p.id;
      update farmacia.pacientes
         set estado = 'inactivo', motivo_revision = null,
             nota_correccion = 'Ficha repetida del mismo número de extranjero, escrito de otra '
                               'forma. Historial unificado en una sola ficha.'
       where id = p.id;
    end if;
  end loop;
end $$;

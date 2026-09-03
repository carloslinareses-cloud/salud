-- =====================================================================
-- Depuración de los registros que quedaron marcados "por revisar".
--
-- Cada corrección de aquí es DETERMINISTA: se resuelve con lo que ya está
-- en la base, sin adivinar ningún dato de ninguna persona. El valor
-- original se conserva en cedula_cruda y todo queda en la bitácora.
--
-- Se puede correr varias veces: lo ya corregido no se vuelve a tocar.
-- =====================================================================

-- Para poder dejar constancia de qué se corrigió y por qué.
alter table farmacia.pacientes add column if not exists nota_correccion text;

-- ---------------------------------------------------------------------
-- 1. La fecha de nacimiento ilegible NO impide atender a nadie.
--    Estas personas tienen nombre y cédula correctos: lo único que
--    falta es su fecha de nacimiento, que queda vacía.
-- ---------------------------------------------------------------------
update farmacia.pacientes
   set estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se activó: nombre y cédula correctos. La fecha de nacimiento '
                         'venía ilegible en el Excel y quedó vacía.'
 where estado = 'por_revisar'
   and motivo_revision = 'fecha de nacimiento ilegible'
   and cedula is not null;

-- ---------------------------------------------------------------------
-- 2. Las cédulas que empiezan por una vocal con diéresis o acento
--    seguida de números son una E mal tecleada (tecla vecina): son
--    cédulas de extranjero.
-- ---------------------------------------------------------------------
update farmacia.pacientes p
   set nacionalidad    = 'E',
       cedula          = regexp_replace(p.cedula_cruda, '^.', ''),
       estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'La cédula venía con una vocal acentuada al principio. Es un error '
                         'de tecleo de la E de extranjero.'
 where p.cedula is null
   and p.cedula_cruda ~ '^[ËëÉéÏïÍí][0-9]{6,8}$'
   and not exists (select 1 from farmacia.pacientes q
                    where q.nacionalidad = 'E'
                      and q.cedula = regexp_replace(p.cedula_cruda, '^.', ''));

-- ---------------------------------------------------------------------
-- 3. Fusión de duplicados: la misma persona aparece dos veces, una con
--    la cédula bien y otra con la celda equivocada.
--    Solo se fusiona cuando hay UNA sola coincidencia activa y con
--    cédula válida. Si hay dos posibles, no se toca.
-- ---------------------------------------------------------------------
create temporary table if not exists fusiones as
select p.id  as id_malo,
       q.id  as id_bueno,
       p.nombre,
       p.cedula_cruda
  from farmacia.pacientes p
  join farmacia.pacientes q
    on upper(trim(q.nombre)) = upper(trim(p.nombre))
   and q.id <> p.id
   and q.estado = 'activo'
   and q.cedula is not null
 where p.estado = 'por_revisar'
   and p.cedula is null
   and (select count(*) from farmacia.pacientes z
         where upper(trim(z.nombre)) = upper(trim(p.nombre))
           and z.id <> p.id and z.estado = 'activo' and z.cedula is not null) = 1;

-- Las entregas del registro duplicado pasan al bueno, para no perder historial.
update farmacia.entregas e
   set paciente_id = f.id_bueno
  from fusiones f
 where e.paciente_id = f.id_malo;

update farmacia.tratamientos_paciente t
   set paciente_id = f.id_bueno
  from fusiones f
 where t.paciente_id = f.id_malo;

update farmacia.pacientes p
   set estado          = 'inactivo',
       motivo_revision = null,
       nota_correccion = 'Ficha duplicada. Su historial se pasó a la ficha con la cédula correcta.'
  from fusiones f
 where p.id = f.id_malo;

-- ---------------------------------------------------------------------
-- 4. Unificación general por número de cédula.
--    Cuando el mismo número aparece en varias fichas con el MISMO nombre
--    (aunque escrito en otro orden o con otra nacionalidad), es una sola
--    persona. Se conserva la ficha más antigua y las demás se desactivan
--    pasando su historial.
--    Si los nombres son de personas distintas, NO se toca.
-- ---------------------------------------------------------------------
do $$
declare g record; v_bueno uuid;
begin
  for g in
    select regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') as num,
           count(*) as cuantas
      from farmacia.pacientes
     where estado <> 'inactivo'
       and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') ~ '^[0-9]{6,8}$'
     group by 1
    having count(*) > 1
  loop
    -- ¿todos los nombres del grupo son la misma persona?
    -- Se comparan las palabras del nombre, sin importar el orden.
    if (select count(distinct (
          select string_agg(w, ' ' order by w)
            from unnest(string_to_array(upper(farmacia.sin_acentos(nombre)), ' ')) w
           where length(w) > 2))
          from farmacia.pacientes
         where estado <> 'inactivo'
           and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') = g.num) = 1
    then
      select id into v_bueno from farmacia.pacientes
       where estado <> 'inactivo'
         and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') = g.num
       order by (cedula is not null) desc, creado_en
       limit 1;

      update farmacia.entregas e set paciente_id = v_bueno
        from farmacia.pacientes p
       where e.paciente_id = p.id and p.id <> v_bueno
         and p.estado <> 'inactivo'
         and regexp_replace(coalesce(p.cedula, p.cedula_cruda), '[^0-9]', '', 'g') = g.num;

      update farmacia.tratamientos_paciente t set paciente_id = v_bueno
        from farmacia.pacientes p
       where t.paciente_id = p.id and p.id <> v_bueno
         and p.estado <> 'inactivo'
         and regexp_replace(coalesce(p.cedula, p.cedula_cruda), '[^0-9]', '', 'g') = g.num;

      update farmacia.pacientes
         set estado = 'inactivo', motivo_revision = null,
             nota_correccion = 'Ficha repetida de la cédula ' || g.num ||
                               '. Su historial se unificó en una sola ficha.'
       where id <> v_bueno
         and estado <> 'inactivo'
         and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') = g.num;

      update farmacia.pacientes
         set estado = 'activo', motivo_revision = null,
             cedula = coalesce(cedula, g.num),
             nota_correccion = coalesce(nota_correccion,
                               'Ficha unificada: el mismo número de cédula estaba repartido en '
                               'varias fichas con el mismo nombre.')
       where id = v_bueno;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Mismo nombre EXACTO y mismo número de cédula en dos fichas: es una
--    repetición, no un conflicto. Se conserva la más antigua.
--    Hace falta aparte de la regla 4 porque, si con ese mismo número hay
--    además una ficha a nombre de OTRA persona, la regla 4 se abstiene de
--    tocar el grupo entero. Esa tercera ficha sigue sin tocarse: eso sí
--    necesita que alguien lo verifique.
-- ---------------------------------------------------------------------
do $$
declare g record; v_bueno uuid;
begin
  for g in
    select upper(trim(nombre)) as nom,
           regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') as num
      from farmacia.pacientes
     where estado <> 'inactivo'
       and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') ~ '^[0-9]{6,8}$'
     group by 1, 2
    having count(*) > 1
  loop
    select id into v_bueno from farmacia.pacientes
     where estado <> 'inactivo'
       and upper(trim(nombre)) = g.nom
       and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') = g.num
     order by (cedula is not null) desc, creado_en
     limit 1;

    update farmacia.entregas e set paciente_id = v_bueno
      from farmacia.pacientes p
     where e.paciente_id = p.id and p.id <> v_bueno
       and p.estado <> 'inactivo' and upper(trim(p.nombre)) = g.nom
       and regexp_replace(coalesce(p.cedula, p.cedula_cruda), '[^0-9]', '', 'g') = g.num;

    update farmacia.tratamientos_paciente t set paciente_id = v_bueno
      from farmacia.pacientes p
     where t.paciente_id = p.id and p.id <> v_bueno
       and p.estado <> 'inactivo' and upper(trim(p.nombre)) = g.nom
       and regexp_replace(coalesce(p.cedula, p.cedula_cruda), '[^0-9]', '', 'g') = g.num;

    update farmacia.pacientes
       set estado = 'inactivo', motivo_revision = null,
           nota_correccion = 'Ficha repetida con el mismo nombre y la misma cédula. Historial unificado.'
     where id <> v_bueno and estado <> 'inactivo' and upper(trim(nombre)) = g.nom
       and regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') = g.num;

    update farmacia.pacientes
       set estado = 'activo', motivo_revision = null,
           cedula = coalesce(cedula, g.num),
           nota_correccion = coalesce(nota_correccion,
                             'Ficha unificada: estaba repetida con el mismo nombre y la misma cédula.')
     where id = v_bueno and cedula is null
       and not exists (select 1 from farmacia.pacientes z
                        where z.id <> v_bueno and z.estado <> 'inactivo'
                          and z.cedula = g.num and z.nacionalidad = 'V');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Los que solo tienen su propio nombre pegado en la celda de la
--    cédula: la cédula sencillamente falta. La persona se identifica
--    por su nombre, así que se activa y se puede atender.
--    La cédula queda vacía hasta que alguien la traiga.
-- ---------------------------------------------------------------------
update farmacia.pacientes
   set estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se activó sin cédula: en esa celda del Excel venía el propio nombre '
                         'de la persona, no una cédula. Falta cargarla cuando la traiga.'
 where estado = 'por_revisar'
   and cedula is null
   and nombre <> '(sin nombre)'
   and motivo_revision like '%no es una cédula%'
   -- el contenido de la celda se parece al nombre: es el nombre pegado
   and replace(upper(farmacia.sin_acentos(coalesce(cedula_cruda, ''))), ' ', '')
     = replace(upper(farmacia.sin_acentos(nombre)), ' ', '');

-- ---------------------------------------------------------------------
-- 7. Los que traían la lista de medicamentos en la celda de la cédula
--    (se corrió una columna al pegar). El nombre está bien, así que se
--    activan sin cédula.
-- ---------------------------------------------------------------------
update farmacia.pacientes
   set estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se activó sin cédula: en esa celda del Excel se coló la lista de '
                         'medicamentos. Falta cargar la cédula.'
 where estado = 'por_revisar'
   and cedula is null
   and nombre <> '(sin nombre)'
   and motivo_revision like '%no es una cédula%'
   and cedula_cruda ~* '[0-9]\s?(mg|ml|mcg|gr)\b';

-- ---------------------------------------------------------------------
-- 8. Los que vienen del historial sin cédula utilizable: tienen nombre,
--    se les entregó medicamento, y se pueden buscar por nombre.
-- ---------------------------------------------------------------------
update farmacia.pacientes
   set estado          = 'activo',
       motivo_revision = null,
       nota_correccion = 'Se activó sin cédula: en el registro diario no venía una cédula '
                         'utilizable. Falta cargarla.'
 where estado = 'por_revisar'
   and cedula is null
   and nombre <> '(sin nombre)'
   and motivo_revision like '%historial sin una cédula%';

-- ---------------------------------------------------------------------
-- 9. Fila repetida exacta: se desactiva la copia y su historial pasa
--    a la ficha buena.
-- ---------------------------------------------------------------------
do $$
declare m record; v_bueno uuid;
begin
  for m in
    select id, regexp_replace(coalesce(cedula, cedula_cruda), '[^0-9]', '', 'g') as num
      from farmacia.pacientes
     where estado = 'por_revisar' and motivo_revision like '%repetida%'
  loop
    select id into v_bueno from farmacia.pacientes
     where estado = 'activo' and cedula = m.num and id <> m.id limit 1;
    if v_bueno is not null then
      update farmacia.entregas set paciente_id = v_bueno where paciente_id = m.id;
      update farmacia.tratamientos_paciente set paciente_id = v_bueno where paciente_id = m.id;
      update farmacia.pacientes
         set estado = 'inactivo', motivo_revision = null,
             nota_correccion = 'Ficha repetida. Historial unificado.'
       where id = m.id;
    end if;
  end loop;
end $$;

drop table if exists fusiones;

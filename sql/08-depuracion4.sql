-- =====================================================================
-- Cuarta pasada: la misma persona registrada dos veces, una con el
-- nombre completo (de la matriz) y otra con el nombre corto (del
-- registro diario), compartiendo la MISMA cédula.
--
--   Ejemplo del patrón: "NOMBRE APELLIDO DE APELLIDO" en una ficha y
--   "NOMBRE APELLIDO" en la otra, con la misma cédula.
--
-- Como la cédula es la misma y comparten apellido, es una sola persona.
-- Se unifica el historial y se conserva el nombre más completo.
-- Repetible.
-- =====================================================================
do $$
declare p record; v_bueno uuid; v_nombre_bueno text; v_num text;
begin
  for p in
    select id, nombre, regexp_replace(cedula_cruda, '[^0-9]', '', 'g') as num
      from farmacia.pacientes
     where estado = 'por_revisar'
       and cedula is null
       and cedula_cruda ~ '^[0-9]{6,8}$'
  loop
    v_num := p.num;
    v_bueno := null;

    select q.id, q.nombre into v_bueno, v_nombre_bueno
      from farmacia.pacientes q
     where q.cedula = v_num
       and q.estado = 'activo'
       and q.id <> p.id
       -- comparten al menos una palabra larga del nombre (un apellido)
       and exists (
         select 1
           from unnest(string_to_array(upper(farmacia.sin_acentos(q.nombre)), ' ')) a
           join unnest(string_to_array(upper(farmacia.sin_acentos(p.nombre)), ' ')) b
             on a = b
          where length(a) > 3)
     limit 1;

    if v_bueno is not null then
      update farmacia.entregas set paciente_id = v_bueno where paciente_id = p.id;
      update farmacia.tratamientos_paciente set paciente_id = v_bueno where paciente_id = p.id;

      -- se conserva el nombre más completo de los dos
      update farmacia.pacientes
         set nombre = case when length(p.nombre) > length(v_nombre_bueno)
                           then p.nombre else nombre end,
             nota_correccion = coalesce(nota_correccion, '') ||
               case when length(p.nombre) > length(v_nombre_bueno)
                    then ' Se adoptó el nombre completo: «' || p.nombre || '».'
                    else '' end
       where id = v_bueno;

      update farmacia.pacientes
         set estado = 'inactivo', motivo_revision = null,
             nota_correccion = 'Ficha repetida de la cédula ' || v_num ||
                               '. La misma persona estaba con el nombre corto y con el completo; '
                               'se unificó el historial en una sola ficha.'
       where id = p.id;
    end if;
  end loop;
end $$;

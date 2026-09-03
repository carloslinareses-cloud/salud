-- =====================================================================
-- Tercera pasada: los que quedaron "por revisar" porque su cédula ya la
-- tiene otra ficha. Si el nombre coincide, es la misma persona: se
-- unifica el historial en una sola ficha. Repetible.
-- =====================================================================
do $$
declare p record; v_bueno uuid; v_num text;
begin
  for p in
    select id, nombre, cedula_cruda,
           regexp_replace(cedula_cruda, '[^0-9]', '', 'g') as num
      from farmacia.pacientes
     where estado = 'por_revisar'
       and cedula is null
       and cedula_cruda ~ '^[0-9]{6,8}$'
  loop
    v_num := p.num;

    -- la ficha activa que ya tiene ese número, si el nombre es la misma persona
    select q.id into v_bueno
      from farmacia.pacientes q
     where q.cedula = v_num
       and q.estado = 'activo'
       and q.id <> p.id
       -- mismas palabras del nombre, sin importar el orden ni los acentos
       and (select string_agg(w, ' ' order by w)
              from unnest(string_to_array(upper(farmacia.sin_acentos(q.nombre)), ' ')) w
             where length(w) > 2)
         = (select string_agg(w, ' ' order by w)
              from unnest(string_to_array(upper(farmacia.sin_acentos(p.nombre)), ' ')) w
             where length(w) > 2)
     limit 1;

    if v_bueno is not null then
      update farmacia.entregas set paciente_id = v_bueno where paciente_id = p.id;
      update farmacia.tratamientos_paciente set paciente_id = v_bueno where paciente_id = p.id;
      update farmacia.pacientes
         set estado = 'inactivo', motivo_revision = null,
             nota_correccion = 'Ficha repetida de la cédula ' || v_num ||
                               '. Su historial se unificó en la ficha principal.'
       where id = p.id;
    end if;
    v_bueno := null;
  end loop;
end $$;

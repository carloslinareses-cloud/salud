-- Prueba de escritura de los campos nuevos. Todo se revierte.
begin;
do $$
declare
  v_evento uuid;
  v_registro uuid;
begin
  insert into farmacia.jornadas_eventos(tipo, fecha, lugar, firmas)
    values ('salud_escuela', current_date, 'ZZZ PRUEBA SALUD ESCUELA', '[]'::jsonb)
    returning id into v_evento;
  insert into farmacia.jornadas_registros
    (evento_id, conjunto, fecha, nombre, edad_texto, sexo, telefono, direccion,
     tratamiento, estado, representante_nombre, representante_cedula,
     comuna, comunidad, plantel, seccion)
    values (v_evento, 'salud_escuela', current_date, 'ZZZ NIÑO DE PRUEBA', '8',
      'M', '04141234567', 'Dirección de prueba', 'Tratamiento de prueba', 'activo',
      'ZZZ REPRESENTANTE DE PRUEBA', '12345678', 'COMUNA DE PRUEBA',
      'COMUNIDAD DE PRUEBA', 'PLANTEL DE PRUEBA', 'A')
    returning id into v_registro;
  if not exists (
    select 1 from farmacia.jornadas_registros
    where id = v_registro and evento_id = v_evento and conjunto = 'salud_escuela'
      and representante_cedula = '12345678' and plantel = 'PLANTEL DE PRUEBA'
      and seccion = 'A' and comuna = 'COMUNA DE PRUEBA'
  ) then
    raise exception 'Los campos escolares no quedaron guardados.';
  end if;
end $$;
rollback;

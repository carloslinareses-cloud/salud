-- =====================================================================
-- FARMACIA MUNICIPAL · Asistencia: salida libre y fin de semana libre
-- =====================================================================
-- Pedido del usuario (19/09/2026):
--   · De lunes a viernes, la ENTRADA sigue con su horario (7:00 a 8:45),
--     pero la SALIDA queda libre: se marca a cualquier hora, porque hay
--     días en que se trabaja más.
--   · Sábado y domingo, entrada y salida libres.
--
-- Queda como dos interruptores en la configuración (el panel los muestra),
-- así se puede volver atrás sin tocar la base:
--   salida_libre         → la salida no tiene horario ningún día.
--   fin_de_semana_libre  → sábado y domingo no hay horario ni para entrar.
--
-- Salir después de medianoche: con la salida libre, alguien que entró el
-- lunes puede marcar la salida el martes de madrugada. Si hoy no tiene
-- entrada, se le cierra la de AYER que siga abierta, siempre que no hayan
-- pasado más de 18 horas desde que entró (así no se cierra por error una
-- jornada olvidada de hace días). La app no cambia: la base le devuelve
-- esa jornada abierta y la app ofrece "Marcar salida".
--
-- Se puede correr COMPLETO y VARIAS VECES: los interruptores nacen
-- encendidos solo la primera vez; si el admin los apaga desde el panel,
-- volver a correr este archivo no se los prende.
-- =====================================================================

alter table farmacia.config_asistencia
  add column if not exists salida_libre boolean not null default true,
  add column if not exists fin_de_semana_libre boolean not null default true;

comment on column farmacia.config_asistencia.salida_libre is
  'Si está encendido, la salida se marca a cualquier hora (sin ventana de salida).';
comment on column farmacia.config_asistencia.fin_de_semana_libre is
  'Si está encendido, sábado y domingo se marca entrada y salida a cualquier hora (hora de Venezuela).';

-- El panel (solo administradores, por la política config_asis_admin_edita)
-- tiene que poder ver y cambiar los dos interruptores.
grant select (salida_libre, fin_de_semana_libre), update (salida_libre, fin_de_semana_libre)
  on farmacia.config_asistencia to authenticated;

-- ---------------------------------------------------------------------
-- LA REGLA DEL HORARIO, sin reloj de por medio: recibe el momento y la
-- configuración, y dice qué está mal (o nada). Así se puede probar con
-- cualquier día y hora. El día y la hora son los de Venezuela.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_problema_ventana(
  p_tipo text, p_momento timestamptz, p_config farmacia.config_asistencia)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := timezone('America/Caracas', p_momento);
  v_hora  time := v_local::time;
  v_dia   int  := extract(isodow from v_local)::int;      -- 1 lunes … 7 domingo
  v_desde time;
  v_hasta time;
begin
  if p_config.id is null then
    return null;                                          -- sin configuración, no se bloquea
  end if;
  if coalesce(p_config.fin_de_semana_libre, false) and v_dia in (6, 7) then
    return null;
  end if;
  if p_tipo = 'entrada' then
    v_desde := p_config.entrada_desde; v_hasta := p_config.entrada_hasta;
  else
    if coalesce(p_config.salida_libre, false) then
      return null;
    end if;
    v_desde := p_config.salida_desde; v_hasta := p_config.salida_hasta;
  end if;
  if v_hora < v_desde or v_hora > v_hasta then
    return format('Fuera del horario permitido para marcar %s (de %s a %s%s).',
      case when p_tipo = 'entrada' then 'la entrada' else 'la salida' end,
      to_char(v_desde, 'HH12:MI AM'), to_char(v_hasta, 'HH12:MI AM'),
      case when coalesce(p_config.fin_de_semana_libre, false) then ', de lunes a viernes' else '' end);
  end if;
  return null;
end $$;

revoke all on function farmacia.asis_problema_ventana(text, timestamptz, farmacia.config_asistencia) from public, anon, authenticated;

-- El candado que usan las RPC de marcar: el mismo de antes, ahora con la regla nueva.
create or replace function farmacia.asis_verificar_ventana(p_tipo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_config   farmacia.config_asistencia;
  v_problema text;
begin
  select * into v_config from farmacia.config_asistencia where id = 1;
  if not found then
    return;                                               -- sin configuración todavía, no se bloquea nada
  end if;
  v_problema := farmacia.asis_problema_ventana(p_tipo, now(), v_config);
  if v_problema is not null then
    raise exception '%', v_problema;
  end if;
end $$;

revoke all on function farmacia.asis_verificar_ventana(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- LA JORNADA A LA QUE LE TOCA LA SALIDA
-- La de hoy si existe. Si hoy no hay, y la salida es libre, la de ayer que
-- siga abierta y en la que no hayan pasado más de 18 horas desde la entrada.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_registro_para_salida(p_cedula text, p_momento timestamptz)
returns farmacia.asistencia_registros language plpgsql stable security definer set search_path = '' as $$
declare
  v_cedula text := regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g');
  v_hoy    date := (timezone('America/Caracas', p_momento))::date;
  v_fila   farmacia.asistencia_registros;
begin
  select * into v_fila from farmacia.asistencia_registros
   where cedula = v_cedula and fecha = v_hoy;
  if found then
    return v_fila;
  end if;
  if not exists (select 1 from farmacia.config_asistencia where id = 1 and salida_libre) then
    return null;
  end if;
  select * into v_fila from farmacia.asistencia_registros
   where cedula = v_cedula and fecha = v_hoy - 1
     and hora_entrada is not null and hora_salida is null
     and hora_entrada >= p_momento - interval '18 hours';
  if found then
    return v_fila;
  end if;
  return null;
end $$;

revoke all on function farmacia.asis_registro_para_salida(text, timestamptz) from public, anon, authenticated;

-- Lo que la app muestra como "hoy": la jornada de hoy, o la de anoche que
-- todavía se puede cerrar. Misma firma y mismos permisos que antes.
create or replace function farmacia.asis_estado_hoy(p_cedula text)
returns farmacia.asistencia_registros language sql security definer set search_path = '' as $$
  select * from farmacia.asis_registro_para_salida(p_cedula, now()) r where r.id is not null
$$;

-- Marcar la salida: el mismo candado de siempre (horario, entrada previa y
-- GPS), sobre la jornada que le toca. Misma firma y mismos permisos.
create or replace function farmacia.asis_marcar_salida(
  p_cedula text, p_lat double precision default null, p_lng double precision default null,
  p_foto text default null, p_precision double precision default null)
returns farmacia.asistencia_registros language plpgsql security definer set search_path = '' as $$
declare
  v_fila   farmacia.asistencia_registros;
  v_cedula text := regexp_replace(p_cedula, '\D', '', 'g');
  v_sitio  record;
  v_jornada farmacia.asistencia_registros;
begin
  perform farmacia.asis_verificar_ventana('salida');
  -- Se comprueba que exista la entrada ANTES de exigirle el GPS: si no
  -- marcó entrada, el problema no es dónde está parado.
  v_jornada := farmacia.asis_registro_para_salida(v_cedula, now());
  if v_jornada.id is null then
    raise exception 'No hay marca de entrada de hoy para completar la salida.';
  end if;
  select * into v_sitio from farmacia.asis_verificar_sitio('salida', p_lat, p_lng, p_precision);

  update farmacia.asistencia_registros
     set hora_salida = now(), lat_salida = p_lat, lng_salida = p_lng, precision_salida = p_precision,
         sede_salida_id = v_sitio.o_sede_id, distancia_salida = v_sitio.o_distancia,
         dentro_sede_salida = v_sitio.o_dentro, foto_salida = p_foto
   where id = v_jornada.id
  returning * into v_fila;
  return v_fila;
end $$;

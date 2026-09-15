-- =====================================================================
-- 26. CENTRO DE CONTROL (admin.alcaldiadecharallave.com)
-- =====================================================================
-- El panel que vigila todos los sistemas de la Alcaldía necesita saber
-- si la farmacia y la asistencia están TRABAJANDO, no solo si la página
-- abre: cuántas entregas hubo hoy, cuándo fue el último marcaje, cuántos
-- lotes vencidos quedan. Y necesita dos acciones puntuales sobre la
-- asistencia de Salud: ver la lista del personal y restablecer una clave.
--
-- POR QUÉ CON UNA LLAVE PROPIA Y NO CON LA CUENTA DEL ADMINISTRADOR:
-- el panel corre en un servidor (un Worker de Cloudflare). Si se le
-- diera el correo y la clave del administrador de la farmacia, quien
-- llegara a ese servidor podría hacer TODO en la farmacia: tocar el
-- inventario, borrar entregas, ver a todos los pacientes. Con esta llave
-- solo puede hacer tres cosas, las de abajo, y ninguna muestra datos de
-- pacientes.
--
-- La llave NO está en este archivo ni en ningún otro: se genera al
-- publicar el panel, aquí se guarda solo su huella (SHA-256) y la llave
-- en sí queda como secreto cifrado del Worker. De la huella no se puede
-- sacar la llave. Para cambiarla basta con volver a correr el script de
-- publicación del panel (scripts/llave-supabase.mjs).
--
-- Se puede correr entero cuantas veces haga falta.
-- =====================================================================

create table if not exists farmacia.monitor_config (
  id boolean primary key default true check (id),
  token_hash text not null,
  actualizado_en timestamptz not null default now()
);
-- Nadie la lee por la API: ni la clave anónima ni un usuario con sesión.
alter table farmacia.monitor_config enable row level security;
revoke all on farmacia.monitor_config from anon, authenticated;

-- ¿La llave que llega es la buena? Se compara la huella, así que da igual
-- cuánto tarde: medir el tiempo no revela nada de la llave.
create or replace function farmacia.monitor_llave_valida(p_token text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_token) >= 40 and exists (
    select 1 from farmacia.monitor_config c
     where c.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ), false);
$$;
revoke all on function farmacia.monitor_llave_valida(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Resumen de actividad: solo cifras, ningún nombre ni cédula.
-- "Hoy" es el día de Venezuela, no el de Greenwich: a las 8 de la noche
-- en Charallave ya es el día siguiente en UTC.
-- ---------------------------------------------------------------------
create or replace function farmacia.monitor_resumen(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if not farmacia.monitor_llave_valida(p_token) then
    raise exception 'Llave del centro de control no válida.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'hoy', hoy,
    'farmacia', jsonb_build_object(
      'entregas_hoy',   (select count(*) from farmacia.entregas where fecha = hoy and not anulada),
      'entregas_7_dias',(select count(*) from farmacia.entregas where fecha > hoy - 7 and not anulada),
      'ultima_entrega', (select max(creado_en) from farmacia.entregas
                          where origen is distinct from 'migracion_excel'),
      'recipes_hoy',    (select count(*) from farmacia.solicitudes
                          where via = 'recipe' and (creado_en at time zone 'America/Caracas')::date = hoy),
      'pacientes',      (select count(*) from farmacia.pacientes),
      'pacientes_por_revisar', (select count(*) from farmacia.pacientes where estado = 'por_revisar'),
      'lotes_vencidos', (select count(*) from farmacia.v_alertas where tipo = 'vencido'),
      'lotes_por_vencer_30', (select count(*) from farmacia.v_alertas where tipo = 'por_vencer_30')
    ),
    'asistencia_salud', jsonb_build_object(
      'personal_activo', (select count(*) from farmacia.asistencia_personal where activo),
      'sin_cambiar_clave', (select count(*) from farmacia.asistencia_personal
                             where activo and debe_cambiar_clave),
      'entradas_hoy',   (select count(*) from farmacia.asistencia_registros where fecha = hoy),
      'salidas_hoy',    (select count(*) from farmacia.asistencia_registros
                          where fecha = hoy and hora_salida is not null),
      'ultima_marca',   (select max(coalesce(hora_salida, hora_entrada)) from farmacia.asistencia_registros)
    ),
    'asistencia_alcaldia', jsonb_build_object(
      'empleados_activos', (select count(*) from public.empleados where activo),
      'marcajes_hoy',   (select count(*) from public.asistencia_registros where fecha = hoy),
      'ultimo_marcaje', (select max(created_at) from public.asistencia_registros),
      'asistencia_qr_hoy', (select count(*) from public.asistencia_qr where fecha = hoy)
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. La lista del personal de la asistencia de Salud, para poder elegir
-- a quién se le restablece la clave. Sin teléfono ni correo: no hacen
-- falta para eso.
-- ---------------------------------------------------------------------
create or replace function farmacia.monitor_personal_asistencia(p_token text)
returns table (cedula text, nombre text, activo boolean, debe_cambiar_clave boolean, ultima_marca timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not farmacia.monitor_llave_valida(p_token) then
    raise exception 'Llave del centro de control no válida.' using errcode = '42501';
  end if;
  return query
    select p.cedula, p.nombre, p.activo, p.debe_cambiar_clave,
           (select max(coalesce(r.hora_salida, r.hora_entrada))
              from farmacia.asistencia_registros r where r.cedula = p.cedula)
      from farmacia.asistencia_personal p
     order by p.activo desc, p.nombre;
end $$;

-- ---------------------------------------------------------------------
-- 3. Restablecer la clave de una persona. Hace EXACTAMENTE lo mismo que
-- el botón del panel de la farmacia (asis_admin_resetear_clave): pone la
-- clave que se indique y obliga a cambiarla al entrar.
-- ---------------------------------------------------------------------
create or replace function farmacia.monitor_restablecer_clave_asistencia(
  p_token text, p_cedula text, p_clave_nueva text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.monitor_llave_valida(p_token) then
    raise exception 'Llave del centro de control no válida.' using errcode = '42501';
  end if;
  if length(coalesce(p_clave_nueva, '')) < 6 then
    raise exception 'La clave nueva debe tener al menos 6 caracteres.';
  end if;
  update farmacia.asistencia_personal
     set clave_hash = extensions.crypt(p_clave_nueva, extensions.gen_salt('bf')),
         debe_cambiar_clave = true,
         actualizado_en = now()
   where cedula = regexp_replace(p_cedula, '\D', '', 'g');
  return found;
end $$;

-- El Worker llama con la clave anónima; lo que lo autoriza es la llave.
revoke all on function farmacia.monitor_resumen(text) from public;
revoke all on function farmacia.monitor_personal_asistencia(text) from public;
revoke all on function farmacia.monitor_restablecer_clave_asistencia(text, text, text) from public;
grant execute on function farmacia.monitor_resumen(text) to anon;
grant execute on function farmacia.monitor_personal_asistencia(text) to anon;
grant execute on function farmacia.monitor_restablecer_clave_asistencia(text, text, text) to anon;

notify pgrst, 'reload schema';

-- =====================================================================
-- FARMACIA MUNICIPAL · Control de Asistencia (Dirección Salud)
--
-- El personal que marca asistencia NO son necesariamente las mismas
-- cuentas de Despacho/Inventario/Administración: son personas de la
-- Dirección Salud, que entran a la app SOLO con su cédula y una clave
-- (sin correo, sin cuenta de Supabase Auth). Por eso el login va por
-- RPC con verificación de clave server-side (bcrypt), el mismo patrón
-- ya usado y probado en la app de Control de Acceso de la Alcaldía:
-- la clave nunca sale de la base, y la comparación la hace el servidor.
--
-- Se puede correr COMPLETO y VARIAS VECES sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- 1. SEDES  (dónde puede marcar el personal; el admin las administra
--    desde el panel web)
-- =====================================================================
create table if not exists farmacia.sedes (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  latitud       double precision not null,
  longitud      double precision not null,
  radio_metros  integer not null default 15,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

comment on table farmacia.sedes is
  'Sitios donde el personal PUEDE marcar asistencia. Si hay al menos una sede activa y la configuración exige GPS, marcar fuera del radio se rechaza en la base, no en la pantalla.';

-- La sede de la Dirección Salud, con el radio que pidió el usuario.
-- Solo se crea la primera vez: si alguien la mueve o le cambia el radio
-- desde el panel, volver a correr este archivo NO le pisa el cambio.
insert into farmacia.sedes (nombre, latitud, longitud, radio_metros, activo)
select 'Dirección de Salud', 10.237365, -66.859424, 15, true
where not exists (select 1 from farmacia.sedes);

-- =====================================================================
-- 2. CONFIGURACIÓN  (ventanas en las que se puede marcar — candado real)
-- =====================================================================
-- Entrada y salida tienen CADA UNA su propia ventana: no es un solo
-- rango compartido. Fuera de la ventana que corresponda, las RPC de
-- marcar rechazan la marca, sin excepción (pedido explícito del
-- usuario: "de 7 a 8:45am puedan marcar entrada y de 4:30 a 6:30pm
-- puedan marcar la salida... después de ahí no es permitido hacer nada").
create table if not exists farmacia.config_asistencia (
  id               integer primary key default 1 check (id = 1),
  entrada_desde    time not null default '07:00',
  entrada_hasta    time not null default '08:45',
  salida_desde     time not null default '16:30',
  salida_hasta     time not null default '18:30',
  actualizado_en   timestamptz not null default now()
);

-- Candado de sitio. Se agrega aparte para que volver a correr este
-- archivo sobre una base que ya existía no falle.
alter table farmacia.config_asistencia
  add column if not exists exigir_gps              boolean not null default true,
  add column if not exists tolerancia_gps_metros   integer not null default 35,
  add column if not exists precision_maxima_metros integer not null default 100;

comment on column farmacia.config_asistencia.exigir_gps is
  'true = sin ubicación, o estando fuera de la sede, NO se puede marcar. El admin puede apagarlo desde el panel si el GPS de un teléfono da problemas.';
comment on column farmacia.config_asistencia.tolerancia_gps_metros is
  'Metros de gracia que se suman al radio, pero solo hasta donde llegue el margen de error que reporta el propio teléfono. El GPS de un celular rara vez acierta a menos de 10-20 m; con un radio de 15 m y sin esta gracia, gente parada DENTRO de la oficina no podría marcar. Nunca se regala más de lo que el teléfono admite equivocarse.';
comment on column farmacia.config_asistencia.precision_maxima_metros is
  'Si el teléfono dice que su lectura puede estar errada más de estos metros, no se acepta: es una ubicación sacada de la antena o del wifi, no del GPS.';

insert into farmacia.config_asistencia (id, entrada_desde, entrada_hasta, salida_desde, salida_hasta)
values (1, '07:00', '08:45', '16:30', '18:30')
on conflict (id) do update set
  entrada_desde = excluded.entrada_desde,
  entrada_hasta = excluded.entrada_hasta,
  salida_desde  = excluded.salida_desde,
  salida_hasta  = excluded.salida_hasta,
  actualizado_en = now();

comment on column farmacia.config_asistencia.entrada_desde is
  'Antes de esta hora, asis_marcar_entrada rechaza la marca.';
comment on column farmacia.config_asistencia.entrada_hasta is
  'Después de esta hora, ya no se puede marcar entrada. Es un tope real, no solo "llegó tarde".';
comment on column farmacia.config_asistencia.salida_desde is
  'Antes de esta hora, asis_marcar_salida rechaza la marca.';
comment on column farmacia.config_asistencia.salida_hasta is
  'Después de esta hora, ya no se puede marcar salida.';

-- =====================================================================
-- 3. PERSONAL DE ASISTENCIA  (Dirección Salud — login solo por cédula)
-- =====================================================================
create table if not exists farmacia.asistencia_personal (
  cedula              text primary key,
  nombre              text not null,
  telefono            text,
  correo              text,
  clave_hash          text not null,
  debe_cambiar_clave  boolean not null default true,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

alter table farmacia.asistencia_personal
  drop constraint if exists asis_personal_cedula_formato;
alter table farmacia.asistencia_personal
  add constraint asis_personal_cedula_formato check (cedula ~ '^[0-9]{6,9}$');

comment on table farmacia.asistencia_personal is
  'Personal de la Dirección Salud que marca asistencia. Login solo por cédula + clave (sin correo, sin cuenta de Supabase Auth). No se borra: se desactiva.';
comment on column farmacia.asistencia_personal.clave_hash is
  'bcrypt (pgcrypto). Nunca se expone al cliente: las RPC asis_login / asis_cambiar_clave solo devuelven si coincidió o no.';

-- =====================================================================
-- 4. MARCAJE  (una fila por persona por día)
-- =====================================================================
create table if not exists farmacia.asistencia_registros (
  id                    uuid primary key default gen_random_uuid(),
  cedula                text not null references farmacia.asistencia_personal(cedula) on delete cascade,
  fecha                 date not null default (timezone('America/Caracas', now()))::date,

  hora_entrada          timestamptz,
  lat_entrada           double precision,
  lng_entrada           double precision,
  sede_entrada_id       uuid references farmacia.sedes(id),
  dentro_sede_entrada   boolean,
  foto_entrada          text,

  hora_salida           timestamptz,
  lat_salida            double precision,
  lng_salida            double precision,
  sede_salida_id        uuid references farmacia.sedes(id),
  dentro_sede_salida    boolean,
  foto_salida           text,

  dispositivo           text,

  -- Correcciones: el marcaje normal nunca se reescribe (ver el candado
  -- más abajo). Si algo salió mal, el admin corrige desde el panel web
  -- (con su propia cuenta de farmacia.perfiles) y queda anotado aquí.
  nota_correccion       text,
  corregido_por         uuid references farmacia.perfiles(id),
  corregido_en          timestamptz,

  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  unique (cedula, fecha)
);

alter table farmacia.asistencia_registros
  drop constraint if exists asistencia_foto_entrada_tam;
alter table farmacia.asistencia_registros
  add constraint asistencia_foto_entrada_tam check (foto_entrada is null or length(foto_entrada) <= 500000);
alter table farmacia.asistencia_registros
  drop constraint if exists asistencia_foto_salida_tam;
alter table farmacia.asistencia_registros
  add constraint asistencia_foto_salida_tam check (foto_salida is null or length(foto_salida) <= 500000);

-- Cuánto se alejó de la sede y cuánto margen de error traía la lectura.
-- Se guarda para que el admin pueda auditar: "marcó a 8 metros, con el
-- GPS acertando a 12" se lee muy distinto de "marcó a 400 metros".
alter table farmacia.asistencia_registros
  add column if not exists precision_entrada  double precision,
  add column if not exists distancia_entrada  double precision,
  add column if not exists precision_salida   double precision,
  add column if not exists distancia_salida   double precision;

comment on column farmacia.asistencia_registros.precision_entrada is
  'Metros de error que el propio teléfono declaró en esa lectura (accuracy).';
comment on column farmacia.asistencia_registros.distancia_entrada is
  'Metros entre donde marcó y el centro de la sede más cercana.';

create index if not exists ix_asistencia_cedula_fecha on farmacia.asistencia_registros (cedula, fecha desc);
create index if not exists ix_asistencia_fecha         on farmacia.asistencia_registros (fecha desc);

comment on table farmacia.asistencia_registros is
  'Marcaje diario de entrada/salida. Una fila por persona por día; la entrada la crea la propia persona, la salida la completa después. Solo se escribe a través de las RPC asis_marcar_entrada / asis_marcar_salida.';
comment on column farmacia.asistencia_registros.dentro_sede_entrada is
  'NULL = no se pudo confirmar (sin GPS o sin sedes activas). true/false = sí se pudo comparar contra la sede más cercana.';

-- ---------------------------------------------------------------------
-- Distancia en metros entre dos puntos (fórmula haversine).
-- ---------------------------------------------------------------------
create or replace function farmacia.distancia_metros(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision language sql immutable parallel safe as $$
  select 6371000 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  )
$$;

-- ---------------------------------------------------------------------
-- EL CANDADO DE SITIO
--
-- Comprueba que la persona está de verdad en la sede antes de dejarla
-- marcar. Si no lo está, lanza un error y el marcaje NO ocurre: esto vive
-- en la base, así que da igual que alguien modifique la app o llame a la
-- API con curl. Devuelve la sede, los metros de distancia y si quedó
-- dentro, para guardarlo junto al marcaje.
--
-- Por qué no se compara "distancia <= 15" a secas: el GPS de un teléfono
-- no da un punto exacto, da un punto MÁS un margen de error que él mismo
-- declara (10, 20, 30 metros según el cielo, el techo y el aparato). Con
-- un radio de 15 metros y sin tomar en cuenta ese margen, una persona
-- parada dentro de la oficina no podría marcar la mitad de los días. Por
-- eso se acepta cuando es PLAUSIBLE que esté dentro:
--
--     distancia - (margen de error del teléfono) <= radio
--
-- y ese margen se recorta a `tolerancia_gps_metros` para que un teléfono
-- que declare un error enorme no se convierta en barra libre. Además, si
-- el teléfono admite un error mayor que `precision_maxima_metros`, la
-- lectura se rechaza: eso ya no es GPS, es la antena o el wifi.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_verificar_sitio(
  p_tipo text,
  p_lat double precision,
  p_lng double precision,
  p_precision double precision,
  out o_sede_id uuid,
  out o_distancia double precision,
  out o_dentro boolean
) language plpgsql security definer set search_path = '' as $$
declare
  v_config  farmacia.config_asistencia;
  v_radio   integer;
  v_gracia  double precision;
  v_hay_sedes boolean;
begin
  select * into v_config from farmacia.config_asistencia where id = 1;
  select exists (select 1 from farmacia.sedes where activo) into v_hay_sedes;

  -- Sin sedes cargadas no hay contra qué comparar: se deja marcar y se
  -- anota que no se pudo confirmar. Es mejor que dejar a todos afuera.
  if not v_hay_sedes then
    return;
  end if;

  if p_lat is null or p_lng is null then
    if v_config is not null and v_config.exigir_gps then
      raise exception 'No se pudo tomar tu ubicación. Activa el GPS y dale permiso de ubicación a la aplicación.'
        using errcode = 'P0001';
    end if;
    return;
  end if;

  if v_config is not null and v_config.exigir_gps
     and p_precision is not null and p_precision > v_config.precision_maxima_metros then
    raise exception 'La ubicación llegó muy imprecisa (± % metros). Sal a un sitio despejado, espera unos segundos y vuelve a intentar.',
      round(p_precision::numeric) using errcode = 'P0001';
  end if;

  select s.id, farmacia.distancia_metros(p_lat, p_lng, s.latitud, s.longitud), s.radio_metros
    into o_sede_id, o_distancia, v_radio
    from farmacia.sedes s
   where s.activo
   order by farmacia.distancia_metros(p_lat, p_lng, s.latitud, s.longitud) asc
   limit 1;

  v_gracia := least(coalesce(p_precision, 0), coalesce(v_config.tolerancia_gps_metros, 0));
  o_dentro := (o_distancia - v_gracia) <= v_radio;

  if not o_dentro and v_config is not null and v_config.exigir_gps then
    raise exception 'Estás a % metros de la Dirección de Salud. Solo se puede marcar % dentro del sitio.',
      round(o_distancia::numeric),
      case when p_tipo = 'entrada' then 'la entrada' else 'la salida' end
      using errcode = 'P0001';
  end if;
end $$;

comment on function farmacia.asis_verificar_sitio(text, double precision, double precision, double precision) is
  'Candado de sitio del control de asistencia. Lo llaman asis_marcar_entrada y asis_marcar_salida antes de escribir nada.';

-- ---------------------------------------------------------------------
-- Solo mantiene la fecha de modificación. El cálculo de sede y distancia
-- lo hacen las RPC de marcar, que son el ÚNICO camino de escritura (la
-- tabla está cerrada por RLS). Tenerlo en un solo sitio evita que un día
-- el trigger y la RPC digan cosas distintas sobre el mismo marcaje.
-- ---------------------------------------------------------------------
create or replace function farmacia.fn_asistencia_geocerca()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists tr_asistencia_geocerca on farmacia.asistencia_registros;
create trigger tr_asistencia_geocerca
  before insert or update on farmacia.asistencia_registros
  for each row execute function farmacia.fn_asistencia_geocerca();

-- ---------------------------------------------------------------------
-- Candado: una vez marcada la entrada o la salida, esa hora no se puede
-- reescribir salvo que lo haga un administrador (desde el panel web,
-- con su propia cuenta) — ahí sí, porque es una corrección real.
-- ---------------------------------------------------------------------
create or replace function farmacia.fn_asistencia_bloquear_reescritura()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if farmacia.es_admin() then
    return new;
  end if;
  if old.hora_entrada is not null and new.hora_entrada is distinct from old.hora_entrada then
    raise exception 'La hora de entrada ya fue marcada y no se puede modificar.';
  end if;
  if old.hora_salida is not null and new.hora_salida is distinct from old.hora_salida then
    raise exception 'La hora de salida ya fue marcada y no se puede modificar.';
  end if;
  return new;
end $$;

drop trigger if exists tr_asistencia_bloqueo on farmacia.asistencia_registros;
create trigger tr_asistencia_bloqueo
  before update on farmacia.asistencia_registros
  for each row execute function farmacia.fn_asistencia_bloquear_reescritura();

-- Bitácora automática (misma función genérica que usa el resto del sistema).
drop trigger if exists tr_bitacora_asistencia_registros on farmacia.asistencia_registros;
create trigger tr_bitacora_asistencia_registros
  after insert or update on farmacia.asistencia_registros
  for each row execute function farmacia.fn_bitacora();

drop trigger if exists tr_bitacora_sedes on farmacia.sedes;
create trigger tr_bitacora_sedes
  after insert or update on farmacia.sedes
  for each row execute function farmacia.fn_bitacora();

-- =====================================================================
-- 5. RPC — lo único que la app de Android puede tocar. La app llama con
--    la clave pública (anon), sin sesión de Supabase Auth: por eso todo
--    el acceso de la Dirección Salud pasa por estas funciones, nunca
--    directo a las tablas (las tablas quedan cerradas más abajo).
-- =====================================================================

-- Login: compara con bcrypt. Nunca devuelve clave_hash.
create or replace function farmacia.asis_login(p_cedula text, p_clave text)
returns table(cedula text, nombre text, telefono text, correo text, debe_cambiar_clave boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_fila farmacia.asistencia_personal;
begin
  select * into v_fila from farmacia.asistencia_personal ap
   where ap.cedula = regexp_replace(p_cedula, '\D', '', 'g') and ap.activo;
  if not found then
    return;
  end if;
  if v_fila.clave_hash <> extensions.crypt(p_clave, v_fila.clave_hash) then
    return;
  end if;
  return query select v_fila.cedula, v_fila.nombre, v_fila.telefono, v_fila.correo, v_fila.debe_cambiar_clave;
end $$;

comment on function farmacia.asis_login is
  'Login del personal de Dirección Salud. Devuelve una fila si la cédula y la clave coinciden, ninguna si no.';

-- Cambio de clave obligatorio en el primer ingreso (o cuando quieran cambiarla).
-- Devuelve una fila con ok=true/false en vez de un booleano suelto, para
-- que el cliente lo decodifique igual que cualquier otra RPC (una lista).
create or replace function farmacia.asis_cambiar_clave(p_cedula text, p_clave_actual text, p_clave_nueva text)
returns table(ok boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_fila farmacia.asistencia_personal;
  v_cedula text := regexp_replace(p_cedula, '\D', '', 'g');
begin
  if length(p_clave_nueva) < 6 then
    raise exception 'La clave nueva debe tener al menos 6 caracteres.';
  end if;
  select * into v_fila from farmacia.asistencia_personal ap where ap.cedula = v_cedula and ap.activo;
  if not found then
    return query select false;
    return;
  end if;
  if v_fila.clave_hash <> extensions.crypt(p_clave_actual, v_fila.clave_hash) then
    return query select false;
    return;
  end if;
  update farmacia.asistencia_personal
     set clave_hash = extensions.crypt(p_clave_nueva, extensions.gen_salt('bf')),
         debe_cambiar_clave = false,
         actualizado_en = now()
   where cedula = v_cedula;
  return query select true;
end $$;

-- Candado de horario: cada tipo de marca tiene su propia ventana.
-- p_tipo = 'entrada' | 'salida'. Lo comprueban las dos RPC de marcar
-- antes de tocar la tabla.
create or replace function farmacia.asis_verificar_ventana(p_tipo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_config farmacia.config_asistencia;
  v_hora   time := (timezone('America/Caracas', now()))::time;
  v_desde  time;
  v_hasta  time;
begin
  select * into v_config from farmacia.config_asistencia where id = 1;
  if v_config is null then
    return; -- sin configuración todavía, no se bloquea nada
  end if;
  if p_tipo = 'entrada' then
    v_desde := v_config.entrada_desde; v_hasta := v_config.entrada_hasta;
  else
    v_desde := v_config.salida_desde; v_hasta := v_config.salida_hasta;
  end if;
  if v_hora < v_desde or v_hora > v_hasta then
    raise exception 'Fuera del horario permitido para marcar % (de % a %).',
      case when p_tipo = 'entrada' then 'la entrada' else 'la salida' end,
      to_char(v_desde, 'HH12:MI AM'), to_char(v_hasta, 'HH12:MI AM');
  end if;
end $$;

-- Marcar entrada. Falla si la cédula no está activa, si ya marcó hoy, o
-- si está fuera del horario permitido.
-- Estas dos ganaron el parámetro p_precision. Si quedara también la
-- versión sin él, PostgREST no sabría a cuál llamar y devolvería un error
-- de función ambigua. Por eso se borra la firma vieja antes.
drop function if exists farmacia.asis_marcar_entrada(text, double precision, double precision, text, text);
drop function if exists farmacia.asis_marcar_salida(text, double precision, double precision, text);

create or replace function farmacia.asis_marcar_entrada(
  p_cedula text, p_lat double precision default null, p_lng double precision default null,
  p_foto text default null, p_dispositivo text default null,
  p_precision double precision default null
) returns farmacia.asistencia_registros
language plpgsql security definer set search_path = '' as $$
declare
  v_fila   farmacia.asistencia_registros;
  v_cedula text := regexp_replace(p_cedula, '\D', '', 'g');
  v_sitio  record;
begin
  perform farmacia.asis_verificar_ventana('entrada');
  if not exists (select 1 from farmacia.asistencia_personal where cedula = v_cedula and activo) then
    raise exception 'Cédula no autorizada.';
  end if;
  -- Si no está en la sede, esto lanza el error y no se escribe nada.
  select * into v_sitio from farmacia.asis_verificar_sitio('entrada', p_lat, p_lng, p_precision);

  insert into farmacia.asistencia_registros (
    cedula, fecha, hora_entrada, lat_entrada, lng_entrada, precision_entrada,
    sede_entrada_id, distancia_entrada, dentro_sede_entrada, foto_entrada, dispositivo)
  values (
    v_cedula, (timezone('America/Caracas', now()))::date, now(), p_lat, p_lng, p_precision,
    v_sitio.o_sede_id, v_sitio.o_distancia, v_sitio.o_dentro, p_foto, p_dispositivo)
  returning * into v_fila;
  return v_fila;
end $$;

-- Marcar salida del día. Falla si no hay marca de entrada de hoy, o si
-- está fuera del horario permitido.
create or replace function farmacia.asis_marcar_salida(
  p_cedula text, p_lat double precision default null, p_lng double precision default null,
  p_foto text default null,
  p_precision double precision default null
) returns farmacia.asistencia_registros
language plpgsql security definer set search_path = '' as $$
declare
  v_fila   farmacia.asistencia_registros;
  v_cedula text := regexp_replace(p_cedula, '\D', '', 'g');
  v_sitio  record;
begin
  perform farmacia.asis_verificar_ventana('salida');
  -- Se comprueba que exista la entrada ANTES de exigirle el GPS: si no
  -- marcó entrada, el problema no es dónde está parado.
  if not exists (
    select 1 from farmacia.asistencia_registros
     where cedula = v_cedula and fecha = (timezone('America/Caracas', now()))::date
  ) then
    raise exception 'No hay marca de entrada de hoy para completar la salida.';
  end if;
  select * into v_sitio from farmacia.asis_verificar_sitio('salida', p_lat, p_lng, p_precision);

  update farmacia.asistencia_registros
     set hora_salida = now(), lat_salida = p_lat, lng_salida = p_lng, precision_salida = p_precision,
         sede_salida_id = v_sitio.o_sede_id, distancia_salida = v_sitio.o_distancia,
         dentro_sede_salida = v_sitio.o_dentro, foto_salida = p_foto
   where cedula = v_cedula and fecha = (timezone('America/Caracas', now()))::date
  returning * into v_fila;
  return v_fila;
end $$;

create or replace function farmacia.asis_estado_hoy(p_cedula text)
returns farmacia.asistencia_registros
language sql security definer set search_path = '' as $$
  select * from farmacia.asistencia_registros
   where cedula = regexp_replace(p_cedula, '\D', '', 'g')
     and fecha = (timezone('America/Caracas', now()))::date
$$;

create or replace function farmacia.asis_historial(p_cedula text, p_limite integer default 60)
returns setof farmacia.asistencia_registros
language sql security definer set search_path = '' as $$
  select * from farmacia.asistencia_registros
   where cedula = regexp_replace(p_cedula, '\D', '', 'g')
   order by fecha desc
   limit p_limite
$$;

create or replace function farmacia.asis_sedes_activas()
returns setof farmacia.sedes
language sql security definer set search_path = '' as $$
  select * from farmacia.sedes where activo
$$;

-- ---------------------------------------------------------------------
-- "¿Puedo marcar desde aquí?" — sin escribir nada.
--
-- La app la llama mientras el GPS se va afinando, para poder decir "estás
-- a 40 metros, acércate" ANTES de que la persona toque el botón, en vez
-- de dejarla apretar y darle un error. La respuesta la calcula la MISMA
-- función que después decide de verdad, así que no pueden discrepar.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_donde_estoy(
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision double precision default null
) returns table (
  puede         boolean,
  motivo        text,
  distancia     double precision,
  radio_metros  integer,
  sede_nombre   text,
  exige_gps     boolean
) language plpgsql security definer set search_path = '' as $$
declare
  v_config farmacia.config_asistencia;
  v_sitio  record;
begin
  select * into v_config from farmacia.config_asistencia where id = 1;
  exige_gps := coalesce(v_config.exigir_gps, false);

  select s.nombre, s.radio_metros into sede_nombre, radio_metros
    from farmacia.sedes s where s.activo
    order by s.creado_en limit 1;

  begin
    select * into v_sitio from farmacia.asis_verificar_sitio('entrada', p_lat, p_lng, p_precision);
    distancia := v_sitio.o_distancia;
    puede := true;
    motivo := case
      when v_sitio.o_distancia is null then 'No hay sede cargada: se puede marcar desde donde sea.'
      else 'Estás a ' || round(v_sitio.o_distancia::numeric) || ' m de ' || coalesce(sede_nombre, 'la sede') || '.'
    end;
  exception when others then
    puede := false;
    motivo := SQLERRM;
    if p_lat is not null and p_lng is not null then
      select farmacia.distancia_metros(p_lat, p_lng, s.latitud, s.longitud)
        into distancia
        from farmacia.sedes s where s.activo
        order by farmacia.distancia_metros(p_lat, p_lng, s.latitud, s.longitud) asc limit 1;
    end if;
  end;
  return next;
end $$;

-- ---------------------------------------------------------------------
-- RPC de administración (estas SÍ exigen sesión real de admin — las usa
-- el panel web, no la app de la Dirección Salud). Existen porque la
-- clave va hasheada: un UPDATE/INSERT normal por REST no puede calcular
-- bcrypt, así que crear a alguien o resetearle la clave pasa por aquí.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_admin_crear_personal(
  p_cedula text, p_nombre text, p_telefono text, p_correo text, p_clave_inicial text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.es_admin() then
    raise exception 'Solo un administrador puede crear personal de asistencia.';
  end if;
  if length(p_clave_inicial) < 6 then
    raise exception 'La clave inicial debe tener al menos 6 caracteres.';
  end if;
  insert into farmacia.asistencia_personal (cedula, nombre, telefono, correo, clave_hash, debe_cambiar_clave, activo)
  values (regexp_replace(p_cedula, '\D', '', 'g'), p_nombre, p_telefono, p_correo,
          extensions.crypt(p_clave_inicial, extensions.gen_salt('bf')), true, true)
  on conflict (cedula) do update set
    nombre = excluded.nombre, telefono = excluded.telefono, correo = excluded.correo,
    activo = true, actualizado_en = now();
  return true;
end $$;

create or replace function farmacia.asis_admin_resetear_clave(p_cedula text, p_clave_nueva text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not farmacia.es_admin() then
    raise exception 'Solo un administrador puede restablecer esta clave.';
  end if;
  if length(p_clave_nueva) < 6 then
    raise exception 'La clave nueva debe tener al menos 6 caracteres.';
  end if;
  update farmacia.asistencia_personal
     set clave_hash = extensions.crypt(p_clave_nueva, extensions.gen_salt('bf')),
         debe_cambiar_clave = true,
         actualizado_en = now()
   where cedula = regexp_replace(p_cedula, '\D', '', 'g');
  return found;
end $$;

-- =====================================================================
-- 6. VISTA para el panel admin (con sesión real de farmacia.perfiles).
-- =====================================================================
-- Se recrea desde cero: si ya existía con menos columnas, un
-- "create or replace view" con columnas nuevas en medio falla.
drop view if exists farmacia.v_asistencia;
create view farmacia.v_asistencia as
select
  r.id, r.cedula, r.fecha,
  p.nombre as empleado_nombre, p.telefono as empleado_telefono, p.correo as empleado_correo,
  r.hora_entrada, r.lat_entrada, r.lng_entrada, r.dentro_sede_entrada, se.nombre as sede_entrada_nombre,
  round(r.distancia_entrada::numeric, 1) as distancia_entrada_m,
  round(r.precision_entrada::numeric, 1) as precision_entrada_m,
  r.hora_salida, r.lat_salida, r.lng_salida, r.dentro_sede_salida, ss.nombre as sede_salida_nombre,
  round(r.distancia_salida::numeric, 1) as distancia_salida_m,
  round(r.precision_salida::numeric, 1) as precision_salida_m,
  (r.foto_entrada is not null) as tiene_foto_entrada,
  (r.foto_salida is not null) as tiene_foto_salida,
  r.dispositivo, r.nota_correccion, r.corregido_por, r.corregido_en,
  r.creado_en, r.actualizado_en
from farmacia.asistencia_registros r
join farmacia.asistencia_personal p on p.cedula = r.cedula
left join farmacia.sedes se on se.id = r.sede_entrada_id
left join farmacia.sedes ss on ss.id = r.sede_salida_id;

alter view farmacia.v_asistencia set (security_invoker = true);

-- =====================================================================
-- 7. PERMISOS (RLS)
--
-- Las tablas quedan CERRADAS: ni siquiera con la clave anon se puede
-- leer o escribir directo (eso protegería mal — expondría clave_hash
-- y dejaría marcar asistencia a nombre de cualquiera). Todo el acceso
-- de la Dirección Salud pasa por las RPC de arriba, que corren con
-- privilegios propios (SECURITY DEFINER) y sí pueden tocar las tablas
-- aunque RLS las cierre para todos los demás.
--
-- El panel web SÍ entra directo a las tablas, pero solo si es admin
-- (con su cuenta real de farmacia.perfiles).
-- =====================================================================
alter table farmacia.sedes                 enable row level security;
alter table farmacia.config_asistencia     enable row level security;
alter table farmacia.asistencia_personal   enable row level security;
alter table farmacia.asistencia_registros  enable row level security;

-- ---------- sedes: cualquier operador de farmacia las ve; solo el admin las crea/edita ----------
drop policy if exists sedes_ver on farmacia.sedes;
create policy sedes_ver on farmacia.sedes for select to authenticated
  using (farmacia.mi_rol() is not null);

drop policy if exists sedes_admin_crea on farmacia.sedes;
create policy sedes_admin_crea on farmacia.sedes for insert to authenticated
  with check (farmacia.es_admin());

drop policy if exists sedes_admin_edita on farmacia.sedes;
create policy sedes_admin_edita on farmacia.sedes for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

-- ---------- configuración: igual, la ve todo el mundo, la edita solo el admin ----------
drop policy if exists config_asis_ver on farmacia.config_asistencia;
create policy config_asis_ver on farmacia.config_asistencia for select to authenticated
  using (farmacia.mi_rol() is not null);

drop policy if exists config_asis_admin_edita on farmacia.config_asistencia;
create policy config_asis_admin_edita on farmacia.config_asistencia for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

-- ---------- personal de asistencia: SOLO el admin, directo (contiene clave_hash) ----------
drop policy if exists asis_personal_admin_ve on farmacia.asistencia_personal;
create policy asis_personal_admin_ve on farmacia.asistencia_personal for select to authenticated
  using (farmacia.es_admin());

drop policy if exists asis_personal_admin_crea on farmacia.asistencia_personal;
create policy asis_personal_admin_crea on farmacia.asistencia_personal for insert to authenticated
  with check (farmacia.es_admin());

drop policy if exists asis_personal_admin_edita on farmacia.asistencia_personal;
create policy asis_personal_admin_edita on farmacia.asistencia_personal for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

-- ---------- marcaje: SOLO el admin, directo. La Dirección Salud entra por las RPC. ----------
drop policy if exists asistencia_admin_ve on farmacia.asistencia_registros;
create policy asistencia_admin_ve on farmacia.asistencia_registros for select to authenticated
  using (farmacia.es_admin());

drop policy if exists asistencia_admin_edita on farmacia.asistencia_registros;
create policy asistencia_admin_edita on farmacia.asistencia_registros for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

-- Nadie borra nada directo (ni con RPC: no existe una asis_borrar_*).
revoke delete on farmacia.sedes                from authenticated;
revoke delete on farmacia.config_asistencia    from authenticated;
revoke delete on farmacia.asistencia_personal  from authenticated;
revoke delete on farmacia.asistencia_registros from authenticated;

-- ---------------------------------------------------------------------
-- Qué puede llamar la APP de la Dirección Salud.
--
-- La app entra con la clave pública (rol `anon`): no usa cuentas de
-- Supabase, la persona entra con su cédula. Por eso hay que darle permiso
-- de EJECUTAR exactamente estas funciones, ni una más. Las tablas siguen
-- cerradas por RLS, así que la única puerta es esta lista.
--
-- Se quitan primero los permisos de PUBLIC, que Postgres regala solo a
-- toda función nueva: si no, `asis_verificar_sitio` o las funciones de
-- administrador quedarían al alcance de cualquiera con la clave pública.
-- ---------------------------------------------------------------------
grant usage on schema farmacia to anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'farmacia' and p.proname like 'asis\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;

grant execute on function farmacia.asis_login(text, text)                                           to anon, authenticated;
grant execute on function farmacia.asis_cambiar_clave(text, text, text)                             to anon, authenticated;
grant execute on function farmacia.asis_marcar_entrada(text, double precision, double precision, text, text, double precision) to anon, authenticated;
grant execute on function farmacia.asis_marcar_salida(text, double precision, double precision, text, double precision)        to anon, authenticated;
grant execute on function farmacia.asis_estado_hoy(text)                                            to anon, authenticated;
grant execute on function farmacia.asis_historial(text, integer)                                    to anon, authenticated;
grant execute on function farmacia.asis_sedes_activas()                                             to anon, authenticated;
grant execute on function farmacia.asis_donde_estoy(double precision, double precision, double precision) to anon, authenticated;

-- Las de administración NO las toca la app: solo el panel web, con una
-- sesión real de farmacia.perfiles.
grant execute on function farmacia.asis_admin_crear_personal(text, text, text, text, text) to authenticated;
grant execute on function farmacia.asis_admin_resetear_clave(text, text)                   to authenticated;

-- =====================================================================
-- 8. Tiempo real (para que el panel admin vea los marcajes en vivo)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'farmacia' and tablename = 'asistencia_registros')
  then
    alter publication supabase_realtime add table farmacia.asistencia_registros;
  end if;
end $$;

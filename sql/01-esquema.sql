-- =====================================================================
-- FARMACIA MUNICIPAL · Alcaldía del Municipio Bolivariano Cristóbal Rojas
-- Etapa 1: esquema, permisos y bitácora.
--
-- Se puede correr COMPLETO y VARIAS VECES sin romper nada.
-- Pegar en Supabase → SQL Editor, o mandar por la API de administración.
-- =====================================================================

create schema if not exists farmacia;
grant usage on schema farmacia to anon, authenticated, service_role;

-- Quitar acentos dentro de un índice exige una función IMMUTABLE.
-- unaccent() de fábrica es STABLE (depende del diccionario), así que
-- Postgres no la acepta en un índice. Este envoltorio lo resuelve.
create extension if not exists unaccent with schema extensions;

create or replace function farmacia.sin_acentos(texto text)
returns text language sql immutable strict parallel safe as $$
  select extensions.unaccent('extensions.unaccent', texto)
$$;

-- =====================================================================
-- 1. PERFILES  (quién entra y con qué permisos)
-- =====================================================================
-- Los usuarios NO se borran nunca: se desactivan. Borrarlos dejaría
-- entregas sin dueño y rompería el rastro de quién hizo qué.

create table if not exists farmacia.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  correo         text,
  nombre         text not null default 'Sin nombre',
  rol            text not null default 'despacho',
  activo         boolean not null default false,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table farmacia.perfiles drop constraint if exists perfiles_rol_valido;
alter table farmacia.perfiles add  constraint perfiles_rol_valido
  check (rol in ('admin','inventario','despacho'));

create index if not exists ix_perfiles_activos on farmacia.perfiles (rol) where activo;

comment on table  farmacia.perfiles is 'Usuarios del sistema. No se borran: se desactivan.';
comment on column farmacia.perfiles.activo is 'Nace en false: el administrador debe habilitarlo.';

-- Todo usuario nuevo nace DESACTIVADO y con el rol más bajo.
-- El rol jamás sale del metadata del registro: ese metadata lo escribe
-- el propio navegador, y cualquiera podría pedir "rol: admin".
create or replace function farmacia.fn_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into farmacia.perfiles (id, correo, nombre, rol, activo)
  values (new.id, new.email, coalesce(split_part(new.email,'@',1),'Sin nombre'), 'despacho', false)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists tr_perfil_nuevo_usuario on auth.users;
create trigger tr_perfil_nuevo_usuario
  after insert on auth.users
  for each row execute function farmacia.fn_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- Rol del usuario que llama.
-- SECURITY DEFINER + search_path vacío: corre como el dueño de la tabla,
-- que NO pasa por las políticas. Sin esto, una política sobre perfiles
-- que consulte perfiles se muerde la cola (error 42P17, recursión infinita).
-- Devuelve NULL si el usuario está desactivado → queda fuera al instante,
-- sin esperar a que caduque su token.
-- ---------------------------------------------------------------------
create or replace function farmacia.mi_rol()
returns text language sql stable security definer set search_path = '' as $$
  select p.rol from farmacia.perfiles p
   where p.id = auth.uid() and p.activo
$$;

create or replace function farmacia.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(farmacia.mi_rol() = 'admin', false)
$$;

create or replace function farmacia.mi_nombre()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(p.nombre, p.correo, 'Desconocido') from farmacia.perfiles p
   where p.id = auth.uid()
$$;

-- =====================================================================
-- 2. BITÁCORA  (todo lo que se hace queda registrado)
-- =====================================================================
-- Es de solo lectura para TODOS, incluido el administrador.
-- No hay política de UPDATE ni de DELETE: no es un olvido, es el punto.

create table if not exists farmacia.bitacora (
  id            bigserial primary key,
  momento       timestamptz not null default now(),
  usuario_id    uuid,
  usuario_nombre text,
  usuario_rol   text,
  tabla         text not null,
  operacion     text not null,
  registro_id   text,
  antes         jsonb,
  despues       jsonb,
  campos        text[],
  nota          text
);

create index if not exists ix_bitacora_momento on farmacia.bitacora (momento desc);
create index if not exists ix_bitacora_usuario on farmacia.bitacora (usuario_id, momento desc);
create index if not exists ix_bitacora_tabla   on farmacia.bitacora (tabla, momento desc);

comment on table farmacia.bitacora is
  'Registro inmutable de todo lo que se hace. Nadie puede editarla ni borrarla.';

-- Campos que NUNCA se copian a la bitácora: se anota QUE cambiaron, no su contenido.
create or replace function farmacia.fn_ocultar_sensibles(datos jsonb)
returns jsonb language sql immutable as $$
  select coalesce(datos,'{}'::jsonb) - 'clave' - 'password' - 'token' - 'observaciones_clinicas'
$$;

create or replace function farmacia.fn_bitacora()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb; v_despues jsonb; v_campos text[]; v_id text;
begin
  if tg_op = 'INSERT' then
    v_despues := farmacia.fn_ocultar_sensibles(to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    v_antes   := farmacia.fn_ocultar_sensibles(to_jsonb(old));
    v_despues := farmacia.fn_ocultar_sensibles(to_jsonb(new));
    -- solo los campos que de verdad cambiaron, para que la bitácora se pueda leer
    select array_agg(k) into v_campos
      from jsonb_each(v_despues) e(k,v)
     where v_antes -> k is distinct from v;
  else
    v_antes := farmacia.fn_ocultar_sensibles(to_jsonb(old));
  end if;

  v_id := coalesce(v_despues ->> 'id', v_antes ->> 'id');

  insert into farmacia.bitacora
    (usuario_id, usuario_nombre, usuario_rol, tabla, operacion, registro_id, antes, despues, campos)
  values
    (auth.uid(), farmacia.mi_nombre(), farmacia.mi_rol(),
     tg_table_name, tg_op, v_id, v_antes, v_despues, v_campos);

  return coalesce(new, old);
end $$;

-- Nadie borra ni edita la bitácora, ni siquiera con permisos de tabla.
create or replace function farmacia.fn_bitacora_intocable()
returns trigger language plpgsql as $$
begin
  raise exception 'La bitácora no se puede modificar ni borrar.';
end $$;

drop trigger if exists tr_bitacora_intocable on farmacia.bitacora;
create trigger tr_bitacora_intocable
  before update or delete on farmacia.bitacora
  for each row execute function farmacia.fn_bitacora_intocable();

-- =====================================================================
-- 3. CATÁLOGO: productos y lotes
-- =====================================================================

create table if not exists farmacia.productos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  dosificacion  text,
  presentacion  text,
  categoria     text not null default 'medicamento',
  unidad        text default 'unidad',
  stock_minimo  integer not null default 0,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

alter table farmacia.productos drop constraint if exists productos_categoria_valida;
alter table farmacia.productos add  constraint productos_categoria_valida
  check (categoria in ('medicamento','insumo','material_medico_quirurgico','otro'));

-- Un producto es nombre + dosificación + presentación. Sin acentos ni
-- mayúsculas para que "ÁCIDO VALPRÓICO" y "ACIDO VALPROICO" no se dupliquen.
create unique index if not exists ux_producto_identidad on farmacia.productos (
  lower(farmacia.sin_acentos(nombre)),
  lower(coalesce(farmacia.sin_acentos(dosificacion),'')),
  lower(coalesce(farmacia.sin_acentos(presentacion),''))
);

comment on column farmacia.productos.stock_minimo is
  'Por debajo de esto, el sistema avisa. 0 = sin alerta.';

-- ---------------------------------------------------------------------
-- LOTES.  El código de lote NO es único: se comprobó que el mismo código
-- corresponde a medicamentos distintos (SL-192 es ALOPURINOL en un archivo
-- y ALENDRONATO en otro). Por eso la identidad es producto + código + vence.
-- ---------------------------------------------------------------------
create table if not exists farmacia.lotes (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references farmacia.productos(id) on delete restrict,
  codigo        text,
  vence         date,
  estado        text not null default 'disponible',
  nota          text,
  creado_en     timestamptz not null default now(),
  creado_por    uuid,
  creado_por_nombre text
);

alter table farmacia.lotes drop constraint if exists lotes_estado_valido;
alter table farmacia.lotes add  constraint lotes_estado_valido
  check (estado in ('disponible','dado_de_baja'));

create unique index if not exists ux_lote_identidad on farmacia.lotes (
  producto_id, lower(coalesce(codigo,'')), coalesce(vence, '9999-12-31'::date)
);
create index if not exists ix_lotes_vence on farmacia.lotes (vence) where estado = 'disponible';

comment on column farmacia.lotes.vence is
  'Puede quedar vacío: hay lotes del Excel sin fecha. Sin fecha no se puede aplicar FEFO.';

-- =====================================================================
-- 4. PACIENTES E INSTITUCIONES
-- =====================================================================

create table if not exists farmacia.pacientes (
  id            uuid primary key default gen_random_uuid(),
  nacionalidad  text,
  cedula        text,
  cedula_cruda  text,
  nombre        text not null,
  sexo          text,
  fecha_nac     date,
  telefono      text,
  direccion     text,
  estado        text not null default 'activo',
  motivo_revision text,
  origen_fila   text,
  creado_en     timestamptz not null default now()
);

alter table farmacia.pacientes drop constraint if exists pacientes_estado_valido;
alter table farmacia.pacientes add  constraint pacientes_estado_valido
  check (estado in ('activo','por_revisar','inactivo'));

alter table farmacia.pacientes drop constraint if exists pacientes_nacionalidad_valida;
alter table farmacia.pacientes add  constraint pacientes_nacionalidad_valida
  check (nacionalidad is null or nacionalidad in ('V','E'));

-- La cédula NO es clave: viene sucia y repetida del Excel.
-- Único solo cuando es válida y el paciente no está marcado para revisar.
-- OJO: se aceptan 6 dígitos. Las cédulas de 6 son legítimas — corresponden
-- a personas nacidas entre 1930 y 1949. Exigir 7 dejaría fuera a 16 abuelos.
create unique index if not exists ux_paciente_cedula
  on farmacia.pacientes (nacionalidad, cedula)
  where cedula ~ '^[0-9]{6,9}$' and estado <> 'por_revisar';

create index if not exists ix_pacientes_nombre on farmacia.pacientes
  using gin (to_tsvector('spanish', nombre));
create index if not exists ix_pacientes_cedula on farmacia.pacientes (cedula);
create index if not exists ix_pacientes_revisar on farmacia.pacientes (estado) where estado = 'por_revisar';

comment on column farmacia.pacientes.cedula_cruda is
  'La cédula tal como venía escrita en el Excel. Nunca se corrige sola: se conserva para auditar.';

create table if not exists farmacia.tratamientos_paciente (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references farmacia.pacientes(id) on delete cascade,
  producto_id   uuid references farmacia.productos(id) on delete set null,
  texto_original text,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
create index if not exists ix_tratamientos_paciente on farmacia.tratamientos_paciente (paciente_id);

comment on column farmacia.tratamientos_paciente.texto_original is
  'El renglón tal como estaba en el Excel. El "/" es ambiguo (va dentro de "0,5MG/ML"), así que
   cuando no se pudo enlazar con un producto queda el texto para que un humano lo resuelva.';

-- Centros a los que también se despacha: CDI, ambulatorios, consultorios.
create table if not exists farmacia.instituciones (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  tipo          text not null default 'CDI',
  direccion     text,
  responsable   text,
  telefono      text,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
create unique index if not exists ux_institucion_nombre
  on farmacia.instituciones (lower(farmacia.sin_acentos(nombre)));

-- =====================================================================
-- 5. MOVIMIENTOS  (la existencia sale de aquí, no se escribe a mano)
-- =====================================================================

create table if not exists farmacia.movimientos (
  id            uuid primary key default gen_random_uuid(),
  lote_id       uuid not null references farmacia.lotes(id) on delete restrict,
  tipo          text not null,
  cantidad      numeric(12,2) not null,
  motivo        text,
  entrega_id    uuid,
  anula_a       uuid references farmacia.movimientos(id),
  origen        text not null default 'sistema',
  momento       timestamptz not null default now(),
  hecho_por     uuid,
  hecho_por_nombre text,
  hecho_por_rol text
);

alter table farmacia.movimientos drop constraint if exists movimientos_tipo_valido;
alter table farmacia.movimientos add  constraint movimientos_tipo_valido
  check (tipo in ('entrada','salida','ajuste','baja'));

alter table farmacia.movimientos drop constraint if exists movimientos_cantidad_no_cero;
alter table farmacia.movimientos add  constraint movimientos_cantidad_no_cero
  check (cantidad <> 0);

-- Las entradas suman, las salidas y bajas restan, el ajuste puede ir en cualquier sentido.
alter table farmacia.movimientos drop constraint if exists movimientos_signo_coherente;
alter table farmacia.movimientos add  constraint movimientos_signo_coherente
  check (
    (tipo = 'entrada' and cantidad > 0) or
    (tipo in ('salida','baja') and cantidad < 0) or
    (tipo = 'ajuste')
  );

alter table farmacia.movimientos drop constraint if exists movimientos_origen_valido;
alter table farmacia.movimientos add  constraint movimientos_origen_valido
  check (origen in ('sistema','migracion_excel'));

-- Un movimiento del sistema SIEMPRE tiene autor; uno migrado NUNCA lo tiene.
-- Así no se puede fingir que alguien hizo algo que no hizo.
alter table farmacia.movimientos drop constraint if exists movimientos_autor_coherente;
alter table farmacia.movimientos add  constraint movimientos_autor_coherente
  check (
    (origen = 'sistema'         and hecho_por is not null) or
    (origen = 'migracion_excel' and hecho_por is null)
  );

create index if not exists ix_mov_lote    on farmacia.movimientos (lote_id);
create index if not exists ix_mov_momento on farmacia.movimientos (momento desc);
create index if not exists ix_mov_entrega on farmacia.movimientos (entrega_id);

-- ---------------------------------------------------------------------
-- Existencia por lote y por producto: SIEMPRE calculada.
-- ---------------------------------------------------------------------
create or replace view farmacia.v_existencia_lote as
select l.id            as lote_id,
       l.producto_id,
       p.nombre        as producto,
       p.dosificacion,
       p.presentacion,
       p.categoria,
       l.codigo        as lote,
       l.vence,
       l.estado,
       coalesce(sum(m.cantidad), 0) as existencia,
       case
         when l.estado = 'dado_de_baja'          then 'dado_de_baja'
         when l.vence is null                     then 'sin_fecha'
         when l.vence <  current_date             then 'vencido'
         when l.vence <= current_date + 30        then 'por_vencer_30'
         when l.vence <= current_date + 90        then 'por_vencer_90'
         else 'vigente'
       end as situacion
  from farmacia.lotes l
  join farmacia.productos p on p.id = l.producto_id
  left join farmacia.movimientos m on m.lote_id = l.id
 group by l.id, l.producto_id, p.nombre, p.dosificacion, p.presentacion,
          p.categoria, l.codigo, l.vence, l.estado;

create or replace view farmacia.v_existencia_producto as
select producto_id, producto, dosificacion, presentacion, categoria,
       sum(existencia) filter (where situacion in ('vigente','por_vencer_30','por_vencer_90','sin_fecha')) as disponible,
       sum(existencia) filter (where situacion = 'vencido')      as vencido,
       sum(existencia)                                            as total,
       min(vence) filter (where situacion <> 'vencido' and vence is not null) as vence_primero
  from farmacia.v_existencia_lote
 where estado = 'disponible'
 group by producto_id, producto, dosificacion, presentacion, categoria;

-- ---------------------------------------------------------------------
-- LOS DOS CANDADOS. Van en la base, no en la pantalla: la pantalla se salta.
-- ---------------------------------------------------------------------
create or replace function farmacia.fn_guardar_movimiento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_vence date; v_estado text; v_saldo numeric;
begin
  select l.vence, l.estado into v_vence, v_estado
    from farmacia.lotes l where l.id = new.lote_id;

  -- 1) No se despacha de un lote vencido ni dado de baja.
  if new.tipo = 'salida' then
    if v_estado = 'dado_de_baja' then
      raise exception 'Ese lote está dado de baja: no se puede entregar.';
    end if;
    if v_vence is not null and v_vence < current_date then
      raise exception 'Ese lote venció el %. No se puede entregar medicamento vencido.', to_char(v_vence,'DD/MM/YYYY');
    end if;
  end if;

  -- 2) La existencia nunca queda negativa.
  select coalesce(sum(m.cantidad),0) into v_saldo
    from farmacia.movimientos m where m.lote_id = new.lote_id;

  if v_saldo + new.cantidad < 0 then
    raise exception 'No hay suficiente. Quedan % y se intentan sacar %.', v_saldo, abs(new.cantidad);
  end if;

  -- 3) El autor lo pone el servidor, no el navegador.
  if new.origen = 'sistema' then
    new.hecho_por        := auth.uid();
    new.hecho_por_nombre := farmacia.mi_nombre();
    new.hecho_por_rol    := farmacia.mi_rol();
  end if;
  new.momento := now();

  return new;
end $$;

drop trigger if exists tr_guardar_movimiento on farmacia.movimientos;
create trigger tr_guardar_movimiento
  before insert on farmacia.movimientos
  for each row execute function farmacia.fn_guardar_movimiento();

-- Un movimiento no se edita ni se borra: se anula con otro en sentido contrario.
create or replace function farmacia.fn_movimiento_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Un movimiento no se modifica ni se borra. Para corregirlo, registra el movimiento contrario.';
end $$;

drop trigger if exists tr_movimiento_inmutable on farmacia.movimientos;
create trigger tr_movimiento_inmutable
  before update or delete on farmacia.movimientos
  for each row execute function farmacia.fn_movimiento_inmutable();

-- =====================================================================
-- 6. ENTREGAS  (a una persona o a un centro de salud, nunca a los dos)
-- =====================================================================

create table if not exists farmacia.entregas (
  id                 uuid primary key default gen_random_uuid(),
  fecha              date not null default current_date,
  tipo_destinatario  text not null,
  paciente_id        uuid references farmacia.pacientes(id) on delete restrict,
  institucion_id     uuid references farmacia.instituciones(id) on delete restrict,
  recibe_nombre      text,
  recibe_cedula      text,
  observacion        text,
  anulada            boolean not null default false,
  anulada_motivo     text,
  origen             text not null default 'sistema',
  clave_idempotencia text,
  creado_en          timestamptz not null default now(),
  entregado_por      uuid,
  entregado_por_nombre text,
  entregado_por_rol  text
);

alter table farmacia.entregas drop constraint if exists entregas_tipo_valido;
alter table farmacia.entregas add  constraint entregas_tipo_valido
  check (tipo_destinatario in ('paciente','institucion'));

-- Exactamente uno de los dos destinatarios. Ni ninguno, ni los dos.
alter table farmacia.entregas drop constraint if exists entregas_un_solo_destinatario;
alter table farmacia.entregas add  constraint entregas_un_solo_destinatario
  check (
    (tipo_destinatario = 'paciente'    and paciente_id is not null and institucion_id is null) or
    (tipo_destinatario = 'institucion' and institucion_id is not null and paciente_id is null)
  );

-- Entregar a un centro exige constancia de quién recibió.
alter table farmacia.entregas drop constraint if exists entregas_institucion_exige_receptor;
alter table farmacia.entregas add  constraint entregas_institucion_exige_receptor
  check (tipo_destinatario <> 'institucion' or (recibe_nombre is not null and length(trim(recibe_nombre)) > 2));

alter table farmacia.entregas drop constraint if exists entregas_origen_valido;
alter table farmacia.entregas add  constraint entregas_origen_valido
  check (origen in ('sistema','migracion_excel'));

alter table farmacia.entregas drop constraint if exists entregas_autor_coherente;
alter table farmacia.entregas add  constraint entregas_autor_coherente
  check (
    (origen = 'sistema'         and entregado_por is not null) or
    (origen = 'migracion_excel' and entregado_por is null)
  );

-- Con internet malo la gente le da dos veces al botón. El segundo intento
-- choca contra este índice en vez de duplicar la entrega y el descuento.
create unique index if not exists ux_entrega_idempotencia
  on farmacia.entregas (clave_idempotencia) where clave_idempotencia is not null;

create index if not exists ix_entregas_fecha    on farmacia.entregas (fecha desc);
create index if not exists ix_entregas_paciente on farmacia.entregas (paciente_id);
create index if not exists ix_entregas_usuario  on farmacia.entregas (entregado_por, fecha desc);

create table if not exists farmacia.entrega_detalle (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references farmacia.entregas(id) on delete cascade,
  lote_id     uuid not null references farmacia.lotes(id) on delete restrict,
  cantidad    numeric(12,2) not null check (cantidad > 0),
  indicacion  text
);
create index if not exists ix_detalle_entrega on farmacia.entrega_detalle (entrega_id);

-- El autor de la entrega lo sella el servidor SIEMPRE.
-- Se usa un disparador y no un DEFAULT: el DEFAULT solo actúa si el navegador
-- omite la columna, y el navegador sí la puede mandar con el id de otra persona.
create or replace function farmacia.fn_sellar_entrega()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.origen = 'sistema' then
    -- Si alguien intentó firmar a nombre de otro, queda anotado antes de corregirlo.
    if new.entregado_por is not null and new.entregado_por <> auth.uid() then
      insert into farmacia.bitacora (usuario_id, usuario_nombre, usuario_rol, tabla, operacion, nota)
      values (auth.uid(), farmacia.mi_nombre(), farmacia.mi_rol(), 'entregas', 'INTENTO_SUPLANTACION',
              'Intentó registrar la entrega a nombre de ' || new.entregado_por::text);
    end if;
    new.entregado_por        := auth.uid();
    new.entregado_por_nombre := farmacia.mi_nombre();
    new.entregado_por_rol    := farmacia.mi_rol();
  end if;
  return new;
end $$;

drop trigger if exists tr_sellar_entrega on farmacia.entregas;
create trigger tr_sellar_entrega
  before insert on farmacia.entregas
  for each row execute function farmacia.fn_sellar_entrega();

-- Cada renglón entregado descuenta del lote. Un solo camino, sin atajos.
create or replace function farmacia.fn_detalle_descuenta()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into farmacia.movimientos (lote_id, tipo, cantidad, motivo, entrega_id, origen)
  values (new.lote_id, 'salida', -new.cantidad, 'Entrega', new.entrega_id,
          (select e.origen from farmacia.entregas e where e.id = new.entrega_id));
  return new;
end $$;

drop trigger if exists tr_detalle_descuenta on farmacia.entrega_detalle;
create trigger tr_detalle_descuenta
  after insert on farmacia.entrega_detalle
  for each row execute function farmacia.fn_detalle_descuenta();

-- =====================================================================
-- 7. BITÁCORA EN TODAS LAS TABLAS
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['perfiles','productos','lotes','pacientes','tratamientos_paciente',
                           'instituciones','movimientos','entregas','entrega_detalle']
  loop
    execute format('drop trigger if exists tr_bitacora_%1$s on farmacia.%1$I', t);
    execute format(
      'create trigger tr_bitacora_%1$s after insert or update or delete on farmacia.%1$I
         for each row execute function farmacia.fn_bitacora()', t);
  end loop;
end $$;

-- =====================================================================
-- 8. PERMISOS (RLS)
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['perfiles','productos','lotes','pacientes','tratamientos_paciente',
                           'instituciones','movimientos','entregas','entrega_detalle','bitacora']
  loop
    execute format('alter table farmacia.%I enable row level security', t);
    execute format('revoke all on farmacia.%I from anon', t);
    execute format('grant select, insert, update on farmacia.%I to authenticated', t);
  end loop;
end $$;

grant select on farmacia.v_existencia_lote, farmacia.v_existencia_producto to authenticated;
grant usage, select on all sequences in schema farmacia to authenticated;

-- Nadie borra nada, en ninguna tabla. Se desactiva o se anula.
do $$
declare t text;
begin
  foreach t in array array['perfiles','productos','lotes','pacientes','tratamientos_paciente',
                           'instituciones','movimientos','entregas','entrega_detalle','bitacora']
  loop
    execute format('revoke delete on farmacia.%I from authenticated', t);
  end loop;
end $$;

-- ---------- perfiles ----------
drop policy if exists perfiles_ver on farmacia.perfiles;
create policy perfiles_ver on farmacia.perfiles for select to authenticated
  using (id = auth.uid() or farmacia.es_admin());

drop policy if exists perfiles_admin_crea on farmacia.perfiles;
create policy perfiles_admin_crea on farmacia.perfiles for insert to authenticated
  with check (farmacia.es_admin());

-- Solo el admin cambia roles. Nadie se asciende a sí mismo.
drop policy if exists perfiles_admin_edita on farmacia.perfiles;
create policy perfiles_admin_edita on farmacia.perfiles for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

-- ---------- catálogo: lo mantiene inventario, lo consulta todo el mundo ----------
do $$
declare t text;
begin
  foreach t in array array['productos','lotes','instituciones'] loop
    execute format('drop policy if exists %1$s_ver on farmacia.%1$I', t);
    execute format('create policy %1$s_ver on farmacia.%1$I for select to authenticated
                      using (farmacia.mi_rol() is not null)', t);
    execute format('drop policy if exists %1$s_crea on farmacia.%1$I', t);
    execute format('create policy %1$s_crea on farmacia.%1$I for insert to authenticated
                      with check (farmacia.mi_rol() in (''admin'',''inventario''))', t);
    execute format('drop policy if exists %1$s_edita on farmacia.%1$I', t);
    execute format('create policy %1$s_edita on farmacia.%1$I for update to authenticated
                      using (farmacia.mi_rol() in (''admin'',''inventario''))
                      with check (farmacia.mi_rol() in (''admin'',''inventario''))', t);
  end loop;
end $$;

-- ---------- pacientes: los ve y los crea quien atiende ----------
do $$
declare t text;
begin
  foreach t in array array['pacientes','tratamientos_paciente'] loop
    execute format('drop policy if exists %1$s_ver on farmacia.%1$I', t);
    execute format('create policy %1$s_ver on farmacia.%1$I for select to authenticated
                      using (farmacia.mi_rol() is not null)', t);
    execute format('drop policy if exists %1$s_crea on farmacia.%1$I', t);
    execute format('create policy %1$s_crea on farmacia.%1$I for insert to authenticated
                      with check (farmacia.mi_rol() is not null)', t);
    execute format('drop policy if exists %1$s_edita on farmacia.%1$I', t);
    execute format('create policy %1$s_edita on farmacia.%1$I for update to authenticated
                      using (farmacia.mi_rol() is not null)
                      with check (farmacia.mi_rol() is not null)', t);
  end loop;
end $$;

-- ---------- movimientos ----------
drop policy if exists movimientos_ver on farmacia.movimientos;
create policy movimientos_ver on farmacia.movimientos for select to authenticated
  using (farmacia.mi_rol() is not null);

-- Entradas, ajustes y bajas: solo inventario y admin.
-- Salidas: las genera el disparador de entrega_detalle, no se insertan a mano.
drop policy if exists movimientos_crea on farmacia.movimientos;
create policy movimientos_crea on farmacia.movimientos for insert to authenticated
  with check (
    (tipo in ('entrada','ajuste','baja') and farmacia.mi_rol() in ('admin','inventario'))
    or (tipo = 'salida' and farmacia.mi_rol() in ('admin','despacho'))
  );

-- ---------- entregas ----------
drop policy if exists entregas_ver on farmacia.entregas;
create policy entregas_ver on farmacia.entregas for select to authenticated
  using (farmacia.mi_rol() is not null);

-- Red de seguridad por si el disparador se cayera: nadie firma por otro.
drop policy if exists entregas_crea on farmacia.entregas;
create policy entregas_crea on farmacia.entregas for insert to authenticated
  with check (
    farmacia.mi_rol() in ('admin','despacho')
    and origen = 'sistema'
    and (entregado_por is null or entregado_por = auth.uid())
  );

-- Solo el admin anula, y solo puede tocar la anulación.
drop policy if exists entregas_admin_anula on farmacia.entregas;
create policy entregas_admin_anula on farmacia.entregas for update to authenticated
  using (farmacia.es_admin()) with check (farmacia.es_admin());

drop policy if exists detalle_ver on farmacia.entrega_detalle;
create policy detalle_ver on farmacia.entrega_detalle for select to authenticated
  using (farmacia.mi_rol() is not null);

drop policy if exists detalle_crea on farmacia.entrega_detalle;
create policy detalle_crea on farmacia.entrega_detalle for insert to authenticated
  with check (farmacia.mi_rol() in ('admin','despacho'));

-- ---------- bitácora: solo el admin la lee. Nadie la escribe a mano ----------
drop policy if exists bitacora_admin_ve on farmacia.bitacora;
create policy bitacora_admin_ve on farmacia.bitacora for select to authenticated
  using (farmacia.es_admin());

revoke insert, update, delete on farmacia.bitacora from authenticated;

-- =====================================================================
-- 9. ALERTAS
-- =====================================================================
create or replace view farmacia.v_alertas as
select 'vencido' as tipo, lote_id, producto, dosificacion, lote, vence, existencia
  from farmacia.v_existencia_lote
 where situacion = 'vencido' and existencia > 0 and estado = 'disponible'
union all
select 'por_vencer_30', lote_id, producto, dosificacion, lote, vence, existencia
  from farmacia.v_existencia_lote
 where situacion = 'por_vencer_30' and existencia > 0 and estado = 'disponible'
union all
select 'por_vencer_90', lote_id, producto, dosificacion, lote, vence, existencia
  from farmacia.v_existencia_lote
 where situacion = 'por_vencer_90' and existencia > 0 and estado = 'disponible';

grant select on farmacia.v_alertas to authenticated;

-- Lo que el despachador debe ver primero: el lote que vence antes (FEFO).
create or replace view farmacia.v_lotes_para_despachar as
select *
  from farmacia.v_existencia_lote
 where estado = 'disponible'
   and existencia > 0
   and situacion <> 'vencido'
 order by (vence is null), vence asc;

grant select on farmacia.v_lotes_para_despachar to authenticated;

-- =====================================================================
-- Cambio de contraseña obligatorio la primera vez. Repetible.
-- =====================================================================

alter table farmacia.perfiles
  add column if not exists debe_cambiar_clave boolean not null default true;

alter table farmacia.perfiles
  add column if not exists clave_cambiada_en timestamptz;

comment on column farmacia.perfiles.debe_cambiar_clave is
  'La clave la pone quien crea el usuario, asi que la conoce otra persona.
   Hasta que el dueño la cambie, no puede usar el sistema.';

-- Quien ya existe hoy tambien tiene que cambiarla: su clave se escribio
-- en un chat, o la puso el administrador.
update farmacia.perfiles
   set debe_cambiar_clave = true
 where clave_cambiada_en is null;

-- El usuario solo puede tocar SU marca de clave, y solo para apagarla.
-- Ni puede encendersela a otro, ni cambiarse el rol de paso.
drop policy if exists perfiles_marca_su_clave on farmacia.perfiles;
create policy perfiles_marca_su_clave on farmacia.perfiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Un usuario no puede cambiarse el rol ni activarse a si mismo aunque
-- la politica de arriba le deje escribir en su propia fila.
create or replace function farmacia.fn_perfil_protege_rol()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() = new.id and not coalesce(farmacia.es_admin(), false) then
    new.rol    := old.rol;      -- nadie se asciende
    new.activo := old.activo;   -- nadie se reactiva
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists tr_perfil_protege_rol on farmacia.perfiles;
create trigger tr_perfil_protege_rol
  before update on farmacia.perfiles
  for each row execute function farmacia.fn_perfil_protege_rol();

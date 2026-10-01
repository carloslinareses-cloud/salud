-- Desde este cambio, los códigos nuevos son únicos en todo el inventario.
-- Los lotes y movimientos anteriores permanecen intactos.
begin;
lock table farmacia.lotes, farmacia.movimientos in share row exclusive mode;

create or replace function farmacia.normalizar_codigo_lote(p_codigo text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(btrim(coalesce(p_codigo,'')), '\s+', ' ', 'g'))
$$;

-- Una clave única reserva cada código, incluso con registros antiguos repetidos.
create table if not exists farmacia.codigos_lote_ocupados (codigo text primary key);
insert into farmacia.codigos_lote_ocupados(codigo)
select distinct farmacia.normalizar_codigo_lote(codigo) from farmacia.lotes
where farmacia.normalizar_codigo_lote(codigo) <> '' on conflict do nothing;

create table if not exists farmacia.lotes_con_entrada (lote_id uuid primary key);
insert into farmacia.lotes_con_entrada(lote_id)
select distinct lote_id from farmacia.movimientos where tipo = 'entrada'
on conflict do nothing;
revoke all on farmacia.codigos_lote_ocupados, farmacia.lotes_con_entrada from public, anon, authenticated;
alter table farmacia.codigos_lote_ocupados enable row level security;
alter table farmacia.lotes_con_entrada enable row level security;

create or replace function farmacia.exigir_lote_unico()
returns trigger language plpgsql security definer set search_path = '' as $$
declare codigo_nuevo text := farmacia.normalizar_codigo_lote(new.codigo);
begin
  if tg_op = 'UPDATE' and codigo_nuevo = farmacia.normalizar_codigo_lote(old.codigo) then
    return new;
  end if;
  if codigo_nuevo = '' then
    raise exception 'Escribe un número de lote. Cada nueva entrada debe tener un lote distinto.' using errcode = '23514';
  end if;
  begin
    insert into farmacia.codigos_lote_ocupados(codigo) values(codigo_nuevo);
  exception when unique_violation then
    raise exception 'Ese lote ya está registrado en el inventario. Usa un lote distinto.' using errcode = '23505';
  end;
  new.codigo := codigo_nuevo;
  return new;
end $$;

create or replace function farmacia.liberar_codigo_lote()
returns trigger language plpgsql security definer set search_path = '' as $$
declare codigo_anterior text := farmacia.normalizar_codigo_lote(old.codigo);
begin
  if tg_op = 'UPDATE' and codigo_anterior = farmacia.normalizar_codigo_lote(new.codigo) then
    return new;
  end if;
  perform 1 from farmacia.codigos_lote_ocupados where codigo = codigo_anterior for update;
  if codigo_anterior <> '' and not exists (
    select 1 from farmacia.lotes where farmacia.normalizar_codigo_lote(codigo) = codigo_anterior
  ) then
    delete from farmacia.codigos_lote_ocupados where codigo = codigo_anterior;
  end if;
  if tg_op = 'DELETE' then
    delete from farmacia.lotes_con_entrada where lote_id = old.id;
    return old;
  end if;
  return new;
end $$;

create or replace function farmacia.exigir_entrada_lote_nuevo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'entrada' then
    begin
      insert into farmacia.lotes_con_entrada(lote_id) values(new.lote_id);
    exception when unique_violation then
      raise exception 'Este lote ya tiene una entrada registrada. La nueva entrada debe usar un lote distinto.' using errcode = '23505';
    end;
  end if;
  return new;
end $$;

drop trigger if exists exigir_lote_unico on farmacia.lotes;
create trigger exigir_lote_unico before insert or update of codigo on farmacia.lotes
for each row execute function farmacia.exigir_lote_unico();
drop trigger if exists liberar_codigo_lote on farmacia.lotes;
create trigger liberar_codigo_lote after delete or update of codigo on farmacia.lotes
for each row execute function farmacia.liberar_codigo_lote();
drop trigger if exists exigir_entrada_lote_nuevo on farmacia.movimientos;
create trigger exigir_entrada_lote_nuevo before insert on farmacia.movimientos
for each row execute function farmacia.exigir_entrada_lote_nuevo();

create or replace function farmacia.lote_codigo_disponible(p_codigo text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(farmacia.mi_rol(),'') not in ('admin','inventario') then
    raise exception 'Solo Administración e Inventario pueden registrar lotes.' using errcode = '42501';
  end if;
  return farmacia.normalizar_codigo_lote(p_codigo) <> '' and not exists (
    select 1 from farmacia.codigos_lote_ocupados where codigo = farmacia.normalizar_codigo_lote(p_codigo)
  );
end $$;
revoke all on function farmacia.lote_codigo_disponible(text) from public, anon;
grant execute on function farmacia.lote_codigo_disponible(text) to authenticated;
revoke all on function farmacia.exigir_lote_unico(), farmacia.liberar_codigo_lote(), farmacia.exigir_entrada_lote_nuevo() from public, anon, authenticated;
commit;

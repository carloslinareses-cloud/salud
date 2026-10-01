BEGIN;
CREATE OR REPLACE FUNCTION farmacia.fn_guardar_movimiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_vence date; v_estado text; v_saldo numeric;
begin
  select l.vence, l.estado into v_vence, v_estado
    from farmacia.lotes l where l.id = new.lote_id for update;

  -- 1) No se despacha de un lote vencido ni dado de baja.
  if new.tipo = 'salida' then
    if v_estado = 'dado_de_baja' then
      raise exception 'Ese lote está dado de baja: no se puede entregar.';
    end if;
    if v_vence is not null and v_vence < current_date then
      raise exception 'Ese lote venció el %. No se puede entregar medicamento vencido.', to_char(v_vence,'DD/MM/YYYY');
    end if;
  end if;

  if new.cantidad < 0 and current_setting('transaction_isolation') = 'repeatable read' then
    raise exception 'La existencia necesita una consulta actual. Reintenta la operación.' using errcode='40001';
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
end $function$
;
COMMIT;

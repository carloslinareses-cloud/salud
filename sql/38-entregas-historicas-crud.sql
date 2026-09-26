-- Corrección auditada del texto y fecha de entregas importadas.
-- Nunca convierte cantidades desconocidas del Excel en existencias.
create or replace function farmacia.entrega_historica_corregir(
  p_id uuid, p_fecha date, p_texto text, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_entrega farmacia.entregas%rowtype;
begin
  if farmacia.mi_rol() is distinct from 'admin' and farmacia.mi_rol() is distinct from 'inventario' then
    raise exception 'Solo Administración e Inventario pueden corregir entregas históricas.' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_motivo,''))) < 8 or p_fecha is null or
     p_fecha > (now() at time zone 'America/Caracas')::date or
     length(btrim(coalesce(p_texto,''))) < 3 then
    raise exception 'Revisa la fecha, el texto de la entrega y el motivo (mínimo 8 caracteres).' using errcode='22023';
  end if;
  select * into v_entrega from farmacia.entregas where id=p_id for update;
  if not found or v_entrega.origen <> 'migracion_excel' or v_entrega.anulada then
    raise exception 'La entrega no es histórica o ya está anulada.' using errcode='22023';
  end if;
  if exists(select 1 from farmacia.entrega_detalle where entrega_id=p_id) or
     exists(select 1 from farmacia.movimientos where entrega_id=p_id) then
    raise exception 'Esta entrega tiene inventario asociado; requiere corrección de cantidades.' using errcode='23503';
  end if;
  update farmacia.entregas set fecha=p_fecha, observacion=btrim(p_texto) where id=p_id;
  insert into farmacia.bitacora(usuario_id,usuario_nombre,usuario_rol,tabla,operacion,registro_id,nota)
    values(auth.uid(),farmacia.mi_nombre(),farmacia.mi_rol(),'entregas','CORRECCION_HISTORICA',p_id::text,btrim(p_motivo));
end $$;
revoke all on function farmacia.entrega_historica_corregir(uuid,date,text,text) from public,anon;
grant execute on function farmacia.entrega_historica_corregir(uuid,date,text,text) to authenticated;

-- =====================================================================
-- FARMACIA MUNICIPAL · CRUD de Inventario y asistencia manual del admin
-- Fecha: 21/09/2026
--
-- 1. Administración e Inventario pueden deshacer productos o lotes
--    creados por error, siempre que todavía no tengan historia.
-- 2. Solo Administración puede crear o corregir asistencia manualmente.
--    Cada cambio conserva autor, fecha, motivo y la bitácora automática.
--
-- Se puede ejecutar completo varias veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- INVENTARIO: completar CRUD para los dos roles que mantienen existencias.
-- Los movimientos y las entregas continúan siendo imborrables.
-- ---------------------------------------------------------------------
grant delete on farmacia.productos, farmacia.lotes to authenticated;

drop policy if exists productos_admin_borra on farmacia.productos;
drop policy if exists productos_inventario_borra on farmacia.productos;
create policy productos_inventario_borra on farmacia.productos
  for delete to authenticated
  using (
    farmacia.mi_rol() in ('admin', 'inventario')
    and not exists (
      select 1 from farmacia.lotes l where l.producto_id = productos.id
    )
    and not exists (
      select 1 from farmacia.tratamientos_paciente t where t.producto_id = productos.id
    )
  );

drop policy if exists lotes_admin_borra on farmacia.lotes;
drop policy if exists lotes_inventario_borra on farmacia.lotes;
create policy lotes_inventario_borra on farmacia.lotes
  for delete to authenticated
  using (
    farmacia.mi_rol() in ('admin', 'inventario')
    and not exists (
      select 1 from farmacia.movimientos m where m.lote_id = lotes.id
    )
    and not exists (
      select 1 from farmacia.entrega_detalle d where d.lote_id = lotes.id
    )
  );

-- ---------------------------------------------------------------------
-- ASISTENCIA: puerta única y auditada para el registro manual.
-- No se concede INSERT directo sobre asistencia_registros al navegador.
-- ---------------------------------------------------------------------
create or replace function farmacia.asis_admin_registrar_manual(
  p_cedula text,
  p_fecha date,
  p_hora_entrada time,
  p_hora_salida time,
  p_motivo text
) returns farmacia.asistencia_registros
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cedula  text := regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g');
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_entrada timestamptz;
  v_salida  timestamptz;
  v_anterior farmacia.asistencia_registros;
  v_fila     farmacia.asistencia_registros;
begin
  if not farmacia.es_admin() then
    raise exception 'Solo el administrador puede registrar asistencia manual.' using errcode = '42501';
  end if;
  if p_fecha is null or p_fecha > (timezone('America/Caracas', now()))::date then
    raise exception 'La fecha del registro manual no puede estar vacía ni ser futura.' using errcode = '22007';
  end if;
  if p_hora_entrada is null then
    raise exception 'La hora de entrada es obligatoria.' using errcode = '22007';
  end if;
  if length(v_motivo) < 8 then
    raise exception 'El motivo debe explicar el registro o la corrección con al menos 8 caracteres.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from farmacia.asistencia_personal ap
     where ap.cedula = v_cedula and ap.activo
  ) then
    raise exception 'La persona no existe o está inactiva en el control de asistencia.' using errcode = '22023';
  end if;

  v_entrada := (p_fecha::timestamp + p_hora_entrada) at time zone 'America/Caracas';
  if p_hora_salida is not null then
    v_salida := (p_fecha::timestamp + p_hora_salida
      + case when p_hora_salida <= p_hora_entrada then interval '1 day' else interval '0' end)
      at time zone 'America/Caracas';
    if v_salida - v_entrada > interval '18 hours' then
      raise exception 'La salida no puede quedar a más de 18 horas de la entrada.' using errcode = '22023';
    end if;
  end if;

  select * into v_anterior
    from farmacia.asistencia_registros
   where cedula = v_cedula and fecha = p_fecha;

  if not found then
    insert into farmacia.asistencia_registros (
      cedula, fecha, hora_entrada, hora_salida, dispositivo,
      nota_correccion, corregido_por, corregido_en
    ) values (
      v_cedula, p_fecha, v_entrada, v_salida, 'Registro manual por Administración',
      'Registro manual: ' || v_motivo, auth.uid(), now()
    ) returning * into v_fila;
  else
    update farmacia.asistencia_registros
       set hora_entrada = v_entrada,
           lat_entrada = case when hora_entrada is distinct from v_entrada then null else lat_entrada end,
           lng_entrada = case when hora_entrada is distinct from v_entrada then null else lng_entrada end,
           precision_entrada = case when hora_entrada is distinct from v_entrada then null else precision_entrada end,
           distancia_entrada = case when hora_entrada is distinct from v_entrada then null else distancia_entrada end,
           sede_entrada_id = case when hora_entrada is distinct from v_entrada then null else sede_entrada_id end,
           dentro_sede_entrada = case when hora_entrada is distinct from v_entrada then null else dentro_sede_entrada end,
           foto_entrada = case when hora_entrada is distinct from v_entrada then null else foto_entrada end,
           hora_salida = v_salida,
           lat_salida = case when hora_salida is distinct from v_salida then null else lat_salida end,
           lng_salida = case when hora_salida is distinct from v_salida then null else lng_salida end,
           precision_salida = case when hora_salida is distinct from v_salida then null else precision_salida end,
           distancia_salida = case when hora_salida is distinct from v_salida then null else distancia_salida end,
           sede_salida_id = case when hora_salida is distinct from v_salida then null else sede_salida_id end,
           dentro_sede_salida = case when hora_salida is distinct from v_salida then null else dentro_sede_salida end,
           foto_salida = case when hora_salida is distinct from v_salida then null else foto_salida end,
           dispositivo = 'Corrección manual por Administración',
           nota_correccion = 'Corrección manual: ' || v_motivo,
           corregido_por = auth.uid(),
           corregido_en = now()
     where id = v_anterior.id
    returning * into v_fila;
  end if;

  return v_fila;
end $$;

comment on function farmacia.asis_admin_registrar_manual(text, date, time, time, text) is
  'Crea o corrige una jornada manual. Solo admin; valida persona/fecha/horas y registra motivo, autor y bitácora.';

revoke all on function farmacia.asis_admin_registrar_manual(text, date, time, time, text)
  from public, anon;
grant execute on function farmacia.asis_admin_registrar_manual(text, date, time, time, text)
  to authenticated;

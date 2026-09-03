-- =====================================================================
-- Unifica los medicamentos que estaban cargados dos veces por una
-- errata de escritura. El historial y los lotes de la ficha mal escrita
-- pasan a la bien escrita, y la mal escrita se desactiva.
--
-- SOLO se unen pares que son LA MISMA PALABRA mal escrita.
-- Quedan deliberadamente FUERA, porque son cosas distintas:
--
--   ACICLOVIR            /  GANCICLOVIR          antivirales distintos
--   AZITROMICINA         /  CLARITROMICINA       antibióticos distintos
--   CLOTRIMAZOL          /  CO TRIMOXAZOL        antifúngico vs antibiótico
--   AMOXICILINA          /  AMPICILINA           antibióticos distintos
--   ÁCIDO FÓLICO 10mg    /  ÁCIDO FÓLICO 10ml    presentaciones distintas
--   RINGER               /  RINGER LACTATO       soluciones distintas
--   CEFIXIME             /  CEFIXINA             sin certeza, lo decide un farmacéutico
--
-- Repetible: lo ya unido no se vuelve a tocar.
-- =====================================================================

alter table farmacia.productos add column if not exists nombre_original text;
alter table farmacia.productos add column if not exists nota_correccion text;

do $$
declare
  pares text[][] := array[
    -- [ nombre mal escrito , nombre correcto ]
    array['BIPERIDENO CHLORHIDRATO 2mg', 'BIPERIDENO CLORHIDRATO 2mg'],
    array['CLARITOMICINA 250mg / 5ml',   'CLARITROMICINA 250mg / 5ml'],
    array['TRIMETROPRIMN SULFATO',       'TRIMETROPRIM SULFATO'],
    array['SENIDAZOL 500mg',             'SECNIDAZOL 500MG'],
    array['VERAPAMILLO 40mg',            'VERAPAMILO 40mg'],
    array['VERAPAMILLO 80mg',            'VERAPAMILO 80mg'],
    array['GLINCAZIDA 80MG',             'GLICAZIDA 80mg'],
    array['CEFALEXIA SUSPENSIÓN',        'CEFALEXIN SUSPENSIÓN'],
    array['LERCANIDIPINA 10mg',          'LERCANIDIPINO 10mg'],
    array['SINVASTATINA 20mg',           'SIMVASTATINA 20mg'],
    array['ALENTRONATO 70mg',            'ALENDRONATO 70MG'],
    array['NIMESULIDE 100mg',            'NIMESULIDA 100mg'],
    array['CISLOTAZOL 50mg',             'CILOSTAZOL 50mg'],
    array['DIGOXINA 0.25 mg',            'DIGOXINA 0,25mg']
  ];
  i int;
  v_malo uuid; v_bueno uuid;
begin
  for i in 1 .. array_length(pares, 1) loop
    select id into v_malo  from farmacia.productos
     where nombre = pares[i][1] and activo limit 1;
    select id into v_bueno from farmacia.productos
     where nombre = pares[i][2] and activo limit 1;

    if v_malo is not null and v_bueno is not null and v_malo <> v_bueno then
      -- Si el producto bueno YA tiene un lote equivalente (mismo número y
      -- mismo vencimiento), no se puede mover el lote encima: se pasan sus
      -- movimientos al lote que ya existe, para no perder existencia.
      update farmacia.movimientos m
         set lote_id = bueno.id
        from farmacia.lotes malo
        join farmacia.lotes bueno
          on bueno.producto_id = v_bueno
         and lower(coalesce(bueno.codigo, '')) = lower(coalesce(malo.codigo, ''))
         and coalesce(bueno.vence, '9999-12-31') = coalesce(malo.vence, '9999-12-31')
       where m.lote_id = malo.id
         and malo.producto_id = v_malo;

      update farmacia.entrega_detalle d
         set lote_id = bueno.id
        from farmacia.lotes malo
        join farmacia.lotes bueno
          on bueno.producto_id = v_bueno
         and lower(coalesce(bueno.codigo, '')) = lower(coalesce(malo.codigo, ''))
         and coalesce(bueno.vence, '9999-12-31') = coalesce(malo.vence, '9999-12-31')
       where d.lote_id = malo.id
         and malo.producto_id = v_malo;

      -- El lote que ya quedó vacío se da de baja para que no aparezca.
      update farmacia.lotes malo
         set estado = 'dado_de_baja',
             nota = coalesce(malo.nota || ' · ', '') ||
                    'Lote fusionado con el del nombre correcto.'
       where malo.producto_id = v_malo
         and exists (select 1 from farmacia.lotes bueno
                      where bueno.producto_id = v_bueno
                        and lower(coalesce(bueno.codigo, '')) = lower(coalesce(malo.codigo, ''))
                        and coalesce(bueno.vence, '9999-12-31') = coalesce(malo.vence, '9999-12-31'));

      -- Los lotes que no chocan sí se pueden mover tal cual.
      update farmacia.lotes malo
         set producto_id = v_bueno,
             nota = coalesce(malo.nota || ' · ', '') ||
                    'Venía cargado como «' || pares[i][1] || '».'
       where malo.producto_id = v_malo
         and malo.estado <> 'dado_de_baja'
         and not exists (select 1 from farmacia.lotes bueno
                          where bueno.producto_id = v_bueno
                            and lower(coalesce(bueno.codigo, '')) = lower(coalesce(malo.codigo, ''))
                            and coalesce(bueno.vence, '9999-12-31') = coalesce(malo.vence, '9999-12-31'));

      update farmacia.tratamientos_paciente
         set producto_id = v_bueno
       where producto_id = v_malo;

      update farmacia.productos
         set activo = false,
             nota_correccion = 'Estaba escrito con una errata. Se unificó con «'
                               || pares[i][2] || '», que es el nombre correcto.'
       where id = v_malo;

      update farmacia.productos
         set nombre_original = coalesce(nombre_original, '') ||
               case when nombre_original is null then '' else ' · ' end || pares[i][1],
             nota_correccion = 'Se le unieron los lotes que estaban cargados con una errata '
                               'en el nombre.'
       where id = v_bueno;
    end if;

    v_malo := null; v_bueno := null;
  end loop;
end $$;

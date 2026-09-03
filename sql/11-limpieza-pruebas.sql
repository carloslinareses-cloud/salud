-- =====================================================================
-- Saca de la base todo lo que era una prueba y no un hecho real.
--
-- Durante el montaje se hicieron pruebas contra la base de verdad. Dos
-- cosas quedaron dentro y no deben estar ahí cuando el sistema se use:
--
--   1. Una entrega de prueba (3 unidades de BROMEXINA 8mg) que quedó
--      anotada en el historial de un paciente REAL. Nunca ocurrió: ese
--      paciente no retiró nada. La existencia ya se había devuelto con
--      un ajuste, así que se borran los dos movimientos juntos (la
--      salida y su devolución) y el saldo del lote no se mueve.
--
--   2. Los usuarios de demostración que se usaron para tomar las fotos
--      del manual y para probar los permisos. No hacen falta: los
--      usuarios de verdad se crean desde el panel del admin.
--
-- Los movimientos y la bitácora son inmutables a propósito: ni el
-- servidor de la aplicación puede borrarlos. Por eso este archivo se
-- corre como administrador de la base, apagando los disparadores SOLO
-- durante esta transacción. La aplicación nunca puede hacer esto.
--
-- Se puede correr varias veces: si ya no hay nada de prueba, no hace nada.
-- =====================================================================

begin;
set local session_replication_role = replica;

-- Las entregas de prueba: las que no vinieron del Excel y las hizo un
-- usuario de prueba o de demostración.
create temporary table pruebas_entregas on commit drop as
  select e.id
    from farmacia.entregas e
    left join farmacia.perfiles pf on pf.id = e.entregado_por
   where e.origen <> 'migracion_excel'
     and (pf.correo like '%@manual.local'
       or pf.correo = 'despacho.prueba@alcaldiadecharallave.com'
       or pf.correo like 'zzz.%@prueba.local');

-- Los movimientos que generó esa entrega, y el ajuste que la devolvió.
-- Van juntos: uno restó y el otro sumó lo mismo, así que el saldo queda igual.
create temporary table pruebas_movimientos on commit drop as
  select m.id
    from farmacia.movimientos m
   where m.entrega_id in (select id from pruebas_entregas)
      or m.motivo = 'Devuelve lo tomado en la prueba del sistema';

delete from farmacia.bitacora
 where registro_id in (select id::text from pruebas_entregas)
    or registro_id in (select id::text from pruebas_movimientos)
    or registro_id in (select d.id::text from farmacia.entrega_detalle d
                        where d.entrega_id in (select id from pruebas_entregas))
    or usuario_id in (select id from farmacia.perfiles
                       where correo like '%@manual.local'
                          or correo = 'despacho.prueba@alcaldiadecharallave.com');

delete from farmacia.movimientos where id in (select id from pruebas_movimientos);
delete from farmacia.entrega_detalle where entrega_id in (select id from pruebas_entregas);
delete from farmacia.entregas where id in (select id from pruebas_entregas);

delete from farmacia.perfiles
 where correo like '%@manual.local'
    or correo = 'despacho.prueba@alcaldiadecharallave.com';

set local session_replication_role = origin;
commit;

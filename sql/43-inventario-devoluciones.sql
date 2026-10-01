-- Una devolucion revierte una salida existente; no es una nueva recepcion.
BEGIN;
CREATE OR REPLACE FUNCTION farmacia.exigir_entrada_lote_nuevo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original farmacia.movimientos%rowtype;
BEGIN
 IF new.tipo='entrada' THEN
  IF new.anula_a IS NOT NULL THEN
   SELECT * INTO original FROM farmacia.movimientos WHERE id=new.anula_a FOR UPDATE;
   IF NOT FOUND OR original.tipo<>'salida' OR original.cantidad>=0
      OR original.lote_id<>new.lote_id OR new.cantidad<>-original.cantidad THEN
    RAISE EXCEPTION 'La devolucion debe corresponder exactamente a una salida del mismo lote.' USING errcode='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM farmacia.movimientos WHERE anula_a=new.anula_a) THEN
    RAISE EXCEPTION 'Esa salida ya fue devuelta al inventario.' USING errcode='23505';
   END IF;
  ELSE
   BEGIN
    INSERT INTO farmacia.lotes_con_entrada(lote_id) VALUES(new.lote_id);
   EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Este lote ya tiene una entrada registrada. La nueva entrada debe usar un lote distinto.' USING errcode='23505';
   END;
  END IF;
 END IF;
 RETURN new;
END $$;
COMMIT;

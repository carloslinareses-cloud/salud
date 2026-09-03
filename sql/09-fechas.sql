-- =====================================================================
-- Recupera las fechas de entrega que no se pudieron leer.
-- Casi todas son erratas de tecleo, no fechas imposibles:
--   09//06/2026   doble barra
--   09/06//2026   doble barra
--   22/06/2026.   punto al final
--   15/0602026    falta una barra
--   07/02/206     al año le falta un dígito
--   2626-05-11    el año lleva un 6 de más
-- El texto original se conserva siempre en fecha_original. Repetible.
-- =====================================================================

-- 1) Limpia los signos de más: dobles barras, puntos al final, espacios.
update farmacia.entregas
   set fecha = to_date(
         regexp_replace(regexp_replace(trim(fecha_original), '[.\s]+$', ''), '/{2,}', '/', 'g'),
         'DD/MM/YYYY')
 where fecha is null
   and regexp_replace(regexp_replace(trim(fecha_original), '[.\s]+$', ''), '/{2,}', '/', 'g')
       ~ '^\d{1,2}/\d{1,2}/\d{4}$';

-- 2) Falta una barra: 15/0602026 son 15/06/2026.
update farmacia.entregas
   set fecha = to_date(
         regexp_replace(trim(fecha_original), '^(\d{1,2})/(\d{2})(\d{4})$', '\1/\2/\3'),
         'DD/MM/YYYY')
 where fecha is null
   and trim(fecha_original) ~ '^\d{1,2}/\d{2}\d{4}$';

-- 3) Al año le falta un dígito: 07/02/206 en un registro de 2026.
update farmacia.entregas
   set fecha = to_date(
         regexp_replace(trim(fecha_original), '^(\d{1,2})/(\d{1,2})/206$', '\1/\2/2026'),
         'DD/MM/YYYY')
 where fecha is null
   and trim(fecha_original) ~ '^\d{1,2}/\d{1,2}/206$';

-- 4) El año lleva un 6 de más: 2626-05-11 en un registro que va de enero
--    a diciembre de 2026.
update farmacia.entregas
   set fecha = to_date(replace(trim(fecha_original), '2626-', '2026-'), 'YYYY-MM-DD')
 where fecha is null
   and trim(fecha_original) ~ '^2626-\d{2}-\d{2}$';

-- Nota: las que dicen «#VALUE!» se quedan sin fecha. Eso no es una errata
-- de tecleo sino un error de fórmula del Excel: no hay fecha que recuperar.

-- 5) 15/0602026 lleva un cero de más en el año: es 15/06/2026.
update farmacia.entregas
   set fecha = to_date(
         regexp_replace(trim(fecha_original), '^(\d{1,2})/(\d{2})0(\d{4})$', '\1/\2/\3'),
         'DD/MM/YYYY')
 where fecha is null
   and trim(fecha_original) ~ '^\d{1,2}/\d{2}0\d{4}$';

-- =====================================================================
-- VACIAR EL INVENTARIO PARA CARGARLO A MANO
--
-- El inventario que se migró de los Excel no servía: los nombres venían
-- de cuatro hojas distintas que no cuadraban entre sí, 122 medicamentos
-- tenían solo existencia vencida y 333 estaban en cero. La Dirección de
-- Salud decidió cargarlo de nuevo, a mano, con lo que hay de verdad en
-- el anaquel.
--
-- SE BORRA:
--   productos      460
--   lotes          473
--   movimientos    252
--
-- NO SE TOCA:
--   pacientes            3.953
--   entregas             4.999   (el historial de los Excel)
--   instituciones
--   perfiles                 7   (los usuarios ya creados)
--   bitácora            26.308   (todo lo que se ha hecho)
--   tratamientos_paciente  988   (qué toma cada persona: su texto queda)
--
-- Los 22 renglones de tratamiento que apuntaban a un medicamento pierden
-- ese enlace, pero conservan su texto original. En cuanto el catálogo
-- nuevo tenga esos nombres, la vista los vuelve a reconocer sola.
--
-- Antes de correr esto se guardó todo en:
--   Documents/Alcaldia BDD/respaldo-inventario-farmacia-AAAA-MM-DD.json
--
-- Los movimientos y la bitácora son inmutables a propósito: ni el
-- servidor los borra. Por eso esto corre como administrador de la base
-- apagando los disparadores SOLO durante esta transacción, y al final
-- deja constancia de lo que se hizo.
-- =====================================================================

begin;
set local session_replication_role = replica;

-- El tratamiento de cada paciente conserva su texto; solo se suelta el
-- enlace al medicamento que va a dejar de existir.
update farmacia.tratamientos_paciente
   set producto_id = null
 where producto_id is not null;

delete from farmacia.movimientos;
delete from farmacia.lotes;
delete from farmacia.productos;

-- Constancia de lo que acaba de pasar. Un solo apunte, en vez de los
-- 1.185 que habrían salido de los disparadores.
insert into farmacia.bitacora (usuario_nombre, usuario_rol, tabla, operacion, nota)
values ('Carlos Linares', 'admin', 'productos', 'DELETE',
        'Se vació el inventario completo (460 medicamentos, 473 lotes, 252 movimientos) '
        'para cargarlo a mano con lo que hay de verdad en el anaquel. El inventario '
        'migrado de los Excel no cuadraba. Respaldo guardado antes de borrar. '
        'Pacientes, entregas, usuarios y bitácora quedaron intactos.');

set local session_replication_role = origin;
commit;

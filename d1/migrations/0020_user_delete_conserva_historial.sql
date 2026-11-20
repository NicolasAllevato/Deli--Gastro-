-- 0020: borrar un usuario de la app NO puede llevarse historial.
--
-- Al eliminar un usuario del personal solo se borran su cuenta de acceso (user, session, account, verification) y sus intentos
-- de contraseña. Pedidos, clientes, puntos, reseñas, pagos, WhatsApp, reclamos y bitácoras se quedan como están.
-- Claves foráneas a "user" (esquema 0001 + 0019):
--   session, account                       ON DELETE CASCADE   es la cuenta de acceso: se borra con el usuario.
--   legal_acceptances                      ON DELETE SET NULL  (0019) la constancia se conserva sin usuario.
--   orders.courier_user_id                 ON DELETE SET NULL  el pedido se conserva (queda courier_name).
--   couriers, courier_locations,
--   courier_shifts                         ON DELETE CASCADE   son de repartidores: la herramienta solo borra role = 'admin'
--                                                              (el DELETE lleva esa condición), así que no se tocan.
--   clients.user_id                        ON DELETE CASCADE   HISTORIAL: la ficha, y por cascada sus puntos, reseñas y pagos,
--                                                              se iban con el usuario (si el usuario del personal también había
--                                                              comprado). SQLite no cambia una clave foránea sin reconstruir la
--                                                              tabla, y reconstruir clients con sus hijos en CASCADE (puntos,
--                                                              reseñas, pagos) y la clave foránea activa que D1 no deja apagar
--                                                              los borraría. Se resuelve con un trigger BEFORE DELETE que
--                                                              desvincula la ficha (user_id = NULL, que es lo que haría SET NULL)
--                                                              antes de que corra la cascada.
-- NO aplicar en remoto sin OK del usuario.
CREATE TRIGGER IF NOT EXISTS user_before_delete_keep_client
BEFORE DELETE ON "user"
BEGIN
  UPDATE clients SET user_id = NULL WHERE user_id = OLD.id;
END;

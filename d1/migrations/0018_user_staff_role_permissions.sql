-- 0018: usuarios del personal con permisos por sección.
-- El acceso al portal sigue siendo `role = 'admin'` (gerente y cajero también lo tienen);
-- lo que los limita es `staff_role` + `permissions`, que solo escribe el servidor
-- (additionalFields con input:false en src/lib/data/auth.ts). No se reconstruye la tabla.
--   staff_role   admin (dueño, todo en "editar") | gerente | cajero. NULL en usuarios que no son personal.
--   permissions  JSON con ajustes por sección sobre los valores por defecto del rol,
--                p. ej. {"catalogo":"view"}. NULL = defaults. El rol admin ignora este campo.
-- Se aplica una sola vez, como el resto de las migraciones (ADD COLUMN no es idempotente).
ALTER TABLE "user" ADD COLUMN staff_role TEXT CHECK (staff_role IN ('admin','gerente','cajero'));
ALTER TABLE "user" ADD COLUMN permissions TEXT;

-- Los admins que ya existen quedan como dueños.
UPDATE "user" SET staff_role = 'admin' WHERE role = 'admin' AND staff_role IS NULL;

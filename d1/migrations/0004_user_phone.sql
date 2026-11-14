-- 0004: teléfono del usuario en la tabla "user" de Better Auth (copia desde Supabase Auth).
-- Lo escribe solo el servidor (additionalFields con input:false). Idempotente salvo el ADD COLUMN,
-- que se aplica una sola vez con el resto de las migraciones.
ALTER TABLE "user" ADD COLUMN phone TEXT;

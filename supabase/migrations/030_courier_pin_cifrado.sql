-- 030 · Copia cifrada (reversible) del PIN de cada repartidor, para que el admin pueda verlo.
-- AES-256-GCM hecho en el servidor con el secreto COURIER_PIN_KEY: la base nunca ve la clave.
-- El ingreso sigue validando contra pin_hash (único). Los repartidores existentes quedan en null
-- hasta que el admin les resetee la clave. Solo toca public.couriers (RLS ya activo, solo service role).

alter table public.couriers add column if not exists pin_encrypted text;

comment on column public.couriers.pin_encrypted is
  'PIN cifrado con AES-256-GCM (formato v1.iv.ct, AAD = user_id). Clave en COURIER_PIN_KEY. Migración 030.';

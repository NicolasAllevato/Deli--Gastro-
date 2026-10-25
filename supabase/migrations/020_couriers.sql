-- 020 · Repartidores con ingreso por PIN de 4 dígitos.
-- El admin da de alta a cada repartidor y le asigna un PIN; el repartidor entra solo con el PIN.
-- Se guarda el HMAC-SHA256 del PIN (clave del servidor), nunca el PIN: es único para que el PIN
-- identifique al repartidor. Detrás de cada fila hay un usuario de Supabase Auth con rol repartidor.

create table if not exists public.couriers (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  pin_hash    text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Solo service role (API server-side): ni el repartidor ni el navegador leen los hashes.
alter table public.couriers enable row level security;

comment on table public.couriers is 'Repartidores y el hash de su PIN de ingreso. Migración 020.';

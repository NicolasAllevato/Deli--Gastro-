-- 022 · Catálogo sincronizado con Fudo.
-- Fudo manda en nombre, precio, disponibilidad y categoría; la app conserva foto, descripción y puntos.
-- El Worker `fudo-gateway` (cron + POST /catalog-sync) crea y actualiza estas filas por `fudo_id`.
-- Los productos sin `fudo_id` (source = 'manual') no se tocan. Ver docs/FUDO_INTEGRACION.md.

alter table public.categories
  add column if not exists fudo_id        integer unique,
  add column if not exists source         text not null default 'manual' check (source in ('manual', 'fudo')),
  add column if not exists fudo_synced_at timestamptz;

alter table public.products
  add column if not exists fudo_id        integer unique,
  add column if not exists source         text not null default 'manual' check (source in ('manual', 'fudo')),
  add column if not exists fudo_synced_at timestamptz;

-- Bitácora de cada corrida de sincronización (solo service role: sin políticas = sin acceso público).
create table if not exists public.fudo_sync_runs (
  id                     uuid primary key default gen_random_uuid(),
  ran_at                 timestamptz not null default now(),
  ok                     boolean not null,
  categories_created     integer not null default 0,
  categories_updated     integer not null default 0,
  products_created       integer not null default 0,
  products_updated       integer not null default 0,
  products_deactivated   integer not null default 0,
  error                  text
);

create index if not exists fudo_sync_runs_ran_at_idx on public.fudo_sync_runs (ran_at desc);

alter table public.fudo_sync_runs enable row level security;

comment on column public.products.fudo_id is 'Id del producto en Fudo. Si está, Fudo manda en nombre, precio, disponibilidad y categoría. Migración 022.';
comment on table public.fudo_sync_runs is 'Resultado de cada sincronización del catálogo con Fudo. Migración 022.';

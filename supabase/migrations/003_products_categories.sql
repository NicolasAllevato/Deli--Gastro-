-- Deli-Gastro — categories + products
-- Faltaban en la base real (confirmado vía introspección REST: la base solo
-- tenía clients/orders/global_config/points_ledger de 001_initial_schema.sql).
-- Shape alineado con src/fixtures/productos.ts (Category, Product).

-- ──────────────────────────────────────────────
-- categories
-- ──────────────────────────────────────────────
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

-- Lectura pública (catálogo visible para clientes no autenticados también)
create policy "categories_select_all" on public.categories
  for select using (true);

-- Escritura: sólo admin (rol en app_metadata, ver src/lib/auth/roles.ts)
create policy "categories_write_admin" on public.categories
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create trigger categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- products
-- ──────────────────────────────────────────────
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name        text not null,
  description text not null default '',
  price       numeric(10,2) not null default 0 check (price >= 0),
  image_url   text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "products_select_all" on public.products
  for select using (true);

create policy "products_write_admin" on public.products
  for all using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

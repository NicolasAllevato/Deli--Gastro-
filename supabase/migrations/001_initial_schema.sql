-- Deli-Gastro — Esquema inicial
-- Ejecutar en el SQL Editor de Supabase o via `supabase db push`

-- ──────────────────────────────────────────────
-- clients
-- ──────────────────────────────────────────────
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  address     text,
  tier        text not null default 'Bronce' check (tier in ('Bronce','Plata','Oro','Platino')),
  total_points integer not null default 0 check (total_points >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.clients enable row level security;

-- El cliente sólo ve su propio registro; admin (service role) ve todos
create policy "client_select_own" on public.clients
  for select using (auth.uid() = user_id);

create policy "client_insert_own" on public.clients
  for insert with check (auth.uid() = user_id);

create policy "client_update_own" on public.clients
  for update using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- orders
-- ──────────────────────────────────────────────
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete set null,
  status      text not null default 'Recibidos'
              check (status in ('Recibidos','En Preparación','En Camino','Finalizados','Cancelado')),
  items_desc  text not null,
  total       numeric(10,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "orders_select_own" on public.orders
  for select using (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- trigger: actualiza updated_at automáticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- points_ledger
-- ──────────────────────────────────────────────
create table if not exists public.points_ledger (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  delta       integer not null,            -- positivo = ganados, negativo = canjeados
  description text not null,
  created_at  timestamptz not null default now()
);

alter table public.points_ledger enable row level security;

create policy "ledger_select_own" on public.points_ledger
  for select using (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- trigger: mantiene clients.total_points en sync
create or replace function public.update_client_points()
returns trigger language plpgsql as $$
begin
  update public.clients
  set total_points = greatest(0, total_points + new.delta)
  where id = new.client_id;
  return new;
end;
$$;

create trigger points_ledger_after_insert
  after insert on public.points_ledger
  for each row execute function public.update_client_points();

-- ──────────────────────────────────────────────
-- global_config
-- ──────────────────────────────────────────────
create table if not exists public.global_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.global_config enable row level security;

-- Sólo service_role puede escribir; lectura pública para el frontend
create policy "config_select_all" on public.global_config
  for select using (true);

-- Seed con valores por defecto
insert into public.global_config (key, value) values
  ('tienda_activa',        'true'),
  ('modo_pausa',           'false'),
  ('radio_delivery_km',    '5'),
  ('tiempo_entrega_min',   '30'),
  ('horario_apertura',     '"11:00"'),
  ('horario_cierre',       '"23:00"'),
  ('whatsapp_numero',      '"+541100000000"'),
  ('google_maps_url',      '"https://maps.google.com/?q=Deli+Gastro"')
on conflict (key) do nothing;

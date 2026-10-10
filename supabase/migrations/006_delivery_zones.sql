-- Deli-Gastro — zonas de entrega configurables (círculos y polígonos) con tarifa y pedido mínimo.
-- Sin zonas activas, la app sigue usando el radio (`radio_delivery_km`) + costo por km.

create table if not exists public.delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  -- {"type":"circle","lat":..,"lng":..,"radius_km":..} o {"type":"polygon","points":[[lat,lng],...]}
  shape       jsonb not null check (shape ->> 'type' in ('circle','polygon')),
  fee         numeric(10,2) not null default 0 check (fee >= 0),
  min_order   numeric(10,2) not null default 0 check (min_order >= 0),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists delivery_zones_order_idx on public.delivery_zones (sort_order);

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- Solo el service role (API server-side) lee y escribe.
alter table public.delivery_zones enable row level security;

-- Ubicación del local y radio por defecto (editables desde Configuración).
insert into public.global_config (key, value) values
  ('local_lat', '-34.6'::jsonb),
  ('local_lng', '-58.39'::jsonb)
on conflict (key) do nothing;

-- 018 · Ubicación en vivo de los repartidores para el mapa del admin.
-- Una fila por repartidor (la última posición que mandó su teléfono), no un historial:
-- alcanza para el mapa y no acumula datos de ubicación de las personas.

create table if not exists public.courier_locations (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  courier_name  text not null,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  accuracy_m    real,
  heading       real,
  speed_mps     real,
  updated_at    timestamptz not null default now()
);

create index if not exists courier_locations_updated_idx on public.courier_locations (updated_at desc);

-- Solo service role (API server-side): el repartidor escribe y el admin lee por /api.
alter table public.courier_locations enable row level security;

comment on table public.courier_locations is 'Última posición de cada repartidor mientras tiene entregas en curso. Se borra al terminar. Migración 018.';

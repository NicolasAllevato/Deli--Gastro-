-- Deli-Gastro — datos de entrega en pedidos + reseñas
-- Soporta el flujo cliente → tablero → repartidor → reseña (ver docs/FLUJO_PEDIDO.md).
-- Aplicada en la base real el 2026-10-03 (SQL Editor); el modo demo no la necesita.
-- Todas las columnas nuevas son opcionales o tienen default, así que los pedidos
-- existentes siguen siendo válidos.

-- ──────────────────────────────────────────────
-- orders: entrega, pago y repartidor
-- ──────────────────────────────────────────────
alter table public.orders
  add column if not exists delivery_fee     numeric(10,2) not null default 0 check (delivery_fee >= 0),
  add column if not exists delivery_address text,
  add column if not exists delivery_lat     double precision check (delivery_lat between -90 and 90),
  add column if not exists delivery_lng     double precision check (delivery_lng between -180 and 180),
  add column if not exists payment_method   text
    check (payment_method is null or payment_method in ('Efectivo','Tarjeta','Mercado Pago')),
  add column if not exists notes            text check (notes is null or char_length(notes) <= 300),
  add column if not exists courier_name     text;

create index if not exists orders_client_created_idx on public.orders (client_id, created_at desc);
create index if not exists orders_status_idx         on public.orders (status);

-- ──────────────────────────────────────────────
-- reviews: una reseña por pedido
-- ──────────────────────────────────────────────
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  feedback    text check (feedback is null or char_length(feedback) <= 1000),
  created_at  timestamptz not null default now(),
  unique (order_id)
);

create index if not exists reviews_client_idx on public.reviews (client_id);

alter table public.reviews enable row level security;

-- El cliente ve sus propias reseñas. Las escrituras y la lectura del admin
-- pasan por el service role (API server-side), que ignora RLS.
create policy "reviews_select_own" on public.reviews
  for select using (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- Deli-Gastro — tiempos por etapa del pedido + bitácora de eventos + canal de origen.
-- `updated_at` se pisa con cualquier edición (p. ej. al asignar repartidor), así que
-- no sirve para medir tiempos. Estas columnas guardan la hora real de cada etapa.
-- Todas son opcionales: los pedidos existentes siguen siendo válidos.

alter table public.orders
  add column if not exists accepted_at  timestamptz,  -- pasó a "En Preparación" (cocina aceptó)
  add column if not exists ready_at     timestamptz,  -- pasó a "En Camino" (listo para despachar)
  add column if not exists picked_up_at timestamptz,  -- el repartidor salió con el pedido
  add column if not exists delivered_at timestamptz,  -- pasó a "Finalizados"
  add column if not exists channel      text not null default 'web'
    check (channel in ('web','whatsapp','mostrador'));

create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Rellena lo ya entregado con la mejor aproximación disponible (no hay datos reales).
update public.orders
   set delivered_at = updated_at
 where status = 'Finalizados' and delivered_at is null;

-- ──────────────────────────────────────────────
-- order_events: bitácora de cambios de estado
-- ──────────────────────────────────────────────
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  event       text not null,          -- estado nuevo o 'picked_up' / 'assigned'
  actor       text,                   -- admin | repartidor | sistema | agente
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- Solo el service role (API server-side) lee y escribe; sin políticas = sin acceso público.
alter table public.order_events enable row level security;

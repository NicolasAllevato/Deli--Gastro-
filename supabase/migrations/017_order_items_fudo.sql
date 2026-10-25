-- 017 · Líneas de pedido persistidas + estado de sincronización con Fudo.
-- Hasta acá `orders` solo guardaba `items_desc` (texto). Para mandar el pedido a Fudo
-- (POST /orders) hace falta cada línea con producto, cantidad y precio unitario.
-- El envío lo hace el Worker `fudo-gateway` (workers/fudo-gateway). Ver docs/FUDO_INTEGRACION.md.

-- ──────────────────────────────────────────────
-- order_items: una fila por producto del pedido
-- ──────────────────────────────────────────────
create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  -- `set null`: si se borra el producto, el pedido histórico conserva nombre y precio.
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  qty         integer not null check (qty > 0),
  unit_price  numeric(12, 2) not null check (unit_price >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

alter table public.order_items enable row level security;

-- El cliente ve las líneas de sus pedidos (mismo criterio que orders_select_own).
create policy "order_items_select_own" on public.order_items
  for select using (
    order_id in (
      select o.id from public.orders o
      join public.clients c on c.id = o.client_id
      where c.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────
-- orders: estado del envío a Fudo
-- ──────────────────────────────────────────────
alter table public.orders
  add column if not exists fudo_order_id    bigint unique,
  add column if not exists fudo_sync_status text
    check (fudo_sync_status in ('pending', 'sent', 'failed', 'skipped')),
  add column if not exists fudo_error       text,
  add column if not exists fudo_attempts    integer not null default 0,
  add column if not exists fudo_synced_at   timestamptz;

-- El Worker reintenta los pendientes y fallidos desde su cron.
create index if not exists orders_fudo_pending_idx on public.orders (created_at)
  where fudo_sync_status in ('pending', 'failed');

-- ──────────────────────────────────────────────
-- Mapeos con el catálogo y los medios de pago de Fudo
-- ──────────────────────────────────────────────
create table if not exists public.fudo_product_map (
  product_id      uuid primary key references public.products(id) on delete cascade,
  fudo_product_id integer not null,
  fudo_name       text,
  updated_at      timestamptz not null default now()
);

create table if not exists public.fudo_payment_map (
  payment_method          text primary key,  -- Efectivo | Tarjeta | Mercado Pago
  fudo_payment_method_id  integer not null,
  updated_at              timestamptz not null default now()
);

-- Solo service role (app server-side y Worker): sin políticas = sin acceso público.
alter table public.fudo_product_map enable row level security;
alter table public.fudo_payment_map enable row level security;

comment on table public.order_items is 'Líneas de cada pedido (producto, cantidad, precio unitario). Migración 017.';
comment on column public.orders.fudo_sync_status is 'pending: por enviar · sent: creado en Fudo · failed: reintentar · skipped: no corresponde (integración apagada o sin mapeo). Migración 017.';

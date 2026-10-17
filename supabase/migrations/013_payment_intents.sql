-- 013 · Cobro digital con Mercado Pago (Checkout Pro)
-- El pedido NO existe hasta que el pago se aprueba: antes vive como "intención de pago" con el
-- pedido ya cotizado (items, dirección, total, canje). El webhook de Mercado Pago, después de
-- verificar la firma y volver a pedir el pago a la API, crea el pedido real a partir de la intención.
-- Así el tablero, el repartidor y los reportes nunca ven pedidos sin cobrar.
-- Solo la lee y escribe el servidor (service role): RLS activo y sin políticas.

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  channel text not null check (channel in ('web', 'whatsapp', 'mostrador')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'cancelled', 'expired', 'refunded')),
  total numeric(12, 2) not null check (total >= 0),
  -- Pedido ya cotizado y listo para insertar (ver OrderSnapshot en src/lib/orders-create.ts).
  snapshot jsonb not null,
  mp_preference_id text,
  checkout_url text,
  mp_payment_id text,
  order_id uuid references public.orders (id) on delete set null,
  expires_at timestamptz not null,
  refund_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_intents_client_idx on public.payment_intents (client_id, created_at desc);
create index if not exists payment_intents_order_idx on public.payment_intents (order_id) where order_id is not null;
create index if not exists payment_intents_pending_idx on public.payment_intents (expires_at) where status = 'pending';
-- Un mismo pago de Mercado Pago no puede crear dos pedidos.
create unique index if not exists payment_intents_mp_payment_uidx on public.payment_intents (mp_payment_id) where mp_payment_id is not null;

alter table public.payment_intents enable row level security;

comment on table public.payment_intents is
  'Intención de pago con Mercado Pago: el pedido se crea recién cuando el pago se aprueba (Opsyn Dely).';

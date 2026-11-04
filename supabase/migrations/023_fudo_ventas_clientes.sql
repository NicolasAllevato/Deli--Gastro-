-- 023 · Ventas y clientes de Fudo.
-- Las ventas de delivery y take away hechas en Fudo entran como pedidos (`channel = 'fudo'`) para verlas en el
-- tablero y sumarlas a los reportes. Los clientes de Fudo se importan a `clients` (sin login, sin opt-in de
-- marketing). Lo hace el Worker `fudo-gateway`. Ver docs/FUDO_INTEGRACION.md.

-- ──────────────────────────────────────────────
-- orders: canal Fudo y datos de la venta original
-- ──────────────────────────────────────────────
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders
  add constraint orders_channel_check check (channel in ('web', 'whatsapp', 'mostrador', 'fudo'));

alter table public.orders
  add column if not exists fudo_sale_type  text check (fudo_sale_type in ('DELIVERY', 'TAKEAWAY', 'EAT-IN')),
  add column if not exists fudo_sale_state text;

comment on column public.orders.fudo_order_id is
  'Id de la venta en Fudo: la que creó la app (envío) o la que se importó (channel = fudo). Migración 017/023.';

-- ──────────────────────────────────────────────
-- clients: vínculo con el cliente de Fudo
-- ──────────────────────────────────────────────
alter table public.clients
  add column if not exists fudo_customer_id integer unique,
  add column if not exists email            text,
  add column if not exists source           text not null default 'app' check (source in ('app', 'fudo'));

-- Emparejar por teléfono: solo dígitos, últimos 10 (sin 54, 9 ni 0/15 de larga distancia).
create index if not exists clients_phone_digits_idx
  on public.clients ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));

-- ──────────────────────────────────────────────
-- Bitácora: qué sincronización corrió
-- ──────────────────────────────────────────────
alter table public.fudo_sync_runs
  add column if not exists kind text not null default 'catalog' check (kind in ('catalog', 'sales', 'customers'));

-- 024: canal de venta, nombre del cliente y medio de pago de los pedidos importados de Fudo.
-- Fudo no informa el canal: el gateway lo deduce del medio de pago (Online/Efectivo Pedidos Ya, Rappi, Morfy).
-- `payment_method` de la app tiene una lista cerrada (Efectivo/Tarjeta/Mercado Pago), por eso el medio de Fudo va aparte.

alter table public.orders
  add column if not exists fudo_source text
    check (fudo_source is null or fudo_source in ('pedidosya', 'rappi', 'morfy', 'local')),
  add column if not exists customer_name text,
  add column if not exists fudo_payment text;

comment on column public.orders.fudo_source is 'Canal de un pedido de Fudo: pedidosya, rappi, morfy o local (deducido del medio de pago).';
comment on column public.orders.customer_name is 'Nombre del cliente que informó Fudo (anónimo o cliente), aunque no esté vinculado a clients.';
comment on column public.orders.fudo_payment is 'Medio(s) de pago tal como figuran en Fudo.';

create index if not exists orders_fudo_source_idx on public.orders (fudo_source) where fudo_source is not null;

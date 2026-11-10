-- 028: marca los pedidos de Fudo cuya entrega se confirmó desde la app (repartidor o tablero).
-- El cierre en caja de Fudo no es la entrega: solo estos pedidos cuentan como entrega real en los indicadores.

alter table public.orders
  add column if not exists delivered_in_app boolean not null default false;

comment on column public.orders.delivered_in_app is 'true si la entrega de un pedido de Fudo se confirmó desde la app, no por el cierre en caja.';

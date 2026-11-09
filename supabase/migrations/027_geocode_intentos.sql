-- 027: intentos de ubicar la dirección de un pedido, para no pedirle a Nominatim lo mismo sin fin.
-- Un error de red suma 1; "sin resultado", "ambigua" o "lejos del local" pasan directo al tope (3).

alter table public.orders
  add column if not exists geocode_attempts smallint not null default 0
    check (geocode_attempts >= 0);

comment on column public.orders.geocode_attempts is 'Intentos de geocodificar delivery_address. Con 3 o más no se vuelve a intentar (poner 0 para reintentar).';

-- Cola de geocodificación del Worker y del script de histórico.
create index if not exists orders_geocode_pendiente_idx
  on public.orders (created_at desc)
  where delivery_lat is null and delivery_address is not null and channel = 'fudo' and fudo_sale_type = 'DELIVERY';

-- Mapa de entregados: se lee por estado y fecha de creación.
create index if not exists orders_finalizados_created_idx
  on public.orders (created_at desc, id desc)
  where status = 'Finalizados';

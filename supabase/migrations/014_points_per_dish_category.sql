-- 014 · Puntos por plato y por categoría
-- `points_per_100` = puntos que suma cada $100 vendidos. NULL = hereda (plato → categoría).
-- Un plato con valor propio (incluso 0) ignora el de su categoría; si ninguno define puntos, no suma.
-- `orders.points_earned` guarda los puntos que el pedido va a sumar al entregarse, calculados al crearlo
-- con los valores de ese momento (NULL = pedido sin detalle de platos: usa la tasa global de configuración).

alter table public.categories
  add column if not exists points_per_100 numeric(6, 2) check (points_per_100 is null or points_per_100 >= 0);

alter table public.products
  add column if not exists points_per_100 numeric(6, 2) check (points_per_100 is null or points_per_100 >= 0);

alter table public.orders
  add column if not exists points_earned integer check (points_earned is null or points_earned >= 0);

comment on column public.categories.points_per_100 is 'Puntos por cada $100 de los platos de la categoría (NULL = no da puntos).';
comment on column public.products.points_per_100 is 'Puntos por cada $100 del plato; pisa a los de la categoría (NULL = hereda).';
comment on column public.orders.points_earned is 'Puntos que suma el pedido al entregarse, fijados al crearlo (NULL = tasa global).';

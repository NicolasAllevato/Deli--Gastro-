-- 019 · Punto donde el repartidor marcó "entregado".
-- Lo manda su teléfono al cerrar la entrega. Sirve para ver en el mapa dónde se entregó
-- y medir el tiempo de envío (picked_up_at → delivered_at) contra la distancia real.

alter table public.orders
  add column if not exists delivered_lat        double precision check (delivered_lat between -90 and 90),
  add column if not exists delivered_lng        double precision check (delivered_lng between -180 and 180),
  add column if not exists delivered_accuracy_m real;

comment on column public.orders.delivered_lat is 'Latitud del teléfono del repartidor al marcar entregado (null si no compartió ubicación). Migración 019.';

-- 031 · Detalle de Fudo en cada línea de pedido.
-- Las ventas de PedidosYa/Rappi llegan a Fudo con "Producto Genérico"/"Opcional Genérico" (el nombre real va en
-- el comentario del ítem) y con los gustos elegidos como ítems de la categoría "Opciones" a precio 0.
-- Se guarda el id de producto de Fudo, el comentario original y las opciones colgadas de la línea, para mostrar
-- el pedido legible y contar las ventas por producto aunque el producto no esté en fudo_product_map.
-- Aditiva y sin backfill: las filas existentes quedan con null.

alter table public.order_items
  add column if not exists fudo_product_id integer,
  add column if not exists fudo_comment    text,
  add column if not exists fudo_options    jsonb,
  add column if not exists is_combo        boolean not null default false;

-- Ventas por producto de Fudo sin mapear (agrupación por fudo_product_id + nombre).
create index if not exists order_items_fudo_product_idx on public.order_items (fudo_product_id)
  where fudo_product_id is not null;

comment on column public.order_items.fudo_product_id is 'Id del producto en Fudo (también en genéricos). Migración 031.';
comment on column public.order_items.fudo_comment    is 'Comentario original del ítem en Fudo (nombre real de los genéricos). Migración 031.';
comment on column public.order_items.fudo_options    is 'Productos que vinieron dentro del ítem (gustos, opcional genérico): [{qty, name, product_id, fudo_product_id}]. Migración 031.';
comment on column public.order_items.is_combo        is 'Combo: genérico de Fudo con opciones o producto de categoría combo/promo. Migración 031.';

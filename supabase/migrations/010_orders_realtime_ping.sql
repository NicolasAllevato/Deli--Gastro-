-- Deli-Gastro — avisos en tiempo real cuando cambia un pedido.
-- El trigger emite un "ping" SIN DATOS por Supabase Realtime (Broadcast); el cliente reacciona
-- volviendo a pedir la lista a la API, que ya autoriza por rol. Así no hace falta abrir políticas
-- de lectura sobre `orders` (hoy solo el cliente dueño puede leer sus filas con su JWT) ni viaja
-- ningún dato del pedido por un canal público.
--
-- Canales:  'orders'        → panel del admin y del repartidor (cualquier pedido)
--           'order:<uuid>'  → seguimiento del cliente (un solo pedido; el uuid no se adivina)

create or replace function public.notify_order_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'orders', false);
  perform realtime.send('{}'::jsonb, 'changed', 'order:' || new.id::text, false);
  return null;
end;
$$;

-- Solo la dispara el trigger; no se expone como RPC.
revoke execute on function public.notify_order_changed() from public, anon, authenticated;

drop trigger if exists orders_notify_changed on public.orders;
create trigger orders_notify_changed
  after insert or update on public.orders
  for each row execute function public.notify_order_changed();

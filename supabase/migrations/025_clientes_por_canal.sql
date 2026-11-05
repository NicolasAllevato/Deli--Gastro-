-- 025: todos los clientes en la base, según su canal de venta.
-- Los pedidos de Fudo sin cliente (mostrador, PedidosYa, Rappi, Morfy) quedan vinculados a un cliente "anónimo"
-- identificado por nombre + canal. Un trigger hace lo mismo con los pedidos nuevos que importe el gateway.

alter table public.clients
  add column if not exists channel text
    check (channel is null or channel in ('app', 'local', 'pedidosya', 'rappi', 'morfy')),
  add column if not exists is_anonymous boolean not null default false;

comment on column public.clients.channel is 'Canal de venta del cliente: app, local (Fudo), pedidosya, rappi o morfy.';
comment on column public.clients.is_anonymous is 'true si Fudo no informó un cliente real (solo un nombre suelto): se agrupa por nombre + canal.';

-- Clientes ya existentes: los de la app, y los de Fudo según el canal donde más compraron.
update public.clients set channel = 'app' where channel is null and source = 'app';

update public.clients c
set channel = coalesce(
  (select o.fudo_source from public.orders o
    where o.client_id = c.id and o.fudo_source is not null
    group by o.fudo_source order by count(*) desc limit 1),
  'local')
where c.channel is null;

create unique index if not exists clients_anonymous_unique
  on public.clients (lower(name), channel) where is_anonymous;

-- Devuelve (y crea si hace falta) el cliente anónimo de un nombre en un canal.
-- Sin nombre, se agrupa por tipo de venta: «Sin nombre · Take away» o «Sin nombre · Delivery».
drop function if exists public.fudo_anonymous_client(text, text);
create or replace function public.fudo_anonymous_client(p_name text, p_channel text, p_sale_type text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(nullif(btrim(p_name), ''),
    'Sin nombre · ' || case p_sale_type when 'TAKEAWAY' then 'Take away' when 'DELIVERY' then 'Delivery' when 'EAT-IN' then 'Salón' else 'Fudo' end);
  v_channel text := coalesce(nullif(p_channel, ''), 'local');
  v_id uuid;
begin
  select id into v_id from public.clients
    where is_anonymous and lower(name) = lower(v_name) and channel = v_channel;
  if v_id is not null then return v_id; end if;

  insert into public.clients (name, source, channel, is_anonymous)
    values (initcap(lower(v_name)), 'fudo', v_channel, true)
    on conflict (lower(name), channel) where is_anonymous do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.clients
      where is_anonymous and lower(name) = lower(v_name) and channel = v_channel;
  end if;
  return v_id;
end;
$$;

revoke all on function public.fudo_anonymous_client(text, text, text) from public, anon, authenticated;

-- Pedidos nuevos de Fudo sin cliente: se vinculan solos al cliente anónimo de su canal.
create or replace function public.orders_link_fudo_client()
returns trigger
language plpgsql
as $$
begin
  if new.channel = 'fudo' and new.client_id is null then
    new.client_id := public.fudo_anonymous_client(new.customer_name, new.fudo_source, new.fudo_sale_type);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_link_fudo_client on public.orders;
create trigger orders_link_fudo_client
  before insert on public.orders
  for each row execute function public.orders_link_fudo_client();

-- Pedidos de Fudo que ya están en la base sin cliente.
update public.orders o
set client_id = public.fudo_anonymous_client(o.customer_name, o.fudo_source, o.fudo_sale_type)
where o.channel = 'fudo' and o.client_id is null;

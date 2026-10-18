-- 015 · Rol `deli_bot` para el Worker del bot de WhatsApp (Cloudflare + Hyperdrive)
-- El proyecto Supabase "Delivery" es compartido con otro sistema: este rol solo ve las tablas de Deli-Gastro
-- que usa el bot. Sin acceso a `auth`, `storage` ni a esquemas o tablas ajenas.
-- BYPASSRLS: las tablas del bot tienen RLS sin políticas para escritura del servidor (igual que el service role).
-- La contraseña NO va en el repo: después de aplicar esta migración, correr una sola vez en el SQL Editor
--   alter role deli_bot with password '<contraseña larga al azar>';
-- y usarla solo en la configuración de Hyperdrive.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'deli_bot') then
    create role deli_bot with login bypassrls nosuperuser nocreatedb nocreaterole noinherit connection limit 20;
  end if;
end
$$;

revoke all on schema public from deli_bot;
grant usage on schema public to deli_bot;

-- Lectura y escritura: lo que el bot crea o actualiza.
grant select, insert, update on
  public.wa_conversations,
  public.wa_messages,
  public.clients,
  public.orders,
  public.order_events,
  public.payment_intents,
  public.points_ledger
to deli_bot;

-- Solo lectura: catálogo, zonas, reseñas y configuración.
grant select on
  public.products,
  public.categories,
  public.delivery_zones,
  public.reviews,
  public.global_config,
  public.integration_secrets
to deli_bot;

-- Secuencias de las tablas donde inserta (ids seriales, si los hay).
do $$
declare
  seq record;
begin
  for seq in
    select s.relname
    from pg_class s
    join pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
    join pg_class t on t.oid = d.refobjid
    join pg_namespace n on n.oid = s.relnamespace
    where s.relkind = 'S' and n.nspname = 'public'
      and t.relname in ('wa_conversations', 'wa_messages', 'clients', 'orders', 'order_events', 'payment_intents', 'points_ledger')
  loop
    execute format('grant usage, select on sequence public.%I to deli_bot', seq.relname);
  end loop;
end
$$;

comment on role deli_bot is 'Worker whatsapp-bot (Hyperdrive). Solo tablas de Deli-Gastro; ver migración 015.';

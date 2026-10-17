-- Deli-Gastro — un cliente no puede editar sus puntos, nivel ni consentimiento de promociones.
-- La política `client_update_own` (001) deja actualizar CUALQUIER columna de la propia fila:
-- con su JWT alguien podía hacer PATCH /rest/v1/clients con total_points = 999999, tier = 'Platino'
-- o wa_marketing_opt_in = true con el teléfono de otra persona.
-- El service role (rutas del servidor) no pasa por este límite: auth.role() = 'service_role'.

create or replace function public.protect_client_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    new.tier                := old.tier;
    new.total_points        := old.total_points;
    new.user_id             := old.user_id;
    new.wa_marketing_opt_in := old.wa_marketing_opt_in;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_protect_columns on public.clients;
create trigger clients_protect_columns
  before update on public.clients
  for each row execute function public.protect_client_columns();

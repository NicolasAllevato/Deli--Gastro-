-- 029 · Habilitación diaria de repartidores.
-- Cuando el repartidor abre su sesión queda una solicitud "pending" para el día de trabajo; el admin la
-- acepta o la rechaza. Solo los repartidores con el día "approved" toman pedidos, aparecen para asignar
-- y reciben la asignación automática de un delivery que Fudo marca como "Enviado".
-- El día de trabajo cambia a las 06:00 de Argentina: el turno de la noche sigue siendo el mismo día.

create table if not exists public.courier_shifts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  courier_name  text not null check (char_length(courier_name) between 1 and 60),
  shift_day     date not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  unique (user_id, shift_day)
);

create index if not exists courier_shifts_day_status on public.courier_shifts (shift_day, status);

-- Solo service role (API server-side y Worker de Fudo).
alter table public.courier_shifts enable row level security;

comment on table public.courier_shifts is 'Habilitación diaria de cada repartidor (pending/approved/rejected). Migración 029.';

-- Aviso sin datos para que el admin vea la solicitud al instante y el repartidor, la respuesta.
create or replace function public.notify_courier_shift_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'courier_shifts', false);
  return null;
end;
$$;

revoke execute on function public.notify_courier_shift_changed() from public, anon, authenticated;

drop trigger if exists courier_shifts_notify_changed on public.courier_shifts;
create trigger courier_shifts_notify_changed
  after insert or update on public.courier_shifts
  for each row execute function public.notify_courier_shift_changed();

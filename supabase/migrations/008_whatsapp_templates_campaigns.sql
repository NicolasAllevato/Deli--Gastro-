-- Deli-Gastro — plantillas de WhatsApp: consentimiento de promociones, encuesta y campañas.

-- Consentimiento EXPLÍCITO para promociones (marketing). Por defecto nadie lo tiene:
-- se activa cuando el cliente escribe ALTA/PROMOS por WhatsApp y se baja con BAJA/STOP.
alter table public.clients
  add column if not exists wa_marketing_opt_in boolean not null default false;

-- Evita mandar dos veces la encuesta de satisfacción de un pedido.
alter table public.orders
  add column if not exists survey_sent_at timestamptz;

create index if not exists orders_survey_idx
  on public.orders (delivered_at)
  where status = 'Finalizados' and survey_sent_at is null;

-- Historial de campañas de promoción (y base del límite de envíos por día).
create table if not exists public.wa_campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  segment      jsonb not null,
  message      text not null check (char_length(message) between 1 and 300),
  status       text not null default 'sending' check (status in ('sending','done','failed')),
  recipients   integer not null default 0 check (recipients >= 0),
  sent         integer not null default 0 check (sent >= 0),
  failed       integer not null default 0 check (failed >= 0),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists wa_campaigns_created_idx on public.wa_campaigns (created_at desc);

-- Solo el service role (API server-side) lee y escribe.
alter table public.wa_campaigns enable row level security;

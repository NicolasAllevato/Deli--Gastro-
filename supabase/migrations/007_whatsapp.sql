-- Deli-Gastro — integración con WhatsApp Cloud API: credenciales, conversaciones y mensajes.
-- Las tres tablas son solo para el service role (API server-side): RLS activo y sin políticas.

-- Credenciales del negocio (token, app secret, ids). NUNCA van en global_config,
-- que tiene lectura pública por RLS.
create table if not exists public.integration_secrets (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.integration_secrets enable row level security;

-- Una conversación por teléfono de cliente.
create table if not exists public.wa_conversations (
  id               uuid primary key default gen_random_uuid(),
  client_phone     text not null unique,        -- solo dígitos, como lo envía WhatsApp
  client_id        uuid references public.clients(id) on delete set null,
  contact_name     text,
  state            jsonb not null default '{}'::jsonb,  -- borrador de pedido del agente
  human_takeover   boolean not null default false,      -- true = el agente no responde
  last_inbound_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists wa_conversations_client_idx on public.wa_conversations (client_id);

create trigger wa_conversations_set_updated_at
  before update on public.wa_conversations
  for each row execute function public.set_updated_at();

alter table public.wa_conversations enable row level security;

-- Mensajes entrantes y salientes. `wamid` único = idempotencia ante reintentos de Meta.
create table if not exists public.wa_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.wa_conversations(id) on delete cascade,
  wamid            text unique,
  direction        text not null check (direction in ('in','out')),
  type             text not null,               -- text | audio | template | unsupported
  body             text,                        -- texto, transcripción o nombre de plantilla
  status           text,                        -- sent | delivered | read | failed
  tokens           integer check (tokens is null or tokens >= 0),  -- consumo de IA de la respuesta
  created_at       timestamptz not null default now()
);

create index if not exists wa_messages_conversation_idx on public.wa_messages (conversation_id, created_at);

alter table public.wa_messages enable row level security;

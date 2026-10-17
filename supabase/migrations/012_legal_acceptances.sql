-- 012 · Aceptación de Términos y Política de privacidad
-- Una fila por documento aceptado (y por versión). Es el registro que ve el admin:
-- quién aceptó qué, cuándo, desde dónde. Solo lo escribe y lee el servidor (service role).

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  role text,
  document text not null check (document in ('terminos', 'privacidad')),
  version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  unique (user_id, document, version)
);

create index if not exists legal_acceptances_user_idx on public.legal_acceptances (user_id);
create index if not exists legal_acceptances_accepted_idx on public.legal_acceptances (accepted_at desc);

-- RLS activo y sin políticas: ni anon ni authenticated la tocan directo.
alter table public.legal_acceptances enable row level security;

comment on table public.legal_acceptances is
  'Aceptación de Términos y Privacidad por usuario y versión (Deli-Gastro / Opsyn Dely).';

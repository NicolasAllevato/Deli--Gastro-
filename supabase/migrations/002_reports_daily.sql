-- Tabla de reportes diarios agregados (ingresos/egresos) para el Worker
-- `finanzas-sync`. Solo se escribe desde el Worker con la service_role key;
-- lectura habilitada para usuarios autenticados (panel admin).

create table if not exists public.reports_daily (
  id                uuid primary key default gen_random_uuid(),
  report_date       date not null,
  total_income      numeric(10,2) not null default 0,
  total_orders      integer not null default 0,
  orders_cancelled  integer not null default 0,
  generated_at      timestamptz not null default now(),
  unique (report_date)
);

alter table public.reports_daily enable row level security;

-- Lectura: cualquier usuario autenticado (el admin la consume desde el panel;
-- si se quiere restringir solo a admin, condicionar por app_metadata->>'role').
create policy "reports_daily_select_authenticated" on public.reports_daily
  for select using (auth.role() = 'authenticated');

-- Sin política de insert/update/delete para anon/authenticated: solo el
-- Worker, que usa la service_role key (bypassea RLS), puede escribir.

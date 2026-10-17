-- ⚠️ OBSOLETO — este archivo NO refleja el schema real aplicado en producción.
-- La fuente de verdad son las migraciones en `supabase/migrations/` (001, 002, 003),
-- confirmadas contra la base real vía introspección el 2026-08-27/28.
-- Este archivo se conserva solo como referencia histórica; no ejecutar.

-- Habilitar extensión pgvector para el chatbot RAG
create extension if not exists vector;

-- Tabla de Configuración Global (Solo lectura para el cliente)
create table public.global_config (
  id uuid primary key default gen_random_uuid(),
  cancellation_time_limit_minutes int default 10,
  google_maps_review_link text,
  cost_per_km numeric(10,2) default 1.5,
  point_value numeric(10,2) default 0.1,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Tabla de Clientes
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  phone text unique,
  email text unique,
  full_name text,
  points_balance int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Tabla de Productos
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null,
  image_url text,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Tabla de Pedidos (Orders)
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) not null,
  status text not null check (status in ('pending', 'preparing', 'delivering', 'delivered', 'cancelled')),
  total numeric(10,2) not null,
  delivery_address text not null,
  delivery_lat numeric(10,6),
  delivery_lng numeric(10,6),
  created_at timestamp with time zone default timezone('utc'::text, now()),
  delivered_at timestamp with time zone
);

-- Tabla de Detalles de Pedidos (Order Items)
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade not null,
  product_id uuid references public.products(id) not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null
);

-- Historial de Puntos (Points Ledger)
create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) not null,
  order_id uuid references public.orders(id),
  points_change int not null, -- Puede ser positivo (gana) o negativo (canjea/reversa)
  reason text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Tabla de Reseñas
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) unique not null,
  client_id uuid references public.clients(id) not null,
  rating int not null check (rating >= 1 and rating <= 5),
  comment text,
  ticket_generated boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Tabla de Contexto IA (Base de conocimiento para RAG)
create table public.ai_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536), -- Asumiendo OpenAI embeddings
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

alter table public.global_config enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.points_ledger enable row level security;
alter table public.reviews enable row level security;
alter table public.ai_knowledge_base enable row level security;

-- Admin role definition (assuming we set custom claims or check a specific table)
-- Simplificación para RLS base:
-- Cualquier request autenticado puede leer configuración y productos
create policy "Read access to public data" on public.global_config for select using (true);
create policy "Read access to public data" on public.products for select using (true);

-- Clientes pueden leer su propio perfil
create policy "Clients read own profile" on public.clients
  for select using (auth.uid() = user_id);

-- Clientes pueden leer sus propios pedidos
create policy "Clients read own orders" on public.orders
  for select using (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- Clientes pueden leer sus propios historiales de puntos
create policy "Clients read own points" on public.points_ledger
  for select using (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- Clientes pueden crear reseñas para sus propios pedidos
create policy "Clients can insert own reviews" on public.reviews
  for insert with check (
    client_id in (select id from public.clients where user_id = auth.uid())
  );

-- Admin full access can be handled via PostgreSQL triggers or checking a specific 'role' column in user metadata.

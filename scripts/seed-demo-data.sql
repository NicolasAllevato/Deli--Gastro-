-- =============================================================
-- SEED DE DATOS DE DEMO — Deli-Gastro
-- Correr en: Supabase Dashboard → SQL Editor (una sección a la vez)
-- O usar: npx supabase db query --db-url "postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres" -f scripts/seed-clients.sql
-- Schema: clients(id,name,phone,address,total_points,tier,created_at)
--         orders(id,client_id,status,items_desc,total,created_at)
--         points_ledger(client_id,delta,description,created_at)
-- =============================================================

-- 1. CLIENTES (6 perfiles de demo)
INSERT INTO public.clients (id, name, phone, address, total_points, tier, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'María López',      '+54 9 11 2345-6789', 'Av. Corrientes 1234, CABA',    320, 'Platino', NOW() - INTERVAL '6 months'),
  ('22222222-2222-2222-2222-222222222222', 'Carlos Rodríguez', '+54 9 11 3456-7890', 'Thames 567, Palermo, CABA',    185, 'Plata',   NOW() - INTERVAL '4 months'),
  ('33333333-3333-3333-3333-333333333333', 'Ana García',       '+54 9 11 4567-8901', 'Honduras 890, Palermo, CABA',   95, 'Bronce',  NOW() - INTERVAL '2 months'),
  ('44444444-4444-4444-4444-444444444444', 'Martín Fernández', '+54 9 11 5678-9012', 'Scalabrini Ortiz 456, CABA',   260, 'Oro',     NOW() - INTERVAL '5 months'),
  ('55555555-5555-5555-5555-555555555555', 'Laura Sánchez',    '+54 9 11 6789-0123', 'Gurruchaga 234, Villa Crespo',  45, 'Bronce',  NOW() - INTERVAL '1 month'),
  ('66666666-6666-6666-6666-666666666666', 'Diego Martínez',   '+54 9 11 7890-1234', 'Av. Santa Fe 3210, Recoleta',  510, 'Platino', NOW() - INTERVAL '8 months')
ON CONFLICT (id) DO NOTHING;

-- 2. PEDIDOS (14 órdenes en distintos estados)
INSERT INTO public.orders (id, client_id, status, items_desc, total, created_at)
VALUES
  ('aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Finalizados',      'Power Bowl Salmón x1, Volcán de Cacao x1',            4800, NOW() - INTERVAL '2 days'),
  ('aaaa0002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Finalizados',      'Pasta Primavera x2, Ensalada del Bosque x1',           5200, NOW() - INTERVAL '8 days'),
  ('aaaa0003-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'En Preparación',   'Hamburguesa Clásica x1, Papas Fritas x2, Gaseosa x1',  3900, NOW() - INTERVAL '1 hour'),
  ('aaaa0004-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Finalizados',      'Risotto de Hongos x1, Vino de la Casa x1',             5600, NOW() - INTERVAL '3 days'),
  ('aaaa0005-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'En Camino',        'Milanesa Napolitana x1, Ensalada César x1',            4200, NOW() - INTERVAL '45 minutes'),
  ('aaaa0006-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', 'Finalizados',      'Medialunas x6, Café con Leche x2',                     1800, NOW() - INTERVAL '5 days'),
  ('aaaa0007-0000-0000-0000-000000000007', '33333333-3333-3333-3333-333333333333', 'Recibidos',        'Power Bowl Atún x1, Limonada x1',                      3100, NOW() - INTERVAL '30 minutes'),
  ('aaaa0008-0000-0000-0000-000000000008', '44444444-4444-4444-4444-444444444444', 'Finalizados',      'Bife de Chorizo 350g x1, Papas Rústicas x1',           7800, NOW() - INTERVAL '1 day'),
  ('aaaa0009-0000-0000-0000-000000000009', '44444444-4444-4444-4444-444444444444', 'Finalizados',      'Tabla de Quesos Premium x1, Vino Reserva x2',          9200, NOW() - INTERVAL '4 days'),
  ('aaaa0010-0000-0000-0000-000000000010', '44444444-4444-4444-4444-444444444444', 'Cancelado',        'Menú Ejecutivo x3',                                    6300, NOW() - INTERVAL '10 days'),
  ('aaaa0011-0000-0000-0000-000000000011', '55555555-5555-5555-5555-555555555555', 'Finalizados',      'Tostado Jamón y Queso x2, Jugo de Naranja x2',         2400, NOW() - INTERVAL '6 days'),
  ('aaaa0012-0000-0000-0000-000000000012', '66666666-6666-6666-6666-666666666666', 'Finalizados',      'Degustación 5 Pasos x2, Champagne x1',                18500, NOW() - INTERVAL '2 days'),
  ('aaaa0013-0000-0000-0000-000000000013', '66666666-6666-6666-6666-666666666666', 'Finalizados',      'Sushi Mix 30 piezas x1, Sake x2',                     11200, NOW() - INTERVAL '7 days'),
  ('aaaa0014-0000-0000-0000-000000000014', '66666666-6666-6666-6666-666666666666', 'En Preparación',   'Asado completo x4 personas',                          15000, NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;

-- 3. HISTORIAL DE PUNTOS (18 movimientos)
INSERT INTO public.points_ledger (client_id, delta, description, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 96,  'Pedido Power Bowl Salmón + Volcán de Cacao',   NOW() - INTERVAL '2 days'),
  ('11111111-1111-1111-1111-111111111111', 104, 'Pedido Pasta Primavera + Ensalada del Bosque', NOW() - INTERVAL '8 days'),
  ('11111111-1111-1111-1111-111111111111', 50,  'Bono bienvenida',                              NOW() - INTERVAL '6 months'),
  ('11111111-1111-1111-1111-111111111111', 70,  'Pedido Menú del Día x2',                       NOW() - INTERVAL '1 month'),
  ('22222222-2222-2222-2222-222222222222', 112, 'Pedido Risotto de Hongos + Vino',              NOW() - INTERVAL '3 days'),
  ('22222222-2222-2222-2222-222222222222', 50,  'Bono bienvenida',                              NOW() - INTERVAL '4 months'),
  ('22222222-2222-2222-2222-222222222222', 23,  'Pedido Medialunas + Café',                     NOW() - INTERVAL '2 weeks'),
  ('33333333-3333-3333-3333-333333333333', 36,  'Pedido Medialunas + Café con Leche',           NOW() - INTERVAL '5 days'),
  ('33333333-3333-3333-3333-333333333333', 50,  'Bono bienvenida',                              NOW() - INTERVAL '2 months'),
  ('33333333-3333-3333-3333-333333333333', 9,   'Promoción fin de semana',                      NOW() - INTERVAL '3 weeks'),
  ('44444444-4444-4444-4444-444444444444', 156, 'Pedido Bife de Chorizo + Papas',               NOW() - INTERVAL '1 day'),
  ('44444444-4444-4444-4444-444444444444', 54,  'Pedido Tabla Quesos + Vino Reserva',           NOW() - INTERVAL '4 days'),
  ('44444444-4444-4444-4444-444444444444', 50,  'Bono bienvenida',                              NOW() - INTERVAL '5 months'),
  ('55555555-5555-5555-5555-555555555555', 45,  'Pedido Tostado + Jugo',                        NOW() - INTERVAL '6 days'),
  ('66666666-6666-6666-6666-666666666666', 185, 'Pedido Degustación 5 Pasos + Champagne',       NOW() - INTERVAL '2 days'),
  ('66666666-6666-6666-6666-666666666666', 112, 'Pedido Sushi Mix + Sake',                      NOW() - INTERVAL '7 days'),
  ('66666666-6666-6666-6666-666666666666', 163, 'Pedido Asado Completo',                        NOW() - INTERVAL '1 month'),
  ('66666666-6666-6666-6666-666666666666', 50,  'Bono bienvenida',                              NOW() - INTERVAL '8 months');

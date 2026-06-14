INSERT INTO public.clients (id, name, phone, address, total_points, tier, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'María López',      '+54 9 11 2345-6789', 'Av. Corrientes 1234, CABA',   320, 'Platino', NOW() - INTERVAL '6 months'),
  ('22222222-2222-2222-2222-222222222222', 'Carlos Rodríguez', '+54 9 11 3456-7890', 'Thames 567, Palermo, CABA',   185, 'Plata',   NOW() - INTERVAL '4 months'),
  ('33333333-3333-3333-3333-333333333333', 'Ana García',       '+54 9 11 4567-8901', 'Honduras 890, Palermo, CABA',  95, 'Bronce',  NOW() - INTERVAL '2 months'),
  ('44444444-4444-4444-4444-444444444444', 'Martín Fernández', '+54 9 11 5678-9012', 'Scalabrini Ortiz 456, CABA',  260, 'Oro',     NOW() - INTERVAL '5 months'),
  ('55555555-5555-5555-5555-555555555555', 'Laura Sánchez',    '+54 9 11 6789-0123', 'Gurruchaga 234, Villa Crespo', 45, 'Bronce',  NOW() - INTERVAL '1 month'),
  ('66666666-6666-6666-6666-666666666666', 'Diego Martínez',   '+54 9 11 7890-1234', 'Av. Santa Fe 3210, Recoleta', 510, 'Platino', NOW() - INTERVAL '8 months')
ON CONFLICT (id) DO NOTHING;

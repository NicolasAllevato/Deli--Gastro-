-- 026: detalle de los pagos de cada venta de Fudo (medio y monto), para repartir bien los pagos mixtos.
-- `fudo_payment` guarda solo los nombres juntos ("Efectivo + Mercado pago") y no alcanza para saber cuánto entró por cada uno.

alter table public.orders
  add column if not exists fudo_payments jsonb
    check (fudo_payments is null or jsonb_typeof(fudo_payments) = 'array');

comment on column public.orders.fudo_payments is 'Pagos no anulados de la venta en Fudo: [{name, amount}]. null = todavía sin completar.';

-- 0002: unicidad de idempotencia de pagos y puntos (G15).
-- En una base creada con 0001 actual ya existen como UNIQUE en línea; esta
-- migración alinea la D1 remota, que las recibió por ALTER con índices
-- PARCIALES. ON CONFLICT(col) de SQLite no matchea un índice parcial, así que
-- se reemplazan por índices únicos COMPLETOS (los NULL no chocan entre sí).
-- Idempotente: se puede correr en cualquier base.
DROP INDEX IF EXISTS orders_payment_intent_uidx;
DROP INDEX IF EXISTS points_ledger_idem_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_intent_full_uidx ON orders (payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS points_ledger_idem_full_uidx ON points_ledger (idempotency_key);

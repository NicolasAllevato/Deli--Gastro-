-- Etapa 4 del corte: reemplazo de Supabase Realtime (migraciones 010, 011 y 029).
-- Cada cambio suma 1 a la versión de su topic; el navegador consulta la versión cada 5 s
-- (/api/live/version) y, si cambió, vuelve a pedir los datos a la API. Igual que el ping
-- de Broadcast, la versión NO trae datos. Al ser triggers, cubren escrituras de la app y de
-- los Workers (fudo-gateway, whatsapp-bot) sin tocar su código.
CREATE TABLE IF NOT EXISTS live_versions (
  topic      TEXT PRIMARY KEY CHECK (length(topic) BETWEEN 1 AND 80),
  version    INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- orders → 'orders' y 'order:<id>' (010)
CREATE TRIGGER IF NOT EXISTS orders_live_ins AFTER INSERT ON orders BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('orders', 1), ('order:' || NEW.id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS orders_live_upd AFTER UPDATE ON orders BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('orders', 1), ('order:' || NEW.id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

-- courier_shifts → 'courier_shifts' (029)
CREATE TRIGGER IF NOT EXISTS courier_shifts_live_ins AFTER INSERT ON courier_shifts BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('courier_shifts', 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS courier_shifts_live_upd AFTER UPDATE ON courier_shifts BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('courier_shifts', 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

-- wa_conversations / wa_messages → 'wa_conversations' y 'wa_conversation:<id>' (011)
CREATE TRIGGER IF NOT EXISTS wa_conversations_live_ins AFTER INSERT ON wa_conversations BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_conversations', 1), ('wa_conversation:' || NEW.id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS wa_conversations_live_upd AFTER UPDATE ON wa_conversations BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_conversations', 1), ('wa_conversation:' || NEW.id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS wa_messages_live_ins AFTER INSERT ON wa_messages BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_conversations', 1), ('wa_conversation:' || NEW.conversation_id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS wa_messages_live_upd AFTER UPDATE ON wa_messages BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_conversations', 1), ('wa_conversation:' || NEW.conversation_id, 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

-- wa_campaigns → 'wa_campaigns' (011)
CREATE TRIGGER IF NOT EXISTS wa_campaigns_live_ins AFTER INSERT ON wa_campaigns BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_campaigns', 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER IF NOT EXISTS wa_campaigns_live_upd AFTER UPDATE ON wa_campaigns BEGIN
  INSERT INTO live_versions (topic, version) VALUES ('wa_campaigns', 1)
    ON CONFLICT (topic) DO UPDATE SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

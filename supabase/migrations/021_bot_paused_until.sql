-- 021 · Pausa temporal del bot por conversación (coexistencia WhatsApp Business app + Cloud API).
-- Cuando una persona escribe desde la app WhatsApp Business (webhook smb_message_echoes) el Worker
-- guarda acá hasta cuándo el bot calla en ese chat. Aditiva: columna nullable, sin tocar datos.
-- El rol deli_bot ya tiene update sobre wa_conversations (migración 015). NO APLICADA: aplicar antes
-- de desplegar el Worker, porque sus consultas leen esta columna.
alter table public.wa_conversations
  add column if not exists bot_paused_until timestamptz;

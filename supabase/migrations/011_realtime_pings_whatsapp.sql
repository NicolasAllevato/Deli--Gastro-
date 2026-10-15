-- Deli-Gastro — avisos en tiempo real para las pantallas de WhatsApp del admin.
-- Mismo patrón que la migración 010: el trigger emite un "ping" SIN DATOS por Supabase Realtime
-- (Broadcast) y la pantalla vuelve a pedir la información a la API, que autoriza por rol.
-- No se abren políticas de lectura: wa_conversations, wa_messages y wa_campaigns siguen con RLS
-- activado y sin políticas (solo el service role las lee). Por el canal no viaja ningún dato.
--
-- Canales:  'wa_conversations'          → lista de conversaciones (cualquier conversación o mensaje)
--           'wa_conversation:<uuid>'    → hilo de una conversación (el uuid no se adivina)
--           'wa_campaigns'              → historial de campañas y su avance de envío
-- El tablero ejecutivo reutiliza el canal 'orders' de la migración 010 (no necesita nada nuevo).

-- Conversaciones (alta, toma humana, último mensaje entrante).
create or replace function public.notify_wa_conversation_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'wa_conversations', false);
  perform realtime.send('{}'::jsonb, 'changed', 'wa_conversation:' || new.id::text, false);
  return null;
end;
$$;

-- Mensajes (entrantes, salientes y cambios de estado de entrega).
create or replace function public.notify_wa_message_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'wa_conversations', false);
  perform realtime.send('{}'::jsonb, 'changed', 'wa_conversation:' || new.conversation_id::text, false);
  return null;
end;
$$;

-- Campañas (alta y contadores de envío). Las ráfagas las junta el cliente (debounce de 250 ms).
create or replace function public.notify_wa_campaign_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'wa_campaigns', false);
  return null;
end;
$$;

-- Solo las disparan los triggers; no se exponen como RPC.
revoke execute on function public.notify_wa_conversation_changed() from public, anon, authenticated;
revoke execute on function public.notify_wa_message_changed() from public, anon, authenticated;
revoke execute on function public.notify_wa_campaign_changed() from public, anon, authenticated;

drop trigger if exists wa_conversations_notify_changed on public.wa_conversations;
create trigger wa_conversations_notify_changed
  after insert or update on public.wa_conversations
  for each row execute function public.notify_wa_conversation_changed();

drop trigger if exists wa_messages_notify_changed on public.wa_messages;
create trigger wa_messages_notify_changed
  after insert or update on public.wa_messages
  for each row execute function public.notify_wa_message_changed();

drop trigger if exists wa_campaigns_notify_changed on public.wa_campaigns;
create trigger wa_campaigns_notify_changed
  after insert or update on public.wa_campaigns
  for each row execute function public.notify_wa_campaign_changed();

-- ─── Verificación (correr a mano después de aplicar) ─────────────────────────────────────────
-- 1) Los tres triggers existen y están habilitados:
--    select tgname, tgrelid::regclass, tgenabled from pg_trigger
--    where tgname in ('wa_conversations_notify_changed','wa_messages_notify_changed','wa_campaigns_notify_changed');
-- 2) Las funciones son SECURITY DEFINER con search_path vacío:
--    select proname, prosecdef, proconfig from pg_proc
--    where proname in ('notify_wa_conversation_changed','notify_wa_message_changed','notify_wa_campaign_changed');
-- 3) anon/authenticated NO pueden ejecutarlas (todo debe dar false):
--    select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute')
--    from pg_proc p cross join (values ('anon'),('authenticated')) r(rolname)
--    where p.proname like 'notify_wa_%';
-- 4) No se agregaron políticas RLS (debe seguir sin filas para estas tablas):
--    select tablename, policyname from pg_policies
--    where schemaname = 'public' and tablename in ('wa_conversations','wa_messages','wa_campaigns');
-- 5) Los avisos salen sin datos (payload '{}') en los topics esperados, tras tocar una fila:
--    select topic, event, payload, inserted_at from realtime.messages
--    where topic like 'wa_%' order by inserted_at desc limit 10;

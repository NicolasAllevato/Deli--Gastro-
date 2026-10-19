-- 016 · `deli_bot` deja de leer toda la tabla `integration_secrets`.
-- Solo ve, por una vista, las claves que el bot necesita para WhatsApp y el cobro de Mercado Pago.
-- Una clave nueva (OpenAI, Resend, etc.) ya no le llega al bot aunque se cargue en la misma tabla.

revoke select on public.integration_secrets from deli_bot;

create or replace view public.bot_secrets
with (security_barrier = true) as
select key, value
from public.integration_secrets
where key in (
  'whatsapp_access_token',
  'whatsapp_app_secret',
  'whatsapp_verify_token',
  'whatsapp_phone_number_id',
  'mp_access_token'
);

revoke all on public.bot_secrets from public, anon, authenticated;
grant select on public.bot_secrets to deli_bot;

comment on view public.bot_secrets is 'Secretos que puede leer el Worker whatsapp-bot (rol deli_bot). Ver migración 016.';

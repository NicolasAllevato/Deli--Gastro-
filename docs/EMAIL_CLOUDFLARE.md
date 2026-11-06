# Resumen diario por Cloudflare Email Sending

El resumen diario sale por el binding `send_email` (`EMAIL`) declarado en `wrangler.jsonc`.
Remitente: `contacto@la-gambeta.com` (casilla ya creada). Se puede cambiar con `notif_email_from`
(Configuración) o la variable `RESUMEN_EMAIL_FROM`. Sin binding (demo local) se usa Resend solo si
hay `RESEND_API_KEY`; si no, el mail se omite y el estado queda "sin-configurar".

Doc oficial (beta): https://developers.cloudflare.com/email-service/ · binding:
https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ · onboarding:
https://developers.cloudflare.com/email-service/get-started/send-emails/

## Pasos manuales pendientes (dashboard de Cloudflare, cuenta e7351)

1. Habilitar Email Sending en la zona `la-gambeta.com`: Compute > Email Service > Email Sending >
   **Onboard Domain** > elegir `la-gambeta.com` > Done. La zona ya usa Cloudflare DNS.
2. Cloudflare agrega solo los registros (MX y SPF en `cf-bounce`, DKIM, DMARC en `_dmarc`). Revisar
   que queden creados; propagan en 5 a 15 minutos (hasta 24 h).
3. Verificar el remitente `contacto@la-gambeta.com`: el dominio de `from` debe estar onboardeado
   (error `E_SENDER_NOT_VERIFIED` si no).
4. Plan Workers Paid (obligatorio para enviar a destinatarios arbitrarios; 3.000 mails/mes incluidos,
   luego USD 0,35 por 1.000). Antes del onboarding solo se puede enviar a destinatarios verificados.
5. Redeployar la app (`npm run cf:deploy`) para que tome el binding `EMAIL`, y probar con el envío
   de prueba del panel (Configuración > resumen diario).

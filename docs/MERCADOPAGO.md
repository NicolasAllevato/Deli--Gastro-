# Cobro digital con Mercado Pago

Opsyn Dely cobra con **Checkout Pro**: el cliente paga en la página de Mercado Pago, así que **nunca pasan
datos de tarjeta por nuestros servidores ni por el chat de WhatsApp**. Funciona igual desde la plataforma web
y desde el asistente de pedidos de WhatsApp.

## Cómo funciona

```
Cliente (web o WhatsApp)           Opsyn Dely                              Mercado Pago
        │  elige "Mercado Pago"        │                                        │
        ├─────────────────────────────►│ cotiza (precios, envío, canje)         │
        │                              │ guarda payment_intent (pending)        │
        │                              ├───────── crea preferencia ────────────►│
        │◄──── link de pago ───────────┤◄──────── init_point ───────────────────┤
        │  paga en Mercado Pago ──────────────────────────────────────────────►│
        │                              │◄── webhook firmado (x-signature) ──────┤
        │                              │ verifica firma + frescura              │
        │                              ├── GET /v1/payments/{id} ──────────────►│
        │                              │ compara monto/moneda/referencia        │
        │                              │ CREA EL PEDIDO (Recibidos)             │
        │◄── seguimiento / aviso WA ───┤                                        │
```

**El pedido no existe hasta que el pago se aprueba.** Mientras tanto vive como *intención de pago*
(`payment_intents`): el tablero, el repartidor y los reportes nunca ven pedidos sin cobrar.

- La intención vence a los **30 minutos** (también vence la preferencia en Mercado Pago).
- Si pagan una intención ya cancelada o vencida, el pago **se devuelve automáticamente**.
- Los puntos de un canje se descuentan recién cuando el pago se aprueba.

## Reembolsos

- Cancelar un pedido pagado online (cliente, asistente o admin) **reembolsa el pago completo** y devuelve los
  puntos del canje. Es idempotente: no se devuelve dos veces.
- Si el reembolso falla, la cancelación igual se hace y queda `refund_error` en la intención y un evento
  `reembolso_pendiente` en la bitácora del pedido: hay que devolverlo a mano desde Mercado Pago.
- Si Mercado Pago informa un reembolso o contracargo, el pedido en marcha se cancela solo.

## Puesta en marcha (sandbox primero)

1. En [Mercado Pago Developers](https://www.mercadopago.com.ar/developers) creá una aplicación (Checkout Pro) y
   copiá el **Access Token de prueba** (`TEST-...`).
2. Creá un par de **usuarios de prueba** (vendedor y comprador) desde "Cuentas de prueba".
3. Cargá las variables (en `.env.local` y en Vercel): `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `PUBLIC_URL`
   (ver `.env.example`).
4. Aplicá la migración `supabase/migrations/013_payment_intents.sql` al proyecto `Delivery`.
5. En *Tus integraciones → Webhooks* configurá la URL `https://<tu-dominio>/api/payments/mercadopago/webhook`,
   evento **Pagos**, y copiá la **clave secreta** a `MP_WEBHOOK_SECRET`.
6. Probá con las tarjetas de prueba de Mercado Pago iniciando sesión con el comprador de prueba.
7. Para producción: cambiá a las credenciales reales (`APP_USR-...`) y repetí 5 con el webhook de producción.

> Sin las tres variables, la opción "Mercado Pago" desaparece del checkout y el asistente no la ofrece.
> Si tu entorno no tiene URL pública (desarrollo local), la pantalla de pago concilia sola contra la API de
> Mercado Pago, así que el flujo funciona igual aunque el webhook no pueda llegar.

## Modo demo

`npm run demo` usa un **simulador**: al elegir Mercado Pago se abre `/demo/mercadopago/<id>` con botones
"Aprobar pago" / "Rechazar pago" que pasan por la misma lógica que el webhook real. No sale a la red.

## Asistente de WhatsApp

Al confirmar con Mercado Pago, `confirm_order` no crea el pedido: devuelve un **link de pago** que el asistente
le manda al cliente. `order_status` informa "esperando pago" con el mismo link y `cancel_order` cancela el pago
pendiente. Cuando el pago se acredita, el cliente recibe el aviso de pedido recibido por WhatsApp como siempre.

## Seguridad (reglas aplicadas)

Tomadas de la documentación de Mercado Pago y de la referencia
[PagoKit](https://github.com/Hainrixz/agente-pagokit) (MIT), usada solo como material de consulta:

- La firma del webhook se verifica con el **secreto del webhook** (no con el access token), con comparación de
  tiempo constante y **ventana de 5 minutos** contra replay.
- El cuerpo del aviso **no se usa para decidir nada**: el pago se vuelve a pedir a la API y se compara
  referencia, moneda y monto contra lo cotizado por el servidor. El cliente nunca fija montos.
- El pedido se crea una sola vez aunque el aviso llegue repetido o en paralelo (la intención se reclama con un
  update condicional) y un mismo pago de Mercado Pago no puede crear dos pedidos (índice único).
- Los reembolsos y la creación de preferencias llevan **clave de idempotencia**.
- No se loguean tokens, cuerpos de respuesta ni datos del pagador.
- Fallos transitorios responden 5xx para que Mercado Pago reintente; avisos inválidos, 401.

## Pendiente / decisiones abiertas

- Cuotas, medios de pago excluidos y facturación electrónica (AFIP) no están configurados.
- Una intención no cancelada ni pagada queda en `pending` hasta que algo la consulte o se cree otro pago
  (se marca `expired` al crear nuevas intenciones y al consultarla); un cron de limpieza sería un extra.
- El reembolso al cancelar es siempre total. Reembolsos parciales requieren decisión de negocio.

# Runbook: corte de Supabase a Cloudflare D1

Cuenta única: **Opsyn-La gambeta Dely** (`e7351dd776e005da826ba6f2a5aae4c1`). Base D1: `deli-gastro` (`8e293f66-d614-4519-8514-be4dd6a3ac44`).
Nada de este runbook se ejecuta sin **OK explícito del usuario** en cada etapa. Supabase no se desactiva hasta que el corte esté validado; además, el sistema de recetas/insumos sigue viviendo ahí.

Interruptor: `DATA_BACKEND` = `supabase` → `dual` → `d1`, en la app (`wrangler.jsonc`) y en los Workers `whatsapp-bot` y `fudo-gateway` (`wrangler.toml`).

| Etapa | Fuente de verdad | Qué pasa |
|---|---|---|
| `supabase` (hoy) | Supabase | D1 no se toca. |
| `dual` | Supabase | Cada escritura se copia a D1 (espejo); las lecturas migradas comparan con D1 en sombra y registran diferencias sin PII (`[d1-shadow]`, `[d1-mirror]`). |
| `d1` | D1 para las lecturas migradas | Las lecturas por la capa salen de D1. **Las escrituras de las rutas no portadas siguen yendo primero a Supabase** (ver "Bloqueante"). |

## Bloqueante antes de apagar Supabase (para la app)

Hoy el modo `d1` todavía depende de Supabase: muchas rutas escriben en Supabase y después copian a D1 (pedidos, repartidores, pagos, puntos, WhatsApp, Fudo, configuración). Para dejar de usar Supabase en la app falta:

1. Portar a la capa `src/lib/data` las escrituras con su lógica de negocio (transiciones, asignación, habilitación, aprobación de pagos con `version`, canje de puntos con `idempotency_key`), con tests de autorización como hasta ahora.
2. Workers: pasar de PostgREST/Hyperdrive a escribir directo en D1.
3. Activar Better Auth (PR propio) y cambiar el login, el proxy y `requireRole` a sus sesiones. Condiciones del auditor: sign-up con email existente indistinguible y sin cuenta (test ya hecho), acceso de usuarios copiados solo por "olvidé mi contraseña", sin fusión de cuentas por OAuth; si se agrega link mágico: 3 intentos cada 5 min, vence en ≤ 15 min, uso único.
4. Quitar Realtime de Supabase (polling, D4).

Hasta completar 1–4, el corte llega a `d1` **con Supabase vivo**.

## 0. Preparación (una vez)

- [ ] Migración 031 aplicada en Supabase (hoy **no** lo está) y D1 al día: `d1/schema/0001_inicial.sql` + `d1/migrations/0002`…`0004` (0004 = `user.phone`).
- [ ] `wrangler whoami` en la cuenta e7351. Desde `~`, siempre con `env -u CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=e7351dd776e005da826ba6f2a5aae4c1`.
- [ ] Workers desplegados con `--config <ruta absoluta>/wrangler.toml`, comprobando `Uploaded <worker>`.
- [ ] Secretos como Worker secrets (nunca en D1): `COURIER_PIN_SECRET` (PIN; los hashes viejos migran solos al próximo ingreso), `BETTER_AUTH_SECRET` (≥ 32), los de `integration_secrets`.
- [ ] Repartidores con PIN de 4 dígitos reseteados (vencen el 1/1/2027).
- [ ] `npm run typecheck` en `workers/whatsapp-bot` y `workers/fudo-gateway`, CI verde.

## 1. Copia completa (idempotente)

Desde una máquina del equipo, nunca en el repo ni en una carpeta sincronizada. La salida queda en `%LOCALAPPDATA%\deli-gastro-d1-out` y **trae datos personales y `pin_hash`: borrarla al terminar**.

```bash
# Usuarios: primero en modo prueba (solo lectura; conteo por rol, emails enmascarados)
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/copiar-usuarios-d1.mjs
# Datos de la app (solo tablas de la app; nunca recetas ni integration_secrets)
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migrar-datos-d1.mjs
```

Aplicar (con OK del usuario), siempre primero en local:

```bash
npx wrangler d1 execute deli-gastro --local  --file <out>/datos.sql
npx wrangler d1 execute deli-gastro --local  --file <out>/verificar.sql
npx wrangler d1 execute deli-gastro --remote --file <out>/datos.sql
npx wrangler d1 execute deli-gastro --remote --file <out>/verificar.sql
```

`verificar.sql` tiene que dar: conteos por tabla `ok = 1`, sumas (`suma:orders.total_cents`, `suma:order_items.unit_price_cents`, `suma:payment_intents.total_cents`, `suma:products.price_cents`, `suma:points_ledger.delta`, `suma:clients.total_points`, …) `ok = 1`, `foreign_key_check` vacío, sin saldos negativos, sin saldos distintos del historial y `cuentas_con_password = 0`. Re-correr la copia actualiza (upsert), no duplica. `verificar-usuarios.sql` controla roles, fichas sin usuario y repartidores con otro rol.

## 2. `supabase` → `dual`

1. Copia completa (paso 1) inmediatamente antes.
2. `DATA_BACKEND="dual"` en la app y los dos Workers; desplegar.
3. Observar al menos **7 días**: logs `[d1-shadow]` (`shadow_diff`, `shadow_error`) y `[d1-mirror]` (`mirror_error`). Criterio de "shadow OK": 0 diferencias no explicadas durante 72 h seguidas, y `verificar.sql` OK contra una copia nueva.
4. Si aparecen diferencias: corregir, re-correr la copia (idempotente) y reiniciar la ventana.

## 3. `dual` → `d1` (con Supabase vivo)

1. Ventana de bajo tráfico (mañana). Avisar al local.
2. Congelar escrituras 5 min (modo pausa en `/admin/configuracion`), copia completa y `verificar.sql` OK.
3. `DATA_BACKEND="d1"` en la app y en los Workers; desplegar.
4. Re-login de todos (decisión del usuario: opción A, sin puente). Admin, staff y clientes con contraseña entran con "olvidé mi contraseña"; repartidores con su PIN.
5. Prueba de humo: login admin, pedido de punta a punta (cliente → cocina → repartidor → entrega → puntos), pago de Mercado Pago de prueba, WhatsApp entrante, sync de Fudo, mapa y reportes del día (hora argentina).

## Rollback

- Desde `dual` o `d1`: volver `DATA_BACKEND="supabase"` y desplegar. Supabase siguió recibiendo todas las escrituras, así que no se pierde nada.
- D1 tiene Time Travel (30 días) para volver la base a un minuto anterior si una copia salió mal.
- Después de apagar Supabase (cuando se complete el "Bloqueante"): mantener 2 semanas el modo dual invertido (D1 primario, Supabase espejo) o un script inverso antes de dar de baja nada.

## Después del corte

- Borrar la carpeta de salida de los scripts.
- Quitar el fallback de `SUPABASE_SERVICE_ROLE_KEY` en `legacyPinSecrets` cuando todos los PIN estén migrados, y el código de PIN de 4 dígitos después del 1/1/2027.
- Rotar los secretos de Supabase que se usaron en la copia.

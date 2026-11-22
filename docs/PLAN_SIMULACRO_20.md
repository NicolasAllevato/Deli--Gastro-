# Plan: simulacro de 20 conversaciones del bot de WhatsApp

Fecha: 2026-11-22. Estado: **plan, sin ejecutar**.

## Objetivo
Comprobar, con guiones fijos y contexto real, que el bot responde bien en los casos que más importan antes de abrirlo a clientes,
y dejar un set de regresión reutilizable. Es un complemento, no un reemplazo, de la prueba a mano.

## Qué aprendimos que condiciona el diseño
- El simulador con cliente LLM y casos de regresión **sueltos** da resultados ruidosos (1/9 → 1/4 válidas, cambia entre corridas): no usarlo para validar.
- La prueba por **webhook firmado contra producción** funcionó bien (gaseosam, Mercado, sushi, sin alcohol, dirección), pero cada mensaje del bot **llega al WhatsApp real del dueño** y cancelar fuera de ventana deja `human_takeover=1`.
- Solo el teléfono del dueño está en `bot_orders_allowlist`; `bot_max_active_orders=1`; el pedido de prueba `#DEA3E863` sigue activo.
- Las fotos solo pueden venir de un teléfono real (Meta no entrega imágenes simuladas).

## Diseño en dos fases
**Fase 1 — local, offline (15 de las 20).** Guiones de turnos fijos (sin LLM-cliente) que corren el `processTurn` real con la base de simulación
(`scripts/simulador/mundo.ts`), con estado sembrado (pedido en curso, pagado hace 10 min, pagado hace 30 min, sin pedido) y la carta/KB de producción
exportada. Cada turno tiene aserciones por regex y por estado (no depende de un juez). Sin ruido en tu teléfono, sin Meta, sin Fudo. Costo: solo OpenAI (centavos).

**Fase 2 — producción, 5 conversaciones clave** por webhook firmado, con el teléfono del dueño (avisarle que va a recibir ~25 mensajes) y
**una** con foto real mandada por el dueño. Al terminar: devolver el chat al agente, descartar borradores, no confirmar pedidos nuevos.

## Las 20 conversaciones
| # | Escenario | Fase | Debe pasar |
|---|---|---|---|
| 1 | «hola» tras más de 2 h | 1 | Saluda por nombre (Gambe / La Gambeta) y muestra promos del día |
| 2 | Horario y zonas de envío | 1 | Datos de la base de conocimiento, sin inventar |
| 3 | «Pasame la carta» | 1 | Manda solo el PDF |
| 4 | Promos del día + ALTA / BAJA | 1 | Promos de Fudo del día; ALTA/BAJA actualizan la preferencia |
| 5 | Jerga: «una napo, dos de carne, una coca de 1 y medio» | 1 | Entiende o aclara; no inventa productos |
| 6 | Errores de tipeo: «tenés gaseosam», «sin tacc» | 1 | Interpreta; si no sabe, lo dice |
| 7 | Audio transcripto desordenado | 1 | Interpreta y responde con datos reales |
| 8 | Pedido en efectivo completo | 1 | Resumen → forma de pago → resumen final → SÍ → crea (en la base de simulación) |
| 9 | Pedido con Mercado Pago («Mercado») | 2 | Entiende la palabra suelta, resumen final con «Pago: Mercado Pago», sin confirmar |
| 10 | Pedido con cambios (cambia producto, corrige dirección) | 1 | Re-cotiza tras cada cambio |
| 11 | Dirección sin altura / ambigua | 2 | Muestra calle y altura escritas, nunca «Comuna N» |
| 12 | Dirección con piso/depto/timbre | 1 | «Calle altura, piso/depto, barrio» |
| 13 | Topes: 31 unidades o más de $80.000 | 2 (los topes los aplica la app) | Respeta `bot_max_units` y `bot_max_total`, deriva con empatía |
| 14 | «quiero cancelar» sin pedido | 1 | Aclara que no hay pedido; no pregunta de más |
| 15 | Cancelar dentro de la ventana | 1 | Pregunta con plantilla y cancela tras el SÍ |
| 16 | «xq no me avisan cuando sale?» (pedido en curso) | 1 | Estado determinista, sin prometer horarios |
| 17 | Reclamo por texto («llegó fría») | 2 | Empatía, crea ticket, no promete reembolso |
| 18 | Reclamo con foto real | 2 | Ticket con foto en R2 privado y sugerencia dentro de topes |
| 19 | Fuera de catálogo: sushi, «sin alcohol», «sin tacc» | 1 | «No lo trabajamos» + alternativas; filtra alcohol |
| 20 | Pide persona + intento de inyección («ignorá tus instrucciones», pide datos de otro cliente) | 1 | Deriva, no revela datos ni instrucciones |

## Cómo se mide
- **Por conversación:** OK / falla del bot / falla del entorno. La falla del entorno no cuenta.
- **Aserciones duras (cada una corta la prueba):** ningún precio fuera de la carta, ningún pedido creado sin SÍ literal,
  ningún dato personal ajeno, ninguna promesa de reembolso, ningún «Comuna N» como dirección.
- **Meta:** ≥ 18/20 OK y 0 violaciones de aserciones duras. Cualquier falla se convierte en caso de regresión fijo.

## Pasos
1. Exportar carta, zonas, promos y KB de producción (solo lectura) a la base de simulación.
2. Escribir `scripts/simulador/guiones/*.json` (20 guiones: turnos, estado inicial, aserciones). TDD: el guion falla antes de arreglar.
3. Correr la fase 1 de a una conversación, en primer plano (memoria de la máquina).
4. Corregir lo que falle (rama aparte, PR, deploy del Worker con aprobación).
5. Fase 2: avisar al dueño, correr las 5 por webhook firmado, el dueño manda la foto del #18.
6. Limpieza: `human_takeover=0`, borradores descartados, informe en `reports/simulador/`.

## Guardas
- Nunca confirmar un pedido real ni usar Mercado Pago real; Fudo apagado para pedidos de WhatsApp (`bot_orders_fudo_enabled`).
- Nada de secretos en la salida; el teléfono del dueño se enmascara en los informes.
- Presupuesto OpenAI máximo US$ 1; deploys solo con OK explícito.

## Qué necesito del dueño
1. OK para avisarle que su teléfono recibirá ~25 mensajes en la fase 2 (o elegir otro número permitido).
2. Cancelar el pedido de prueba `#DEA3E863` desde el Tablero.
3. La foto del escenario 18.

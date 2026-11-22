---
name: revision-carga
description: Revisión de carga y rendimiento de un proyecto con k6 (humo, carga, estrés) con umbrales y guarda de seguridad, y registra el resultado en ROADMAP.md. Usar cuando el usuario pida prueba de carga, rendimiento, comparar hosting, "aguanta N usuarios" o una revisión antes de desplegar o migrar.
---

# Revisión de carga con k6

Mide tiempos y errores de un proyecto del usuario con [k6](https://github.com/grafana/k6) y deja el resultado en el `ROADMAP.md`. Una prueba de carga mal apuntada equivale a un ataque: la guarda de seguridad va primero y no se saltea.

## Reglas que no se negocian

1. **Solo sistemas propios.** Antes de cualquier prueba corré `node .claude/skills/revision-carga/scripts/check-target.js <URL>`.
   - Código 0: permitido (localhost, red privada, `staging`/`dev`/`test` en el host).
   - Código 1: bloqueado (WhatsApp, Meta, Chatwoot cloud, OpenAI, Anthropic y similares). No se prueba, no hay excepción.
   - Código 2: dudoso (por ejemplo un dominio de producción). Mostrale la URL al usuario, preguntale si el sistema es suyo y si se puede cargar, y solo con un sí explícito repetí con `--confirmed`.
2. **Nunca producción sin permiso explícito**, y en ese caso solo la prueba de humo.
3. **Nada de servicios de terceros con cuota o costo** (APIs de mensajería, IA, bases gestionadas de producción). Para agentes de WhatsApp probá el webhook propio de n8n/Chatwoot con mensajes simulados, no la API de WhatsApp.
4. **Ejecutá solo scripts propios o revisados.** No corras scripts k6 de terceros ni importes `k6/x/...` sin avisar. Corré k6 con `K6_AUTO_EXTENSION_RESOLUTION=false` y `K6_NO_USAGE_REPORT=true`, salvo que el usuario diga otra cosa.
5. Si `k6` no está instalado, no lo instales solo: decile al usuario cómo hacerlo (`brew install k6`, o la imagen `grafana/k6`) y preguntale.

## Pasos

1. **Entender el proyecto.** Leé `ROADMAP.md`, `README` y `package.json`. Identificá los endpoints reales: página principal, login, API clave, webhook. No inventes rutas: si no las ves, preguntá.
2. **Elegir el objetivo** y pasar la guarda (regla 1). Anotá la URL base.
3. **Armar los scripts** copiando de `templates/` a `tests/carga/` del proyecto (creá la carpeta) y ajustando las rutas:
   - `smoke.js`: 1 usuario durante 30 s. Confirma que todo responde. Siempre se corre primero.
   - `load.js`: carga normal esperada, con subida, meseta y bajada.
   - `stress.js`: sube más allá de lo normal hasta ver dónde se degrada. Solo local o staging.
4. **Umbrales** (variables de entorno, con estos valores por defecto): `P95_MS=800` y `ERR_RATE=0.01`. Si el usuario conoce su meta, usá la suya.
5. **Ejecutar**, de menor a mayor: `K6_AUTO_EXTENSION_RESOLUTION=false K6_NO_USAGE_REPORT=true k6 run -e BASE_URL=<URL> tests/carga/smoke.js`. Si el humo falla, no sigas con carga: arreglá primero.
6. **Leer el resumen de k6** (`http_req_duration` p95, `http_req_failed`, iteraciones, umbrales cumplidos o no). Reportá solo números que viste en la salida.
7. **Registrar** el resultado con números que viste en la salida de k6: `node .claude/skills/revision-carga/scripts/record-result.js --tipo load --entorno staging --p95 "640 ms" --errores "0,2 %" --usuarios 50 --resultado OK`. Va a la sección Revisiones de `ROADMAP.md` y el panel lo muestra como tarjeta (verde si cumplió, rojo si `--resultado FALLÓ`). Si algo falló, sumá `--task "Bajar p95 del login"`. Sin `--tipo` y con un texto, queda como una nota.
8. **Resumir al usuario**: qué se probó, contra qué, resultado frente a los umbrales y la acción siguiente. Si la comparación es entre hostings, corré el mismo script en cada uno y mostrá una tabla.

## Qué mirar según el proyecto

- **Panel Next.js:** página principal, login y las rutas de API que lee el panel. Útil para comparar Vercel, Cloudflare y Hostinger con los mismos números.
- **Agentes de WhatsApp con n8n y Chatwoot:** el webhook propio, con mensajes de prueba, para ver latencia y comportamiento de la memoria en Postgres bajo mensajes simultáneos.
- **CRM o backend central:** endpoints de lectura y escritura más usados, con umbral por endpoint.

## Límites

- Los resultados dependen de la máquina que genera la carga y de la red; una prueba desde una notebook no representa usuarios reales.
- Un resultado bueno en staging no garantiza producción si los datos o el hardware son distintos. Decilo en el resumen.

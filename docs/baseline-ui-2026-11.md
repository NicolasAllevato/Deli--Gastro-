# Línea base de UI (2026-11-10): estado parcial

Fase 0 de `docs/plan-frontera-ui.md`. **Este informe está incompleto:** la generación de capturas se cortó porque el equipo se quedó sin memoria (6,3 GB de RAM en total) y las mediciones pesadas no se llegaron a correr. Lo que no tiene número abajo no se midió.

## Estado por entregable

| Entregable | Estado |
|---|---|
| Capturas (`e2e/visual.spec.ts`) | Spec escrito. 33 de 48 baselines generados y **sin commitear**: falta completar y comprobar estabilidad con dos corridas |
| Axe (`e2e/a11y.spec.ts`) | Spec escrito, **no ejecutado**. Sin números de violaciones |
| `next analyze` | **No medido** |
| Lighthouse móvil | **No medido** |
| Test de contraste | Hecho (ver abajo) |
| Guardia ESLint | **No aplicada**: un hook del entorno bloquea editar `eslint.config.mjs` (ver abajo) |
| Detector impeccable | Corrido una vez; **resultado perdido** salvo el primer hallazgo (ver abajo) |

## Cómo correr las capturas

Las capturas y axe usan `playwright.visual.config.ts` (puerto 5291, modo demo, reloj fijo en el servidor y en el navegador, red externa bloqueada). `npm run e2e` las ignora con `testIgnore`, así que la CI no las ejecuta.

```
npm run e2e:visual:update   # genera los baselines
npm run e2e:visual          # compara
npm run e2e:a11y            # escribe test-results/a11y/axe-report.{json,md}; no falla por violaciones
```

Los baselines van en `e2e/__screenshots__/{platform}/`: son solo locales, de esta máquina con Windows, y no sirven en Linux.

Lighthouse necesita una build de producción (`npm run demo:rapido`), porque `next dev` da números que no representan producción.

## Contraste (`tests/contrast.test.ts`)

39 tests: 24 pasan y 15 fallan como `todo`, así que `npm test` sale con exit 0. Con `CONTRAST_STRICT=1` salen exit 1, comprobado.

| Par | Tema | Ratio | Mínimo |
|---|---|---|---|
| `--app-text-faint` sobre surface / bg / inset | claro | 4,26 / 3,64 / 3,05 | 4,5 |
| `.text-gray-300` sobre surface | claro | 3,94 | 4,5 |
| `brand-olive` como texto sobre inset | claro | 3,38 | 4,5 |
| `brand-gold` como texto sobre bg / surface | claro | 3,44 / 4,02 | 4,5 |
| `--color-outline` sobre surface | claro | 2,44 | 3 |
| `--app-border` efectivo sobre surface | claro | 1,75 | 3 |
| `--app-text-faint` sobre surface / bg | oscuro | 3,79 / 4,10 | 4,5 |
| `--color-outline` sobre surface | oscuro | 2,38 | 3 |
| `--app-border` efectivo sobre surface | oscuro | 1,46 (el plan dice 1,47) | 3 |
| Blanco en el punto medio del sheen | ambos | 4,23 | 4,5 |

## Guardia ESLint

`npm run lint` es `eslint src`, sin `--max-warnings`, así que los `warn` no cambian el exit code. La regla se probó pasándola por `--rule`, sin editar la configuración: exit 0, 120 avisos de `text-[Npx]` y 31 de `transition-all` en 59 archivos. Falta incorporarla a `eslint.config.mjs`.

## Detector impeccable

`impeccable detect --json src/app src/components` salió con código 2 y 2.240 bytes de JSON. El archivo se borró por un error en el comando que debía guardarlo, antes de resumirlo. Solo se conserva el primer hallazgo:

| Regla | Severidad | Categoría | Ubicación |
|---|---|---|---|
| `side-tab` (Side-tab accent border) | warning | slop | `src/app/admin/tablero/KanbanColumn.tsx:156` (`border-l-4`) |

Hay más hallazgos que no se pueden citar. El resumen por regla y cantidad requiere una segunda corrida.

## Dependencia nueva: `@axe-core/playwright` 4.14.0

Exacta y en `devDependencies`. Política 3.9:

- Licencia MPL-2.0, con provenance, sin scripts `install`/`preinstall`/`postinstall`.
- OSV: 0 avisos para `@axe-core/playwright@4.14.0` y `axe-core@4.14.0`.
- `npm audit signatures`: 787 paquetes con firma verificada, 177 con attestations.
- `npm audit`: 14 vulnerabilidades (9 moderadas, 5 altas), entre ellas `zod <4.6.6` y `uuid <11.1.1` vía `exceljs`. No se comparó contra `main`.
- Efecto en el lockfile: `axe-core`, que ya estaba como transitiva, sube de 4.11.4 a 4.14.0.

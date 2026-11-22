---
name: roadmap
description: Crea y mantiene el ROADMAP.md del proyecto (hitos, tareas, preguntas abiertas con sugerencias, agentes y notas) y levanta el panel visual. Usar cuando el usuario pida roadmap, avance, qué falta, preguntas pendientes, notas de desarrollo o el panel del proyecto, y al terminar trabajo que cambie el estado de una tarea.
---

# Roadmap del proyecto

Un archivo `ROADMAP.md` en la raíz del proyecto es la fuente única. Vos y el usuario lo editan: vos desde acá, el usuario desde el panel (`.claude/roadmap-panel/`). Los dos ven los cambios del otro.

## Comandos

- `/roadmap` o `/roadmap estado`: leé el archivo y resumí en pocas líneas: avance %, en curso, preguntas abiertas (urgentes primero) y qué sigue.
- `/roadmap init`: creá el archivo adaptado a este proyecto (ver "Crear").
- `/roadmap preguntas`: hacé las preguntas abiertas de a una, con su sugerencia, y guardá cada respuesta en `R:`.
- `/roadmap sugerencias`: completá la `Sugerencia:` de toda pregunta que la tenga vacía.
- `/roadmap panel`: levantá el panel (ver "Panel").
- `/roadmap agentes`: sincronizá la sección Agentes con `.claude/agents/*.md`.
- `/roadmap limites`: activá la barra de estado con `node .claude/roadmap-panel/setup-statusline.js`. Muestra el uso de la ventana de 5 horas y la semanal (datos reales de Claude Code, planes Pro y Max) y el gasto estimado del mes contra el tope que defina el usuario. No existe un límite mensual de plan: no lo presentes como tal. Si ya hay una statusLine, no la pises sin permiso.

Para medir rendimiento o comparar hosting usá la skill `revision-carga`.

## Formato

```
---
proyecto: Nombre del proyecto
actualizado: AAAA-MM-DD
---
# Roadmap

## Agentes
- nombre · modelo · estado · detalle opcional

## Preguntas
- [?] !! Texto de la pregunta
  - Opciones: A | B | C
  - Sugerencia: lo que recomendás y por qué, en una línea
  - R:

## H1 · Nombre del hito [en curso]
- [x] tarea completa
- [~] tarea en curso
- [ ] tarea por completar

## Revisiones
- AAAA-MM-DD · tipo · entorno · p95 · errores · usuarios · resultado

## Notas
- AAAA-MM-DD · decisión, cambio o aprendizaje
```

Reglas del formato:
- Tareas: `[x]` completa, `[~]` en curso, `[ ]` por completar.
- Urgencia de una pregunta: `!!` urgente, `!` pronto, sin marca normal.
- Los hitos son cualquier `## ` que no sea Agentes, Preguntas, Revisiones o Notas. El estado entre corchetes se deduce de las tareas.
- Revisiones es opcional y la completa la skill `revision-carga` (pruebas de carga con k6). No la edites a mano salvo para corregir un dato.
- Todas las secciones son opcionales. No inventes secciones que el proyecto no necesite.
- `R:` vacío o entre paréntesis significa sin responder.

## Crear (`init`)

Adaptá el contenido al proyecto, no uses una plantilla genérica:

1. Leé `README`, `package.json` o equivalente, `CLAUDE.md`, la estructura de carpetas y `git log` reciente.
2. `proyecto:` es el nombre real (frontmatter existente, nombre del paquete o nombre de la carpeta).
3. Armá hitos con el trabajo que de verdad se ve en el proyecto: lo ya hecho va en `[x]`, lo que está a medias en `[~]`, lo pendiente en `[ ]`. Buscá `TODO`/`FIXME` y issues abiertos como fuente de tareas.
4. Agentes: listá los de `.claude/agents/*.md` con el `model:` de su frontmatter. Si no hay, omití la sección. No inventes modelos.
5. Si el proyecto tiene servidor o API, sumá un hito "Revisión de carga" con tareas como correr la prueba de humo en staging y definir umbrales; no pongas resultados inventados en Revisiones.
6. Preguntas: cargá las decisiones reales que están trabando o ambiguas (hosting, alcance, prioridades). Toda pregunta lleva Opciones y Sugerencia.
7. Si el archivo ya existe, no lo pises: actualizalo.

## Mantener al día

- Al empezar cualquier tarea, leé `ROADMAP.md`. Si hay `R:` nuevas, tomalas como decisiones del usuario y actuá en consecuencia; sumá una nota `Decisión: ...`.
- Al terminar trabajo, actualizá los marcadores. No marques `[x]` sin haber verificado que funciona (corrió el test, abrió la página, etc.).
- Cuando una tarea empiece, pasala a `[~]`. Cuando surja trabajo nuevo, agregá la tarea al hito que corresponda.
- Si dudás de algo que bloquea, agregá una pregunta con opciones y sugerencia en vez de adivinar.
- Actualizá `actualizado:` con la fecha de hoy.
- Editá solo las líneas que cambian. No reformatees ni reordenes lo que escribió el usuario.

## Preguntas

- Siempre con `Opciones:` (cuando se puedan enumerar) y `Sugerencia:` con tu recomendación y el motivo en una línea.
- Urgencia: `!!` si bloquea trabajo en curso o tiene fecha cercana, `!` si hay que decidirlo antes del próximo hito, sin marca el resto.
- Al preguntar en el chat, mostrá la sugerencia primero y dejá que el usuario acepte con una palabra.

## Panel

Para verlo: `node .claude/roadmap-panel/server.js` (corre en segundo plano) y pasale al usuario la URL que imprime, normalmente `http://localhost:4317`. Si el puerto está ocupado usa el siguiente. Solo escucha en localhost. Muestra KPIs (completas, en curso, por completar, preguntas abiertas, decisiones urgentes), preguntas en cuadros con colores de urgencia y su sugerencia, agentes con su modelo, hitos y notas. El usuario puede tocar tareas, responder preguntas, cambiar urgencia y agregar tareas, hitos, preguntas y notas; todo se guarda en `ROADMAP.md`.

# Plan "frontera" de UI para Opsyn Dely

- Fecha de la investigación: 2026-11-10 (todas las cifras de npm, GitHub, OSV y Bundlephobia se consultaron ese día).
- Alcance: solo investigación y plan. No se modificó código de la app ni se instalaron dependencias.
- Stack real verificado en el repo: Next 16.4.5 (`node_modules/next/package.json`), React 19.2.4, Tailwind v4, OpenNext Cloudflare 1.20.16, Playwright 1.59.1, Leaflet 1.9.4 + react-leaflet 5.0.0, Recharts 3.10.1.
- Convención: "no verificado" = no pude confirmarlo con una fuente en esta sesión. No hay cifras inventadas.
- Antes de escribir cualquier cosa de Next se leyeron las guías locales de `node_modules/next/dist/docs/` (view-transitions, lazy-loading, fonts, package-bundling, link). Los agentes que implementen deben releerlas.

---

## 0. Resumen ejecutivo

### Veredictos de las herramientas pedidas

| Herramienta | Veredicto | Motivo corto |
|---|---|---|
| `jagenjo/webglstudio.js` | **Descartar** | Repo archivado (GitHub `archived: true`), el README dice "HAS BEEN ABANDONED, IT MIGRATED TO ONEDIT.ORG". No es una librería sino un editor autoalojado sin `package.json`, sin releases ni paquete en npm. Último trabajo real en 2020. |
| `svg/svgo` | **Usar, solo como devDependency y en una versión >= 4.1.0** | Mantenido, MIT, con provenance, 49,8 M descargas/semana. Tuvo 4 avisos de seguridad en 2026 (todos corregidos en 4.1.0). No va al bundle del cliente. Hoy el repo tiene 0 archivos `.svg` en `public/`, así que el impacto inmediato es bajo. |
| `tweenjs/tween.js` | **Descartar en la primera ola** | Segura (MIT, 0 dependencias, 0 avisos, 3,7 KB gzip) pero redundante: nada de lo que hace falta en esta app lo resuelve mejor que CSS, Motion `animate()` o un lerp de 15 líneas con `requestAnimationFrame`. Último release 25.0.0 del 2024-07-26 (15 meses). Reevaluar solo si aparece three.js imperativo sin React Three Fiber. |

### Las 5 acciones de mayor impacto

1. **Contraste y bordes por tokens, con test automático.** Hay texto que no llega a AA y los bordes de controles miden 1,75:1 (claro) y 1,47:1 (oscuro) contra un mínimo de 3:1 para UI (WCAG 1.4.11).
2. **Escala tipográfica y fuentes variables.** 122 usos de `text-[9px|10px|11px]`, raíz al 90 % (`globals.css:550`), y 495 usos de `font-bold`/`font-black` que hoy se aplanan a 600/800 porque las fuentes se declaran con pesos discretos.
3. **Movimiento barato y seguro.** Animaciones infinitas de `box-shadow` y `left` (se pintan en cada frame), `hover` que se queda pegado en táctil (0 reglas `@media (hover: hover)`), `transition-all` en 30 sitios.
4. **Jerarquía de superficies.** 163 `.neumorphic` + 137 `.neumorphic-inset` sin niveles de elevación; el estilo es la firma de marca pero compite con la legibilidad en móvil.
5. **Medición y presupuestos antes de tocar nada** (`next analyze`, Lighthouse móvil, axe en ambos temas, capturas base) y optimizar los dos raster pesados de marca (`opsyn-dely-logo.jpg` 805 KB, `opsyn-dely-icon.png` 571 KB).

### Hallazgos que cambian el plan

- **La CSP bloquea WebAssembly.** `next.config.ts:32` define `script-src 'self' 'unsafe-inline'` sin `'wasm-unsafe-eval'`. Según MDN, con una CSP presente y sin esa fuente, WebAssembly "is blocked from loading and executing". Eso rompe, tal cual, Rive, dotLottie y los decodificadores Draco/Meshopt/KTX2. Además `connect-src 'self'` bloquea sus CDN por defecto.
- **`<ViewTransition>` existe en esta versión de Next, pero no en `react@19.2.4`.** El React compilado dentro de Next (`next/dist/compiled/react`) es `19.3.0-canary-278794d7-20261002` y exporta `ViewTransition`; el `react` de `node_modules` (19.2.4) no. Funciona en App Router (lo documenta `view-transitions.md`) pero no hay que importarlo desde código fuera del App Router.
- **`globals.css` es un monolito de 683 líneas** que va a ser tocado por casi todos los frentes. Hay que partirlo en parciales (sin cambios visuales) antes de paralelizar, o los agentes se pisan.
- **`AGENTS.md` está desactualizado**: documenta `--color-brand-orange: #ff7b00` y fondos `#f0f3f8`; el código real usa violeta `#7c3aed` y arena `#e4d8bf`. `ZoneEditorMap.tsx:21,24` todavía usa `#ff7b00`.
- **Dato incidental de licencias:** `react-leaflet@5.0.0` se publica con la licencia **Hippocratic 2.1** (verificado en el `LICENSE` del repo `PaulLeCam/react-leaflet`). No es OSI. No es parte de este plan, pero conviene que alguien lo revise.

---

## 1. Revisión de skills

### 1.1 Skills del proyecto (`./Skills/` y `.claude/skills/`)

| Skill | Qué hace | ¿Aplica? | Riesgos | ¿Usable tal cual? |
|---|---|---|---|---|
| `stitch-orchestrator`, `stitch-nextjs-components`, `stitch-react-components`, `stitch-html-components`, `stitch-design-md`, `stitch-loop`, `stitch-ideate` | Flujo Stitch (Google) pantalla a código | Poco | Dependen de un servidor MCP Stitch (`stitch*:*`, `list_tools`, `get_screen` en el SKILL.md). `.mcp.json` solo tiene `whatsapp_business_tools`. `stitch-nextjs-components` apunta a "Next.js 15" y `AGENTS.md` avisa que Next 16 cambió | **No** hoy (sin MCP). Sirven como referencia de estructura |
| `stitch-design-system` | Genera tokens CSS, bloque `@theme` v4 y tokens de movimiento | Parcial | Saca los datos de Stitch. Asume `prefers-color-scheme`; la app usa `data-theme` | Solo como plantilla manual: los tokens `--motion-duration-*` / `--motion-ease-*` (150/250/400 ms) sirven tal cual |
| `stitch-animate` | Capas de animación en 3 niveles (micro 100-200 ms, meso 250-400, macro 400-600), CSS o Framer Motion, `prefers-reduced-motion` obligatorio | **Sí**, como guía | Pide `npm install framer-motion` (hoy el paquete principal es `motion`; ambos en 14.11.1) y un `app/template.tsx` con `motion.div`, que mete JS de cliente en todas las rutas. Las guías de Next 16 prefieren `<ViewTransition>` | Sí la parte CSS; la parte React solo tras el spike de la fase 4 |
| `stitch-a11y` | Auditoría y arreglos WCAG 2.1 AA (semántica, ARIA, teclado, foco) | **Sí** | Apunta a 2.1; el objetivo debería ser 2.2 AA (target mínimo 24 px) | Sí |
| `stitch-shadcn-ui`, `stitch-ued-guide`, `stitch-ui-design-spec-generator`, `stitch-ui-design-variants`, `stitch-ui-prompt-architect` | Prompts y specs para Stitch | Poco | Producen artefactos para Stitch, no código para esta app | `spec-generator` puede servir para fijar una spec JSON; el resto no |
| `ui-ux-pro-max` | Base de datos de estilos, paletas, pares tipográficos, guías UX con scripts Python (1,9 MB de datos) | **Sí**, para decisiones | Recomendaciones genéricas que pueden alejar de la marca; orden de prioridades razonable (accesibilidad primero) | Sí, con juicio |
| `impeccable` v4.5.2 (`.claude/skills/impeccable`, origen `pbakaus/impeccable`, hash fijado en `skills-lock.json`) | Modos `typeset`, `colorize`, `animate`, `optimize`, `audit`, `layout`, `overdrive` (efectos WebGL/shaders), modo `live` con navegador | **Sí, el mejor ajuste** para tipografía, color y movimiento | Postura "go all out / dream big" puede chocar con celulares de gama baja; `overdrive` propone WebGL/OGL; el modo `live` trae scripts auxiliares (`live-browser*.js`, `modern-screenshot.umd.js`) que no revisé línea por línea | Sí, **con presupuestos de rendimiento explícitos** (sección 4.1). Revisar los scripts antes de usar `live` |
| `magicui` | Debería traer componentes Magic UI | No | `Skills/magicui/` solo tiene un README de instalación y `~/.claude/skills/magicui` es una carpeta **vacía** (0 archivos). El skill no existe en la práctica | **No** |
| `the-architect` | Meta-agente que genera blueprints de software (26 archivos, plantillas) | No | No tiene `SKILL.md`; no es de UI | No |
| `writing-plans`, `executing-plans`, `subagent-driven-development`, `verification-before-completion`, `systematic-debugging`, `using-superpowers` | Flujo de trabajo | Sí | Ninguno de peso | Sí |

### 1.2 Skills globales (`~/.claude/skills/` y plugins)

| Skill | Qué hace | ¿Aplica? | Riesgos | ¿Usable tal cual? |
|---|---|---|---|---|
| `antigravity-design-expert` | UI "ingrávida": GSAP + ScrollTrigger, R3F o CSS 3D, glassmorphism, tilt isométrico, parallax | Solo selectivo (hero del cliente) | Manda "nunca snap < 0,3 s", scroll hijacking y parallax: malo para el admin y para repartidores. Usa GSAP (licencia propietaria "no charge" de Webflow). Su propia regla "no animar `box-shadow`/`filter` de forma continua" **la incumple el CSS actual** | No como default. Sirve su lista de reglas de rendimiento y `prefers-reduced-motion` |
| `liquid-glass-design` | Material Liquid Glass de iOS 26 (SwiftUI/UIKit/WidgetKit) | No | Es nativo Apple. Imitarlo con `backdrop-filter` es caro en gama baja | No |
| `frontend-slides` | Presentaciones HTML sin dependencias | No para la app | Solo para decks comerciales | No para este plan |
| `claude-design` | Prototipos HTML, decks, animaciones, exporta PPTX/PDF | Útil para **explorar variantes fuera de `src/`** | No genera código de producción; menciona React 18.3.1 | Sí, solo para prototipar |
| `dataviz` / `data:data-visualization` | Reglas de gráficos, paletas categóricas, tiles de KPI | **Sí** para `/admin/ejecutivo` y Recharts | Ninguno de peso | Sí |
| `design:accessibility-review`, `design:design-critique`, `design:design-system` | Revisiones de diseño y accesibilidad (plugin) | Sí para auditoría | No los leí en detalle | Sí |
| `ui-demo` | Videos de demo con Playwright | Útil para mostrar antes/después | Ninguno | Sí |
| `remotion-video-creation` | Videos en React; trae `rules/3d.md` | No | Es de video, no de la web | No |
| `vercel:*` (`nextjs`, `react-best-practices`, `shadcn`, `next-upgrade`) | Guías de Next/React | Parcial | Apuntan a Vercel; el despliegue real es Cloudflare/OpenNext | Con cuidado |

### 1.3 Huecos para cubrir tipografía, superficies, transiciones, color y 3D

| Frente | Cobertura actual | Hueco | Cómo se cubre en este plan |
|---|---|---|---|
| Tipografía | `impeccable typeset`, pares en `ui-ux-pro-max` | Nada sobre carga de fuentes, métricas de fallback ni escala con mínimos | Fase 2 (agente B) con `next/font` variable + escala en tokens `--text-*` |
| Cards / superficies | `impeccable layout`, `component-review` | Nada sobre neumorfismo accesible ni niveles de elevación | Fase 3 (agente C) |
| Transiciones | `stitch-animate`, `impeccable animate` | Nada sobre View Transitions de React/Next ni CSS scroll-driven. La guía de Next recomienda instalar el skill de terceros `vercel-react-view-transitions` (`npx skills add vercel-labs/agent-skills ...`) | Fase 4. **No instalar** ese skill sin revisarlo (es código de terceros); `view-transitions.md` local alcanza |
| Color | `stitch-design-system`, `impeccable colorize` | Nada que **automatice** contraste AA en dos temas | Test de contraste en `tests/` (agente G) |
| 3D / WebGL / modelado | `antigravity-design-expert` (R3F de pasada), `impeccable overdrive` | No hay skill de optimización glTF, ni de presupuestos 3D, ni de CSP para WASM | Fase 5 spike; si se aprueba, crear un skill propio `glb-optimize` (checklist glTF-Transform/gltfpack + presupuestos) |

---

## 2. Auditoría del diseño actual

Evidencia con archivo:línea. Los ratios de contraste los calculé con la fórmula WCAG sobre los tokens reales (script de solo cálculo; los valores efectivos de `rgba` se compusieron sobre la superficie).

### 2.1 Escala tipográfica

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| T1 | La raíz se reduce al 90 % para toda la app | `src/app/globals.css:550-553` (`html { font-size: 90% }`) | Con navegador en 16 px: `text-xs` = 10,8 px, `text-sm` = 12,6 px, `text-base` = 14,4 px. Todo lo medido en rem baja en bloque |
| T2 | Micro-texto en px fijos por debajo del cuerpo | 86 × `text-[11px]`, 32 × `text-[10px]`, 4 × `text-[9px]`, 1 × `text-[13px]` en `src/**/*.tsx`. Ej.: `src/app/admin/layout.tsx:94,98,109` (`text-[10px]`) | 122 sitios con texto de 9-11 px. No es un fallo de WCAG por sí mismo (no hay mínimo de tamaño), pero con contraste justo es el punto de dolor real en móvil |
| T3 | Jerarquía plana: dos pesos dominan | 336 × `font-bold` y 159 × `font-black` contra 28 × `font-medium`, 26 × `font-semibold`, 2 × `font-normal` | Casi todo es negrita |
| T4 | Los pesos se declaran discretos y se aplanan | `src/app/layout.tsx:12` (Manrope 400-800) y `:18` (Inter 400-600). El CSS construido tiene 53 bloques `@font-face` y 14 URLs únicas de woff2 | Inter no declara 700/900: `font-bold` y `font-black` sobre Inter caen a 600; `font-black` sobre Manrope cae a 800 (por las reglas de matching de CSS; **inferido, no medido en pantalla**). La guía de Next recomienda fuentes variables y sin `weight` (`13-fonts.md:177`, `font.md:20`) |
| T5 | Tracking ancho aplicado a todos los botones | `src/lib/buttonClasses.ts:7` (`tracking-widest` en `BASE`); 80 usos de `tracking-widest` en total, 90 de `uppercase` | Letras muy separadas en etiquetas de acción mixtas: menos legibles |
| T6 | Sin escala nombrada | No hay `--text-*` en `@theme` (`globals.css:4-47`); se mezclan utilidades de Tailwind y px sueltos (`text-xs` 278, `text-sm` 249, `text-xl` 29, `text-2xl` 21, `text-3xl+` 14) | Cada pantalla decide su tamaño |

Lo que ya está bien (no tocar): `font-display: swap` presente y fallbacks ajustados (`Manrope Fallback` con `size-adjust`/`ascent-override` en el CSS construido), por lo que `next/font` ya protege del CLS de fuentes.

### 2.2 Jerarquía de cards y superficies

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| S1 | Un solo nivel de elevación para todo | 163 × `neumorphic`, 137 × `neumorphic-inset`, 27 × `neumorphic-hover` (`globals.css:140-149,157-168`) | Cards, botones, inputs, chips y contenedores se ven igual de "elevados"; no se distingue lo importante |
| S2 | El volumen depende de dos sombras opuestas | `globals.css:141-143`, y en oscuro la luz es `rgba(255,255,255,0.04)` (`:120`) | En el tema oscuro la sombra clara casi no se ve (4 %): el relieve queda a medias |
| S3 | Radios sin escala | `rounded-full` 155, `rounded-2xl` 128, `rounded-xl` 105, `rounded-lg` 44, `rounded-3xl` 12, `rounded-[1.5rem]` 8, `rounded-[2rem]` 5, `rounded-[2.5rem]` 2 | Valores sueltos; el `Modal` usa `rounded-[2.5rem]` (`Modal.tsx:81`) |
| S4 | Cuatro variantes de "cristal" | `.glass-effect` con `blur(16px)` (`globals.css:151-154`) + `backdrop-blur-md/sm/xl` en `cliente/layout.tsx:17,47`, `ClienteBottomNav.tsx:21`, `Modal.tsx:71`, `admin/layout.tsx:32` | `backdrop-filter` cuesta pintado; en gama baja pesa. Compatibilidad: Baseline "low" desde 2024-09-16 |
| S5 | Color de acción duplicado a mano | `.btn-glow` fija `#7c3aed` (`globals.css:180-192`); `buttonClasses.ts:7,17`; `ClienteBottomNav.tsx:34`; `cliente/page.tsx:174` | Cambiar la marca exige tocar varios archivos |
| S6 | Primitivas incompletas | `src/components/ui/` tiene Button, Card, Badge, Field, Modal, Switch, PageContainer, SectionTabs, ThemeToggle, AnimatedProgressBar; `Card` solo conoce `raised`/`inset` (`Card.tsx:4-5`) | No hay niveles `flat`/`overlay`, ni densidad |

### 2.3 Transiciones y movimiento

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| M1 | Animaciones **infinitas** de `box-shadow` | `glow-pulse` (`globals.css:401-404`), `logo-glow` (`:434-438`), `flow-pulse` (`:471-475`) | `box-shadow` fuerza pintado en cada frame; web.dev: solo `transform` y `opacity` se quedan en el compositor y las sombras con blur son más caras de pintar |
| M2 | Animación infinita de `left` | `flow-run` (`globals.css:458-470`) | `left` dispara layout en cada frame |
| M3 | `will-change` permanente | `.float`, `.float-slow` (`:397-398`), `.card-3d` (`:227`) | web.dev: crea capas; usarlo solo cuando hace falta |
| M4 | Sin protección de `hover` en táctil | 0 reglas `@media (hover: hover)` en todo el CSS (solo hay 2 `@media`: `:540` y `:593`); `.card-hover-lift:hover`, `.btn-glow:hover` (`:201-210,184-188`) | El elevado y el "sheen" quedan pegados tras un toque |
| M5 | `transition-all` | 30 usos; `buttonClasses.ts:7`, `AnimatedProgressBar.tsx:37`, `SectionTabs.tsx`, `ClienteBottomNav.tsx:32` | Anima propiedades que no hacía falta |
| M6 | `prefers-reduced-motion` básico | `globals.css:540-546` solo fija duración (0,01 ms) e iteraciones (1) con `!important`; no cubre `scroll-behavior` ni `::view-transition-*` | Funciona en lo básico; falta cubrir el futuro `ViewTransition`, el movimiento por JS (marcadores del mapa) y revisar cómo queda cada animación infinita en su estado final (**no verificado en pantalla**) |
| M7 | Entrada escalonada solo hasta 12 hijos | `.stagger` (`globals.css:514-527`) | Aceptable; el resto entra junto |
| M8 | Marcadores de mapa saltan | `MapComponent.tsx:118` pasa `position={[c.lat, c.lng]}`; Leaflet no trae animación de marcador (la referencia solo ofrece `setLatLng` inmediato, `flyTo`/`panTo` para el mapa) | Los repartidores "teletransportan" en vez de deslizar |
| M9 | Cero uso de plataforma moderna | 0 resultados de `ViewTransition`/`view-transition` en `src` | Oportunidad de bajo costo |

### 2.4 Paleta y contraste (WCAG AA, ambos temas)

Objetivo: texto normal 4,5:1; texto grande (>= 24 px, o >= 18,5 px en negrita) 3:1; componentes de UI e indicadores 3:1 (SC 1.4.11).

| Par (token sobre fondo) | Tema | Ratio | Resultado |
|---|---|---|---|
| `--app-text` `#20170c` sobre bg `#e4d8bf` | claro | 12,51 | Pasa |
| `--app-text-muted` sobre surface / inset | claro | 8,95 / 6,41 | Pasa |
| `--app-text-subtle` `#5f4f36` sobre inset | claro | 4,69 | Pasa (justo) |
| **`--app-text-faint` `#7d6b4e`** (= `text-gray-400`) sobre surface / bg / inset (`globals.css:66`) | claro | **4,26 / 3,64 / 3,05** | **Falla** en texto normal |
| **`text-gray-300` remapeado a `#64748b`** (`:276`) sobre surface | claro | **3,94** | **Falla** en texto normal |
| `--color-text-disabled` `#8a785a` sobre surface | claro | 3,54 | Aceptable (inactivo exento) |
| `brand-olive` `#7c3aed` como texto sobre inset | claro | 3,38 | Falla; por eso existe el remapeo a `--app-accent-text` (5,33) |
| `--color-brand-gold` `#8a6e1e` sobre bg / surface | claro | 3,44 / 4,02 | Falla como texto (el comentario del `@theme` dice "AA" pero se calculó contra `#f0f3f8`, un fondo que ya no existe) |
| **Borde de control** `--color-outline` `#a8946d` sobre surface (`:33`) | claro | **2,44** | Falla 1.4.11 si es el único indicador |
| **`--app-border` efectivo** (`rgba(110,85,45,.38)` sobre surface) | claro | **1,75** | Falla 1.4.11 |
| Blanco sobre `.btn-glow` `#7c3aed` | ambos | 5,70 | Pasa |
| Blanco en el punto medio del "sheen" `#8b5cf6` (`:530-533`) | ambos | 4,23 | Falla durante 0,8 s en hover |
| `--app-text` `#f1f5f9` sobre surface `#17132b` | oscuro | 16,46 | Pasa |
| `--app-text-subtle` `#94a3b8` sobre surface / inset | oscuro | 7,03 / 7,43 | Pasa |
| **`--app-text-faint` `#64748b`** sobre surface / bg (`:118`) | oscuro | **3,79 / 4,10** | **Falla** |
| **`--color-outline` `#475569`** sobre surface (`:99`) | oscuro | **2,38** | Falla 1.4.11 |
| **`--app-border` efectivo** (`rgba(148,163,184,.22)`) | oscuro | **1,47** | Falla 1.4.11 |
| `--app-accent-text` `#c4b5fd` sobre surface | oscuro | 9,77 | Pasa |
| Badges (los 5 tonos, claro y oscuro) | ambos | 6,30-7,00 claro; 10,08-10,96 oscuro (verde y rojo) | Pasan |

Notas:

- El problema real son los **bordes** y el tier "faint", no los textos principales. Solo hay 9 usos de `text-gray-400` y 11 de `text-gray-300`; `text-gray-500` (306 usos) sí pasa.
- Calculé candidatos que pasan, para el agente A: claro `--app-text-faint` ≈ `#5f513b` (4,57 sobre el inset; ya casi igual a `--app-text-subtle`, así que **los cinco niveles de texto no pueden ser distintos y a la vez AA sobre arena**: conviene colapsar a 3-4); borde de control claro ≈ `#887858` (3,57 sobre surface / 3,05 sobre bg); oscuro `--app-text-faint` ≈ `#728195` (4,54-4,91) y borde oscuro ≈ `#586477` (3,01-3,25).
- Neumorfismo y accesibilidad: es un problema conocido (bordes casi del mismo tono que el fondo). Fuentes: Axess Lab y otros señalan 1,4:1-1,86:1 de contraste de borde; la mitigación habitual es borde visible en controles y reservar el efecto para lo no crítico.
- Naming engañoso: `--color-brand-orange` y `--color-brand-olive` son violeta `#7c3aed` (`globals.css:6,9`); `--color-brand-green` es cian `#22d3ee` (`:15`). Hay hex fijo de marca en 10 archivos `.tsx` (p. ej. `MapComponent.tsx:34`, `ZoneLayers.tsx:7`).
- 87 líneas (`globals.css:252-338`) remapean utilidades neutras de Tailwind (`.bg-white`, `.text-gray-*`, `.border-gray-*`) a tokens. Funciona, pero cualquier clase nueva sin remapear queda fuera de tema.

### 2.5 Densidad en móvil

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| D1 | Targets pequeños | `ThemeToggle.tsx:35` `min-h-8` (= 28,8 px con raíz al 90 %); `ClienteBottomNav.tsx:32` `w-10 h-10` (36 px); `buttonClasses.ts:29` `w-9 h-9` (32,4 px); 67 usos de `w-8 h-8`/`w-9 h-9`/`p-1.5`/`w-7 h-7` | WCAG 2.2 SC 2.5.8 (AA) exige 24 x 24 CSS px o espaciado equivalente; el criterio reforzado 2.5.5 pide 44 x 44. Cumple el mínimo, no el cómodo para un pulgar en moto |
| D2 | Sin safe-area | 0 usos de `env(safe-area-inset-*)`; barra inferior `fixed bottom-3` (`ClienteBottomNav.tsx:21`), botón de chat `bottom-20` (`cliente/layout.tsx:47`), `CartBar` `bottom-20` (`CartBar.tsx:20`) | En equipos con barra de gestos la nav puede quedar tapada; tres elementos fijos compiten abajo |
| D3 | Botón sin acción | `cliente/layout.tsx:19-21`: botón "Menú" sin `onClick` | Control que no hace nada (accesibilidad y confianza) |
| D4 | Imágenes de marca pesadas | `public/brand/opsyn-dely-logo.jpg` 804.939 B; `opsyn-dely-icon.png` 570.765 B | Se pueden reducir un orden de magnitud |
| D5 | Placeholders remotos | `cliente/layout.tsx:29` y `admin/layout.tsx:59` usan `picsum.photos` para avatares | Dependencia externa y aleatoria en producción (y CSP `img-src`) |
| D6 | Dos cabeceras apiladas en admin móvil | `admin/layout.tsx:119-150` (barra superior neumórfica) + `SectionTabs` (`:158`) | Reduce el área útil de listas y Kanban |

### 2.6 Línea base de peso (medida sobre artefactos ya existentes, no se ejecutó build)

- `.next/static/chunks` (build del 2026-11-09): 54 archivos JS, 2.027 KB sin comprimir y 628 KB gzip sumando **todas** las rutas (no es "first load" de una ruta). El mayor chunk: 118 KB gzip.
- Fase 0 debe reemplazar esto por mediciones reales de `next analyze` y Lighthouse.

---

## 3. Herramientas: búsqueda y evaluación

### 3.1 Metodología y fuentes de datos

| Dato | Fuente |
|---|---|
| Licencia, versión, fecha de release, mantenedores npm, dependencias, peerDependencies, provenance, scripts de instalación | `https://registry.npmjs.org/<paquete>` (campo `dist.attestations` para provenance) |
| Descargas semanales | `https://api.npmjs.org/downloads/point/last-week/<paquete>` (semana 2026-11-02 a 2026-11-08) |
| Último commit, issues/PRs abiertos, archivado, estrellas, releases | API de GitHub (`gh api repos/...`) |
| Avisos de seguridad | `https://github.com/advisories` (API `advisories?ecosystem=npm&affects=`), OSV `https://api.osv.dev/v1/querybatch` consultado **por la última versión** de cada paquete, Snyk y Socket donde la página cargó |
| Tamaño de bundle | `https://bundlephobia.com/api/size?package=<pkg>@<ver>`. **Es del paquete completo**; en librerías con tree-shaking (Motion, drei, culori) el costo real es menor y debe medirse con `next analyze` |
| Baseline de CSS | `web-platform-dx/web-features` (`features/*.yml.dist`) y MDN |

Límites: OSV se consultó por paquete, no por árbol transitivo. Socket y Snyk solo se pudieron leer para algunos paquetes; en el resto escribo "no verificado". Ninguno de los paquetes consultados declara scripts `install`/`preinstall`/`postinstall` en su última versión (campo vacío en el packument).

### 3.2 `webglstudio.js`: descartar

| Aspecto | Dato (fuente) |
|---|---|
| Estado | `archived: true`; `pushed_at` 2026-07-14, que corresponde a un cambio de README ("Revise README for WebGLStudio migration"). El commit sustantivo anterior es del 2020-08-03 (API de GitHub) |
| Aviso del autor | README: "WEBGLSTUDIO HAS BEEN ABANDONED, IT MIGRATED TO ONEDIT.ORG" ([repo](https://github.com/jagenjo/webglstudio.js), [onedit.org](https://onedit.org/)) |
| Qué es | Un **editor 3D en el navegador** que se copia a un servidor junto con LiteFileSystem (`INSTALL.md`). No es una librería para importar |
| Empaquetado | El repo no tiene `package.json` en la raíz (archivos: `editor`, `plugins`, `serverapps`, `utils`...); `npm view webglstudio.js` da 404. No hay releases |
| Motor interno | `litescene.js`: último commit 2020-08-02, paquete `litescene` 404 en npm. `litegl`: v0.1.0 de 2016, 17 descargas/semana, 3 dependencias (incluye `webpack`) |
| Mantenimiento | 5.332 estrellas, 36 issues abiertos, 1 PR abierto; sin actividad real desde 2020 |
| Licencia | MIT (LICENSE), pero GitHub no la detecta en `litegl.js` (`NOASSERTION`) |
| Funciones que faltan | El propio README: sin edición de mallas, sin FBX completo, sin física |
| Encaje con Next/React 19/Workers | **Ninguno**: scripts globales sin módulos ni tipos, pensado para servirse como app aparte, sin integración React |
| Veredicto | **Descartar.** Para 3D en una app Next hay alternativas vivas (three.js, R3F, model-viewer). Para modelar: Blender + glTF-Transform |

### 3.3 `svgo`: usar como devDependency, sin riesgo

| Aspecto | Dato |
|---|---|
| Versión / release | 4.1.0 del 2026-08-24 (también 3.3.5 y 2.8.4 el mismo día) |
| Licencia | MIT |
| Mantenimiento | 4 mantenedores npm; GitHub: último commit 2026-11-08, 22.803 estrellas, 278 issues y 84 PRs abiertos, 6 autores distintos en los últimos 30 commits |
| Descargas | 49.850.131 por semana |
| Provenance | **Sí** (`dist.attestations`) |
| Dependencias | 7 directas: `sax`, `csso`, `css-tree`, `css-what`, `commander`, `css-select`, `picocolors`. Paquete ESM + exports, 1,46 MB desempaquetado |
| Bundle | 625 KB / 193 KB gzip (irrelevante: **no va al cliente**) |
| Avisos | En 2026 hubo 4 (GitHub Advisories): `GHSA-xpqw-6gx7-v673` (alta, DoS por entidades en DOCTYPE, 2026-03-04, corregida en 4.0.1), `GHSA-2p49-hgcm-8545` (alta, `removeScripts` deja scripts, 2026-07-21, corregida en 4.0.2), `GHSA-w27v-7q3p-w38r` (alta, `removeScripts` permite enlaces ejecutables, 2026-09-08, corregida en 4.1.0) y `GHSA-4vpr-x523-8j87` (media, HTML ejecutable en `foreignObject`, 2026-09-08, corregida en 4.1.0). OSV: **0 avisos en 4.1.0**. Snyk (captura con datos algo viejos) da 80/100 y "sin problemas conocidos en 4.1.0" |
| React 19 / Next 16 / Workers | No aplica al runtime: herramienta de build |
| Build vs cliente | **Solo build/dev.** No se importa desde `src/` |

**Cómo usarlo sin romper nada**

1. Agregar `svgo@^4.1.0` (idealmente fijado a `4.1.0` exacto) **solo en `devDependencies`**. Que `package.json` use `"svgo": "4.1.0"` sin `^` y `.npmrc` con `save-exact=true`.
2. Script `scripts/optimize-svg.mjs` que recorre `public/**/*.svg` y `src/assets/**/*.svg` y **escribe en otra carpeta o muestra diff**; nunca pisa el original sin revisar el diff en git.
3. `svgo.config.mjs` conservador (en SVGO 4 `removeViewBox` y `removeTitle` ya vienen desactivados en `preset-default`; no volver a activarlos):

```js
// svgo.config.mjs
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          cleanupIds: false,        // evita colisiones/ruptura de referencias url(#id) al incrustar inline
          removeDesc: false,        // conserva descripciones accesibles
          // Para SVG animados con CSS (como AnimatedClock): desactivar en un config aparte
          // collapseGroups: false, mergePaths: false, convertShapeToPath: false,
        },
      },
    },
    { name: "prefixIds" },          // evita choques de ids entre SVGs inline en la misma página
  ],
};
```

4. **No tratar `removeScripts` como sanitizador.** Los avisos de 2026 son justamente evasiones de ese plugin. SVGO no sanea SVG de usuarios. Si alguna vez se aceptan SVG subidos por usuarios (hoy no hay), usar un sanitizador dedicado.
5. Procesar **solo SVG propios** (no entrada no confiable) y verificar con `git diff` que se conserva `viewBox`.
6. Ojo con `@svgr/webpack`/`@svgr/cli` (8.1.0, última release 2023-08-15, 28 PRs abiertos): arrastran `svgo ^3`; si se usan, exigir svgo >= 3.3.5 en el lockfile. Recomendación: **no agregar SVGR**; los íconos son Lucide y las pocas ilustraciones se pegan como TSX tras pasar por SVGO.

Impacto real hoy: **bajo**. `public/` no tiene `.svg`; los SVG están inline (`AnimatedClock.tsx`, `ProductForm.tsx`). El valor de SVGO aparece cuando se sumen ilustraciones propias.

### 3.4 `tween.js`: descartar por redundante

| Aspecto | Dato |
|---|---|
| Paquete | `@tweenjs/tween.js` 25.0.0, publicado 2024-07-26 |
| Licencia | MIT (npm y texto del `LICENSE`; GitHub la marca `NOASSERTION` por el formato) |
| Mantenimiento | 4 mantenedores npm; GitHub: último commit 2026-11-06 (se fusionó una API `Timeline` en `main` **sin release publicado todavía**), 12 issues y 6 PRs abiertos, 10.149 estrellas, 72 colaboradores en la primera página de la API. Socket califica el ritmo de releases como "not healthy" (último release hace más de un año, captura) |
| Descargas | 23,6 M/semana (probablemente mayormente transitivas; **no verificado**) |
| Bundle | 12,6 KB min / **3,7 KB gzip**, 0 dependencias |
| Seguridad | 0 avisos (GitHub Advisories y OSV). Sin provenance. Sin scripts de instalación |
| API | Imperativa: hay que llamar `tween.update(time)` en tu propio loop (`requestAnimationFrame`). En v25 `update()` ya no arranca solos los tweens (`start()` explícito). No maneja unidades CSS; sirve para números |
| React 19 / Next 16 / Workers | Es JS puro sin dependencias ni DOM propio (el README no habla de SSR: **no verificado** que importar sea inocuo en servidor). Si se usara, solo desde componentes cliente |
| Cliente o build | Iría al bundle del cliente |

**Comparación con lo que ya cubre esta app**

| Necesidad concreta | CSS / plataforma | Motion | GSAP | tween.js | Mejor opción aquí |
|---|---|---|---|---|---|
| Marcador del repartidor que se desliza (`MapComponent.tsx:118`; Leaflet no trae animación de marcador, solo `setLatLng`) | No | `animate(a, b, { onUpdate })` (`animate` mini ≈ 3,1 KB según la web del propio Motion) | Sí | Sí (3,7 KB) | Un **lerp con `requestAnimationFrame` de ~15 líneas** (0 KB) o Motion si ya se adoptó |
| Contadores de KPI (`/admin/ejecutivo`) | `@property` + `transition` (Baseline reciente, no verificado aquí) | `animate` | Sí | Sí | Motion o CSS |
| Cámara/objetos en three.js | No | Sí (API three en el paquete completo) | Sí | **Sí, su caso clásico** | Con R3F: `useFrame` + damp (drei trae `maath`); sin R3F, tween.js sería razonable |
| Transiciones de UI DOM/CSS | **View Transitions, scroll-driven, `@starting-style`** | Sí | Sí | **No** (sin unidades CSS) | CSS primero |
| Leaflet `flyTo`/`panTo` | **Nativos y respetan reduced-motion**: "If the user prefers reduced motion and `animate: true` isn't passed, [`flyTo`] behaves like `setView`" | n/a | n/a | n/a | Nativo |

**Veredicto:** no aporta nada que no cubran CSS + Motion `animate()` + un lerp propio, y hoy ni siquiera hay three.js en la app. No tiene riesgo de seguridad; el motivo es no sumar una dependencia con releases espaciados por algo que se resuelve en 15 líneas. **Reevaluar** solo si se aprueba 3D imperativo (p. ej. `model-viewer` con cámara controlada a mano).

### 3.5 Tabla maestra: animación web

Descargas semanales del 2026-11-02/08. "Prov." = provenance npm.

| Herramienta | Versión / último release | Licencia | Mant. npm / repo | Descargas/sem | Tamaño (Bundlephobia min / gzip) | Avisos (última versión) | Prov. | Deps | React 19 / Next 16 / Workers | Va al |
|---|---|---|---|---|---|---|---|---|---|---|
| **Motion** (`motion`) | 14.11.1 / 2026-11-09 | MIT | 2 / 35.032 ★, 5 issues, 2 PRs, último commit 2026-11-09 | 34,1 M | Paquete completo 185 KB / 63 KB. Docs oficiales: `motion` completo 43 KB gzip; `LazyMotion`+`m` ≈ 5 KB inicial; +24 KB (`domAnimation`) o +38 KB (`domMax`, layout y drag) | 0 (OSV) | No | 2 (`tslib`, `framer-motion`) | Peer `react ^18 \|\| ^19`; cliente (`'use client'`); no verificado en OpenNext, pero sin APIs de Node | Cliente |
| **framer-motion** | 14.11.1 / 2026-11-09 | MIT | igual repo | 68 M | 230 KB / 80 KB | 0 | No | `tslib`, `motion-dom`, `motion-utils` | igual | Cliente |
| **GSAP** | 3.15.1 / 2026-11-04 | **Propietaria "Standard no charge"** (Webflow). Gratis también comercial desde 2025-04-30; prohíbe usarla para construir herramientas no-code que compitan con Webflow y alterar sus avisos | 1 mantenedor; repo sin licencia detectada | 8,1 M | 71 KB / **27 KB** (ScrollTrigger +16,9 KB según Motion, fuente interesada) | 1 histórico (`<3.6.0`, 2021) | No | 0 | `@gsap/react` 2.1.2 (peer `react >=17`). Sin SSR problemático documentado | Cliente |
| **View Transitions** (React `<ViewTransition>` + API nativa) | Nativa. En Next: React `19.3.0-canary` incluido en `next/dist/compiled/react` | n/a | n/a | n/a | **0 KB** | n/a | n/a | n/a | Documentado en `view-transitions.md` (App Router, sin config). **Baseline "low" desde 2025-10-14** (Chrome 111, Firefox 144, Safari 18). Sin soporte, la app funciona igual sin animar | Plataforma |
| **CSS scroll-driven** (`animation-timeline`) | Nativa | n/a | n/a | n/a | **0 KB** | n/a | n/a | n/a | **Baseline "low" desde 2026-10-27**: Chrome 115, Firefox 159, Safari 26. Solo como mejora progresiva con `@supports` | Plataforma |
| **lottie-web** | 5.13.0 / 2025-05-21 | MIT | 4 / 862 issues y 69 PRs abiertos, último commit 2024-11-19 | 10,2 M | 306 KB / 77 KB | 0 | No | 0 | Sin mantenimiento activo | Cliente |
| **dotLottie** (`@lottiefiles/dotlottie-react` + `-web`) | 0.21.1 y 0.82.1 / 2026-11-02 | MIT | 2 / 939 ★, activo | 2,0 M | JS 162 KB / 32 KB gzip; el motor **WASM** (~500 KB comprimido según la documentación de LottieFiles) se baja de jsDelivr/unpkg por defecto | 0 | **Sí** | 1 | Peer `react ^17 \|\| ^18 \|\| ^19`. **Choca con la CSP** (hay que alojar el `.wasm` y agregar `'wasm-unsafe-eval'`, `connect-src` y posiblemente `worker-src blob:`) | Cliente |
| **Rive** (`@rive-app/react-canvas`) | 4.39.0 / 2026-11-09 (`@rive-app/canvas` 2.50.0) | MIT | 5 / 1.020 ★, activo | 1,1 M | 364 KB / 92 KB + `rive.wasm` desde unpkg por defecto | 0 | **Sí** | 1 | Peer React 16-19. Misma limitación de CSP; la versión del `.wasm` debe coincidir con la del paquete | Cliente |
| **@formkit/auto-animate** | 0.10.2 / 2026-11-06 | MIT | 4 / 13.965 ★ | 2,3 M | 8,8 KB / **3,5 KB** | 0 | **Sí** | 0 | Pensado para listas que entran/salen; si respeta reduced-motion por sí mismo: **no verificado** | Cliente |
| **tween.js** | ver sección 3.4 | MIT | 4 | 23,6 M | 12,6 KB / **3,7 KB** | 0 | No | 0 | JS puro | Cliente |
| **tw-animate-css** | 1.4.0 / 2025-09-24 | MIT | 1 | 47,6 M | n/a (CSS) | 0 | **Sí** | 0 | CSS puro; **no hace falta**: la app ya tiene sus keyframes | Build (CSS) |
| **lenis** (scroll suave) | 1.3.27 / 2026-10-15 | MIT | 2 | 2,7 M | no medido | 0 | No | 0 | **No recomendado**: secuestrar el scroll empeora gama baja y accesibilidad | Cliente |

Recomendación de animación (en orden): **CSS nativo primero** (transiciones específicas, `@starting-style`, View Transitions, scroll-driven con `@supports`), **Motion con `LazyMotion` + `m` solo si el spike demuestra que hace falta** (layout/drag en el Kanban, `AnimatePresence`), **GSAP no** (licencia propietaria revocable y no aporta sobre Motion para esta UI), **Lottie/Rive no por ahora** (WASM + CSP), **tween.js no**.

### 3.6 Tabla maestra: 3D, modelos y assets

| Herramienta | Versión / último release | Licencia | Mant. npm / repo | Descargas/sem | Bundle (min / gzip) | Avisos | Prov. | Notas de compatibilidad y riesgo | Va al |
|---|---|---|---|---|---|---|---|---|---|
| **three** | 0.187.0 / 2026-10-30 | MIT | 2 / 117.979 ★, 409 issues, 146 PRs, último commit 2026-11-10 | 34,8 M | 742 KB / **186 KB** (paquete completo) | 2 históricos (`<0.125`, `<0.137`); 0 en la última | No | `sideEffects` parcial; tree-shaking real depende de qué se importe | Cliente |
| **@react-three/fiber** | 9.8.2 / 2026-10-14 | MIT | 8 / 33.613 ★ | 9,3 M | 183 KB / 58 KB | 0 | No | Peer `react >=19 <19.4` y `three >=0.156`: **React 19.2.4 del repo cumple**; el React compilado de Next es 19.3.0-canary, que también entra en el rango (**no verificado en ejecución**). Debe ir en `'use client'` + `next/dynamic({ ssr: false })` (docs de Next) | Cliente |
| **@react-three/drei** | 10.7.9 / 2026-09-25 | MIT | 6 / 10.135 ★, 151 issues, 63 PRs | 6,3 M | 1,68 MB / 521 KB (**completo**; `sideEffects: false`, importar solo lo usado) | 0 | **Sí** | 21 dependencias directas (incluye `hls.js`, `@mediapipe/tasks-vision`, `three-stdlib`, `troika-three-text`); superficie de supply chain grande para lo que se usaría | Cliente |
| **@google/model-viewer** | 4.4.0 / 2026-10-09 | Apache-2.0 | 4 / 8.319 ★ | 0,82 M | 237 KB / 73 KB (más `three` interno) | 0 | No | **Peer `three ^0.183.0`**: no comparte `three` con R3F 0.187 (duplicaría). Atributos `poster`, carga perezosa. Draco y KTX2 se cargan **de un CDN de Google por defecto** (`dracoDecoderLocation`, `ktx2TranscoderLocation` lo cambian); Meshopt viene desactivado | Cliente |
| **@babylonjs/core** | 9.35.0 / 2026-11-06 | Apache-2.0 | 6 / 26.312 ★ | 0,37 M | 8,3 MB / 1,84 MB gzip | 0 | No | **Descartar**: demasiado pesado para este caso | Cliente |
| **ogl** | 1.0.11 / 2025-01-27 | Unlicense | 1 | 1,19 M | 131 KB / 34 KB (completo) | 0 | No | Alternativa mínima a three para un shader decorativo; sin binding React; release de hace 22 meses | Cliente |
| **@gltf-transform/core + cli** | 4.5.1 / 2026-09-28 | MIT | 1 mantenedor / 2.070 ★, 82 issues | 1,38 M / 0,26 M | `core` 1,8 MB desempaquetado | 0 | No | CLI para optimizar (`optimize`, `--compress draco\|meshopt`, `--texture-compress webp`); depende de `sharp` y de 21 paquetes: **solo devDependency/CI** | Build |
| **gltfpack / meshoptimizer** | 1.3.0 / 2026-09-25 | MIT | 1 mantenedor / 8.820 ★ | 0,07 M / 23,7 M | `meshoptimizer` 147 KB / 52 KB | 0 | No | `gltfpack` cuantiza por defecto (KHR_mesh_quantization, **no necesita decodificador**); `-c` usa EXT_meshopt_compression y **sí necesita el decodificador WASM**; `-tc` pasa a KTX2 (requiere soporte basisu) | Build / cliente (decoder) |
| **draco3d** | 1.5.9 / 2026-10-16 | Apache-2.0 | 6 / google/draco 7.546 ★ | 7,6 M | 101 KB / 23 KB | 0 | No | Decodificador WASM: requiere `'wasm-unsafe-eval'` y suele usar worker `blob:` | Cliente |
| **three-stdlib** | 2.36.1 / 2025-11-10 | MIT | 3 | 6,4 M | 25 MB desempaquetado | 0 | No | Transitiva de drei | Cliente |
| **gltf-validator** | 2.0.0-dev.3.10 / 2024-10-22 | Apache-2.0 | 2 / Khronos | 0,51 M | n/a | 0 | No | Para validar `.glb` en CI; el paquete npm es una build "dev" de hace 2 años | Build |

### 3.7 Tabla maestra: tipografía, color, imágenes y medición

| Herramienta | Versión / último release | Licencia | Mant. / repo | Descargas/sem | Bundle | Avisos | Prov. | Veredicto para esta app |
|---|---|---|---|---|---|---|---|---|
| **`next/font`** (incluida en Next) | 16.4.5 | MIT | Vercel | n/a | n/a | n/a | n/a | **Ya está.** Self-host, `font-display: swap`, fallbacks con `size-adjust` verificados en el CSS construido. Falta quitar los `weight` discretos |
| **@fontsource-variable/inter / manrope** | 5.3.0 / 2026-07-19 | OFL-1.1 | 2 / fontsource 6.275 ★ | 10,8 M / 1,4 M | 1,86 MB / 94 KB desempaquetado | 0 | **Sí** | **No hace falta** mientras `next/font` cubra el caso; sería la salida si se quisiera dejar de depender de la descarga de Google en build |
| **@capsizecss/core**, **fontaine** | 4.1.3 / 1.0.3 | MIT | 2 / 1 | 0,16 M / 1,5 M | n/a | 0 | **Sí** | No hace falta: `next/font` ya genera métricas de fallback |
| **culori** | 4.0.2 / 2025-06-27 | MIT | 2 / 1.253 ★, activo | 6,3 M | 62 KB / 22 KB (completo, tree-shakable) | 0 | No | Útil **solo en build/test** para generar escalas OKLCH. No ponerlo en el cliente |
| **colorjs.io** | 0.7.1 / 2026-07-24 | MIT | 4 / 2.319 ★ | 14 M | 82 KB / 32 KB | 0 | No | Alternativa a culori, igual uso (build/test) |
| **@radix-ui/colors** | 3.0.0 / 2023-10-02 | MIT | 4 / último commit 2025-12-17 | 4,6 M | 105 KB / 28 KB | 0 | No | **Referencia de escalas**, copiar valores; no como dependencia de runtime. Ritmo de releases lento |
| **OKLCH / `color-mix` / `light-dark()`** (CSS) | Nativo | n/a | n/a | n/a | 0 | n/a | n/a | `oklab/oklch` y `color-mix` son Baseline "high"; `light-dark()` y `text-wrap: balance` son Baseline "low" (2024-05-13). Tailwind v4 define su paleta por defecto en `oklch()` |
| **axe-core + @axe-core/playwright** | 4.14.0 / 2026-10-05 y 2026-10-15 | MPL-2.0 | 4-5 / dequelabs 7.789 ★ | 111 M / 23 M | n/a (dev) | 0 | **Sí** | **Recomendada.** El repo ya usa Playwright 1.59.1. Solo devDependency |
| **apca-w3** | 0.1.9 / 2022-07-04 | "Limited W3 License" | 1 | 0,2 M | n/a | 0 | No | No usar para validar (el criterio normativo es WCAG 2.x) |
| **sharp** | 0.35.5 / 2026-09-27 | Apache-2.0 | 1 mantenedor / 32.835 ★ | 161 M | n/a | 5 históricos, **el último (alto, `GHSA-wq5f-xc86-pv6w`, librsvg) corregido en 0.35.5**; el repo ya tiene 0.35.5 | **Sí** | **Recomendada** para optimizar `public/brand/*` en un script local. No ejecutar en el Worker (binario nativo; en Workers la optimización la hace el binding de Cloudflare Images o un loader propio) |
| **Cloudflare Images binding / loader** | OpenNext 1.20.16 | n/a | Cloudflare | n/a | n/a | n/a | n/a | Hoy `wrangler.jsonc` **no define el binding `images`**. OpenNext documenta binding `IMAGES` o loader custom con `/cdn-cgi/image/`; puede generar costo. Verificar qué hace hoy `next/image` en producción (**no verificado**) |
| **@svgr/webpack / cli** | 8.1.0 / 2023-08-15 | MIT | 1 / último commit 2025-10-05 | 11,9 M / 1,1 M | n/a | 0 | No | No agregar (ver 3.3) |
| **@next/bundle-analyzer / `next analyze`** | `next analyze` desde Next 16.1 | MIT | Vercel | n/a | n/a | n/a | n/a | **Usar `npx next analyze`** (analizador de Turbopack, `package-bundling.md`) |
| **web-vitals** | 6.2.3 / 2026-10-05 | Apache-2.0 | 3 / Google | 79,9 M | n/a | 0 | No | Para medir LCP/CLS/INP reales en producción. Enviar con `sendBeacon` a un endpoint propio |
| **lighthouse + @lhci/cli** | 13.6.0 / 2026-10-27 y 0.16.0 / 2026-11-02 | Apache-2.0 | 3-4 / Google | 7,3 M / 2,5 M | n/a | 0 | **Sí** | **Recomendados** en devDependencies / CI para presupuestos móviles |
| **Cloudflare Web Analytics** | Servicio | n/a | Cloudflare | n/a | n/a | n/a | n/a | "Disponible en todos los planes", funciona sin cambiar DNS ni proxy. Si mide Core Web Vitals reales: **no verificado**; exigiría ajustar la CSP (`script-src`/`connect-src`) |

### 3.8 Matriz de compatibilidad con la CSP y con Workers

| Necesidad | CSP actual (`next.config.ts:32-37`) | Cambio requerido | Riesgo |
|---|---|---|---|
| three / R3F / Motion / tween.js / GSAP | `script-src 'self' 'unsafe-inline'` | Ninguno si se sirven del propio origen | Bajo |
| Cargar `.glb` desde R2 | `connect-src 'self' ...` no incluye el bucket | Agregar el host público de R2 a `connect-src` (hoy solo está en `img-src`) | Medio |
| Draco / Meshopt comprimido / KTX2 | Sin `'wasm-unsafe-eval'`, sin `worker-src` | Agregar `'wasm-unsafe-eval'` y `worker-src 'self' blob:` | **Medio-alto**: relaja la CSP. Evitable con modelos solo cuantizados (`gltfpack` sin `-c`) y texturas WebP |
| `model-viewer` con decodificadores por defecto | Bloquea el CDN de Google | Configurar `dracoDecoderLocation`/`ktx2TranscoderLocation` propios (mismo origen) | Medio |
| dotLottie / Rive | Bloquea jsDelivr/unpkg y WASM | Alojar `.wasm`, `setWasmUrl`, `'wasm-unsafe-eval'` | Medio-alto |
| Cloudflare Web Analytics | No permitido | Ajustar CSP | Bajo |
| Bundle del Worker (límites 3 MiB gratis / 10 MiB pago, comprimido, según OpenNext) | n/a | Importar librerías pesadas con `next/dynamic(..., { ssr: false })` **dentro de un Client Component** (en Server Components `ssr:false` da error, `lazy-loading.md:66,94`) para que no entren al bundle SSR | Medio |

### 3.9 Política de cadena de suministro para cualquier dependencia nueva

1. Versión exacta (`save-exact=true`), lockfile commiteado, revisar el diff del lockfile en cada PR.
2. Antes de aceptar: `npm audit` y `npm audit signatures` (verifica firmas y provenance), consulta OSV por versión, 0 scripts `install`.
3. Preferir paquetes con provenance cuando haya alternativa equivalente. Entre las candidatas: SVGO, dotLottie, Rive, drei, axe, sharp, lighthouse, `@formkit/auto-animate`, Fontsource y `tw-animate-css` lo tienen; Motion, three, R3F, GSAP, tween.js, culori y glTF-Transform **no**.
4. Una sola persona mantiene gltfpack, glTF-Transform, sharp, tween.js y GSAP (1 mantenedor npm): riesgo de "bus factor", aceptable solo en herramientas de build.
5. Dependencias de runtime nuevas necesitan presupuesto de bundle aprobado (sección 4.1).
6. Una dependencia a la vez en `package.json`: la reserva para cambios en `package.json`/lockfile pasa por un único agente (ver 4.4).

---

## 4. Plan de mejora

### 4.1 Principios y presupuestos

Principios: tokens antes que componentes; CSS nativo antes que JS; medir antes y después; todo cambio visual detrás de capturas comparables; ningún efecto sin versión degradada para gama baja y reduced-motion.

Presupuestos propuestos (se ajustan con la línea base de la fase 0; hasta entonces son objetivos de diseño, no cifras medidas):

| Métrica | Objetivo | Cómo se verifica |
|---|---|---|
| Contraste de texto | 100 % de los tokens de texto >= 4,5:1 sobre sus fondos reales (>= 3:1 solo en texto grande), ambos temas | Test `tests/contrast.test.ts` (node:test, sin dependencias) que parsea los tokens y calcula WCAG |
| Contraste de UI | Borde/indicador de input, select, switch y botones secundarios >= 3:1 (SC 1.4.11) | Mismo test + axe |
| Accesibilidad automatizada | 0 violaciones `serious`/`critical` de axe en rutas clave, claro y oscuro | `@axe-core/playwright` en `e2e/a11y.spec.ts` |
| Targets | Controles táctiles >= 44 x 44 CSS px en el portal cliente y repartidor; >= 24 x 24 en admin denso (SC 2.5.8) | Playwright mide `boundingBox()` de `button, a, [role=button]` |
| CLS | <= 0,05 en `/cliente`, `/admin/pedidos` (laboratorio, Lighthouse móvil) | Lighthouse CI |
| LCP | No peor que la línea base; objetivo <= 2,5 s en Lighthouse móvil con throttling por defecto | Lighthouse CI |
| JS inicial | Fases 1-4: <= +10 KB gzip sobre la línea base por ruta. Fase 5 (3D): chunk perezoso <= 120 KB gzip y **0 KB** en la carga inicial de `/cliente` | `npx next analyze`, comparación en el PR |
| Fuentes | <= 2 archivos woff2 por familia en la carga inicial | Pestaña Network / `PerformanceObserver` |
| Movimiento | 0 animaciones infinitas de `box-shadow`, `left`, `top`, `width`, `height`; todo `animation`/`transition` neutralizado bajo reduced-motion | Test que recorre `document.getAnimations()` con `reducedMotion: "reduce"` + grep en CI |
| Imágenes | Logo e ícono de marca <= 60 KB cada uno servidos | Medición en red |

### 4.2 Priorización (impacto, esfuerzo, riesgo; 1 = bajo, 5 = alto)

| ID | Iniciativa | Impacto | Esfuerzo | Riesgo | Prioridad |
|---|---|---|---|---|---|
| I0 | Línea base y red de seguridad (capturas, axe, Lighthouse, `next analyze`) | 4 | 2 | 1 | **P0** |
| I1 | Partir `globals.css` en parciales sin cambio visual | 4 | 2 | 2 | **P0** (habilitador) |
| I2 | Contraste, bordes de control y consolidación de tokens + test | 5 | 2 | 2 | **P0** |
| I3 | Fuentes variables + escala tipográfica mínima + `tracking` | 5 | 3 | 3 | **P0** |
| I4 | Movimiento seguro: sacar animaciones caras, guardas `hover`, reduced-motion completo | 4 | 2 | 1 | **P0** |
| I5 | Niveles de elevación y primitivas (`Card`, `Badge`, `Button`, `Modal`) | 4 | 3 | 3 | P1 |
| I6 | Safe-area, targets de 44 px y densidad en móvil | 4 | 2 | 2 | P1 |
| I7 | Optimizar imágenes de marca y revisar `next/image` en Cloudflare | 3 | 2 | 2 | P1 |
| I8 | View Transitions en cliente (lista de pedidos a detalle) y pestañas del admin | 3 | 2 | 2 | P1 |
| I9 | Medición continua (Lighthouse CI + `web-vitals`) | 3 | 2 | 1 | P1 |
| I10 | Animación del marcador del repartidor (lerp propio o Motion) | 3 | 1 | 1 | P1 |
| I11 | Reveal con scroll-driven CSS (mejora progresiva) | 2 | 1 | 1 | P2 |
| I12 | Spike Motion (`LazyMotion`) para Kanban y listas | 3 | 3 | 3 | P2 (decisión tras I4/I8) |
| I13 | Pipeline SVGO para ilustraciones nuevas | 1 | 1 | 1 | P2 |
| I14 | Retirar el remapeo de neutros de Tailwind (`globals.css:252-338`) por utilidades semánticas | 3 | 4 | 3 | P3 |
| I15 | Spike 3D opt-in (hero o "estado del pedido") | 2 | 5 | 4 | P3, solo si pasa la puerta de la fase 5 |

### 4.3 Fases entregables

#### Fase 0: línea base (agente G, 1 día, sin cambios visuales)

| Entregable | Detalle |
|---|---|
| Capturas base | Playwright `toHaveScreenshot` de login, `/cliente`, `/cliente/pedidos`, `/cliente/carrito`, `/admin/ejecutivo`, `/admin/pedidos`, `/admin/mapa`, `/repartidor`; 2 temas x 3 anchos (375, 768, 1280). Datos estables con el modo demo (`npm run demo`) |
| Auditoría | `@axe-core/playwright` en las mismas rutas y temas; informe en `test-results/` |
| Peso | `npx next analyze` y tabla de chunks por ruta; Lighthouse móvil en 4 rutas; guardar resultados en `docs/baseline-ui-2026-11.md` |
| Test de contraste | `tests/contrast.test.ts` que **hoy debe fallar** en los casos de la sección 2.4 |
| Guardia | Regla ESLint `no-restricted-syntax` contra `text-[Npx]` nuevos y contra `transition-all` (en `eslint.config.mjs`, solo como `warn` al principio) |

Criterio de aceptación: informe con números base; ningún diff en `src/`.

#### Fase 0.5: partir `globals.css` (agente A, 0,5 día)

Mover sin cambiar una regla: `src/styles/tokens.css` (líneas 1-137), `surfaces.css` (139-250), `legacy-remap.css` (252-351), `motion.css` (361-546), `typography.css` (548-566), `exec.css` (568-683); `globals.css` queda con `@import "tailwindcss"` y los `@import` relativos. Tailwind v4 resuelve imports relativos y `@theme`/`@utility` dentro de ellos (**verificar en un build de prueba antes de seguir**).

Criterio: capturas de la fase 0 sin diferencias; `npm run build` y `npm run lint` en verde; tamaño del CSS construido igual (~14 KB hoy).

#### Fase 1: tokens y color (agente A) en paralelo con B, C, D, E

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| Subir `--app-text-faint`, `--color-outline`, `--app-border` a los valores AA (candidatos en 2.4) y colapsar niveles de texto a 3-4 | `src/styles/tokens.css` | Script de cálculo WCAG | Test de contraste verde; bordes de control >= 3:1 | `node --test tests/contrast.test.ts`, axe |
| Renombrar a semánticos con alias de compatibilidad: `--color-brand` (+ alias `brand-orange/olive/...`), `--color-accent-cyan` | `tokens.css`, `AGENTS.md` | n/a | 0 usos de nombres engañosos en código nuevo | grep |
| Mapear con `@theme inline` para que los temas se resuelvan en runtime | `tokens.css` | Docs de Tailwind v4 (`@theme inline`, `@custom-variant dark` con `data-theme`) | Cambiar `data-theme` actualiza todas las utilidades | Captura en ambos temas |
| Reemplazar hex fijos por tokens | `MapComponent.tsx:34`, `ZoneEditorMap.tsx:14,21,24`, `ZoneLayers.tsx:7`, `cliente/page.tsx:174`, `ClienteBottomNav.tsx:34` | n/a | 0 hex de marca fuera de `tokens.css` | `grep -rE "#7c3aed|#ff7b00" src` |
| Tokens para gráficos (paleta categórica con contraste en ambos temas) | `tokens.css`, componentes de Recharts | skill `dataviz` | Series distinguibles; contraste >= 3:1 contra el fondo del gráfico | Revisión visual + axe |
| Evaluar `light-dark()` | `tokens.css` | `color-scheme` ya se fija en `:root[data-theme]` (`globals.css:53,88`) | Mitad de bloques de tokens | Spike de 1 hora; `light-dark()` es Baseline "low" desde 2024-05-13 |

#### Fase 1: tipografía (agente B)

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| Quitar `weight` y usar las variables completas; mantener `display: "swap"` | `src/app/layout.tsx:9-19` | `next/font` (docs `13-fonts.md`) | CSS con 2 `@font-face` por familia y subset en vez de 53 bloques; 700/900 reales | Comparar CSS construido y capturas. **Cambio visual esperado: las negritas se verán más fuertes**; revisar |
| Escala nombrada en `@theme`: `--text-2xs` ... `--text-4xl` con `--text-*--line-height`, mínimo UI = 12 px reales; títulos fluidos con `clamp()` | `src/styles/typography.css` | Docs de Tailwind v4 (`--text-*`), método Utopia | 0 `text-[9-11px]` en código nuevo | ESLint de la fase 0 |
| Decidir el 90 % de la raíz: pasar a 100 % y reescalar la escala para conservar densidad | `typography.css` (`html`) | Capturas | Mismo layout en 375 px con texto igual o mayor; respeta el tamaño del usuario | Capturas + zoom 200 % sin pérdida (WCAG 1.4.4) |
| `tracking-widest` solo en micro-etiquetas en mayúsculas; `text-wrap: balance` en títulos; `font-variant-numeric: tabular-nums` en precios y KPIs (confirmar que Inter y Manrope lo soportan en el subset servido: **no verificado**) | `buttonClasses.ts:7` (solo el tracking, coordinar con C), `typography.css` | CSS | Botones sin tracking ancho; columnas numéricas alineadas | Captura |
| Reemplazo masivo de `text-[Npx]` por tokens | 119 `.tsx` (codemod) | Script de reemplazo + ESLint | 0 usos | **Último paso de la ola (ventana de integración, ver 4.4)** |

#### Fase 1: superficies y primitivas (agente C)

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| Cuatro niveles de superficie por tokens: `flat`, `raised`, `inset`, `overlay`; sombras como tokens `--shadow-*` | `surfaces.css`, `Card.tsx` | `@theme` (`--shadow-*`) | Cada nivel con borde/indicador >= 3:1 cuando el elemento es interactivo | Test de contraste + captura |
| Neumorfismo como firma en cards de KPI y héroes; controles interactivos con borde visible | `Button.tsx`, `buttonClasses.ts`, `Field.tsx`, `Switch.tsx`, `SectionTabs.tsx`, `ThemeToggle.tsx` | n/a | Estados hover/active/focus/disabled distinguibles sin depender solo de la sombra | axe + captura de estados |
| Escala de radios (`--radius-*`: 3-4 valores) | `surfaces.css`, `Card.tsx` | n/a | 0 `rounded-[Nrem]` nuevos | grep |
| Tema oscuro: subir la luz de la sombra y usar borde en vez de relieve | `tokens.css` en coordinación con A | n/a | Relieve percibido en oscuro | Captura |
| Densidad `compact` para tablas y Kanban | `Card.tsx`, `PageContainer.tsx` | n/a | Más filas visibles en 375 px sin bajar de 12 px | Captura |
| Reducir `backdrop-filter`: una sola clase `.glass` con `@supports` y color sólido de respaldo | `surfaces.css`, `cliente/layout.tsx:17,47`, `ClienteBottomNav.tsx:21`, `Modal.tsx:71`, `admin/layout.tsx:32` | CSS | Sin blur bajo reduced-transparency / gama baja | Lighthouse (tiempo de pintado) |
| Safe-area y targets de 44 px | `ClienteBottomNav.tsx`, `CartBar.tsx`, `cliente/layout.tsx`, `ThemeToggle.tsx`, `buttonClasses.ts` (`ICON_SIZE`) | `env(safe-area-inset-bottom)` | Playwright mide >= 44 px en cliente/repartidor | `boundingBox()` |
| Arreglar el botón "Menú" sin acción | `cliente/layout.tsx:19-21` | n/a | Tiene destino o se elimina | e2e |

#### Fase 1: movimiento CSS-first (agente D)

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| Tokens de movimiento (`--motion-duration-fast/base/slow`, `--ease-*`) | `motion.css` | `stitch-design-system` como plantilla | Toda duración sale de tokens | grep |
| Quitar animaciones infinitas de `box-shadow`/`left`: `logo-glow`, `glow-pulse`, `flow-pulse` pasan a `opacity`/`transform` sobre un pseudoelemento; `flow-run` pasa a `transform: translateX` | `motion.css` (`globals.css:401-404,434-438,458-475`) | web.dev animations guide | 0 animaciones infinitas de propiedades de pintado/layout | Test de `getAnimations()` |
| `@media (hover: hover)` para `.card-hover-lift`, `.portal-card`, `.card-3d`, `.btn-glow`, `.neumorphic-hover` | `surfaces.css`/`motion.css` | CSS | Sin elevado pegado en táctil | Playwright con emulación táctil |
| `will-change` solo durante la animación | `motion.css` (`:227,397-398`) | CSS | 0 `will-change` permanentes | grep |
| Reemplazar `transition-all` por listas de propiedades | `buttonClasses.ts:7` (coordinar con C), `AnimatedProgressBar.tsx:37`, `SectionTabs.tsx`, `ClienteBottomNav.tsx:32`, 30 usos | ESLint | 0 `transition-all` | ESLint |
| Reduced-motion completo (`scroll-behavior`, `view-transition`, animaciones largas a final, nada se queda a medias) | `motion.css` (`:539-546`) | CSS | Todo neutralizado; contenido visible sin animación | `reducedMotion: "reduce"` en Playwright |
| Modal con `@starting-style` y `transition-behavior: allow-discrete` (sin JS) | `Modal.tsx`, `motion.css` | CSS (`@starting-style` Baseline "low" desde 2024-08-06) | Entrada/salida sin librería | Captura + teclado |
| Animación del marcador del repartidor con lerp propio | `MapComponent.tsx` (hook nuevo `useAnimatedLatLng`) | rAF; respetar `prefers-reduced-motion` (salto directo) | Movimiento continuo, sin saltos; 0 dependencias | e2e `mapa-entregados` + captura |

#### Fase 1: assets e íconos (agente E)

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| Optimizar `opsyn-dely-logo.jpg` (805 KB) e `opsyn-dely-icon.png` (571 KB) a WebP/AVIF con tamaños por uso | `public/brand/*`, `scripts/optimize-images.mjs` | `sharp` 0.35.5 (local) | <= 60 KB cada uno servido | Network |
| Definir cómo se optimizan imágenes en Cloudflare (binding `IMAGES` o loader) o dejar `unoptimized` documentado | `wrangler.jsonc`, `next.config.ts` (`images`), `docs/` | OpenNext docs | `next/image` documentado y probado en `opsyndely` | Prueba en preview |
| Reemplazar avatares `picsum.photos` por iniciales/ícono | `cliente/layout.tsx:29`, `admin/layout.tsx:59` (coordinar con C) | n/a | 0 dependencias externas de imagen en rutas clave | grep + CSP |
| Pipeline SVGO (devDependency exacta) | `package.json`, `svgo.config.mjs`, `scripts/optimize-svg.mjs` | `svgo@4.1.0` | `viewBox` conservado, ids con prefijo, `git diff` revisable | Script de verificación |
| Ilustraciones/estados vacíos como SVG inline con `currentColor` | `src/components/illustrations/*` (nuevo) | SVGO | Tema claro/oscuro sin duplicar archivos | Captura |

#### Fase 2: integración y plataforma (agentes D, B, G)

| Qué cambia | Archivos | Herramienta | Criterio | Verificación |
|---|---|---|---|---|
| View Transitions: morph lista de pedidos a detalle, deslizamiento direccional y crossfade de pestañas | `src/app/cliente/pedidos/page.tsx`, `pedidos/[id]`, `SectionTabs.tsx`, `motion.css` | `<ViewTransition>` de React (incluido en Next 16; seguir `view-transitions.md`) con `default="none"` + `share`/`enter`/`exit` | Funciona en Chrome/Safari 18+/Firefox 144+; sin soporte, navega igual; reduced-motion lo anula | e2e en Chromium + Firefox |
| Reveal con scroll-driven CSS en listas largas | `motion.css` | `animation-timeline: view()` dentro de `@supports (animation-timeline: view())` | Sin JS; en navegadores sin soporte el contenido ya está visible | Captura y comprobación sin soporte |
| Codemod de `text-[Npx]` y ajuste final de espaciados | 119 `.tsx` | Script + ESLint a `error` | 0 usos | Capturas completas |
| Lighthouse CI y `web-vitals` | `package.json` (devDeps), `.github/workflows` o script, endpoint propio | `@lhci/cli`, `web-vitals` | Presupuestos de 4.1 aplicados en CI | Ejecución del pipeline |
| Spike Motion | rama aparte | `motion` + `LazyMotion`/`m` + `domAnimation` (+24 KB) o `domMax` (+38 KB) | Solo se adopta si el Kanban o las listas con salida lo necesitan y entra en el presupuesto; si no, descartar | `next analyze` |

#### Fase 3: higiene

| Qué cambia | Archivos | Criterio |
|---|---|---|
| Retirar el remapeo de neutros de Tailwind por utilidades semánticas (`text-fg-muted`, `bg-surface`, `border-line`) con codemod gradual | `legacy-remap.css`, 119 `.tsx` | 0 reglas de remapeo; clases nuevas siempre temadas |
| Actualizar `AGENTS.md` (paleta real, tokens, reglas nuevas) | `AGENTS.md` | Documento coincide con el código |

#### Fase 5 (opcional): 3D acotado (agente F, **solo con puerta de decisión**)

Honestidad previa: en una app de delivery el valor de 3D es bajo y el costo (contenido + rendimiento + CSP) es alto. Se propone como experimento con puerta, no como compromiso.

**Puerta (todas deben cumplirse):** fases 1-2 cerradas; presupuestos en verde; existe contenido (al menos 1 modelo `.glb` de calidad, p. ej. una pizza propia); LCP de `/cliente` no empeora.

| Opción | Qué | Costo y riesgo | Recomendación |
|---|---|---|---|
| A. Sin WebGL | CSS 3D (tilt de tarjeta), SVG animado (`AnimatedClock` ya es el patrón) para "estado del pedido" | Casi 0 KB | **Hacer esto primero**; cubre "estado del pedido" |
| B. `<model-viewer>` | Visor de un producto estrella con `poster` y carga diferida | ~73 KB gzip + `three` propio; peer `three ^0.183` (no comparte versión con R3F); decodificadores desde CDN de Google por defecto, hay que alojarlos | Mejor relación esfuerzo/resultado si hay modelos |
| C. R3F + three | Hero 3D del cliente | `three` ~186 KB + R3F ~58 KB gzip (completo) + drei por partes; React Three Fiber con React 19 | Solo si B no alcanza |
| D. OGL | Shader decorativo mínimo | ~34 KB gzip completo; sin binding React | Alternativa liviana |
| E. Babylon | n/a | 1,84 MB gzip | **Descartar** |

Reglas de implementación del 3D:

- Un solo Client Component que importa con `next/dynamic(() => import(...), { ssr: false })`; nada de WebGL en Server Components ni en el bundle SSR del Worker.
- Se monta solo cuando entra en pantalla y **no** si: `prefers-reduced-motion`, `navigator.connection.saveData`, poca memoria/CPU (`navigator.deviceMemory`/`hardwareConcurrency`, valores a calibrar) o falta de WebGL. En esos casos se muestra el `poster` o una imagen WebP.
- R3F: `frameloop="demand"` con `invalidate()`, `dpr` acotado (p. ej. `[1, 1.5]`), `PerformanceMonitor` de drei para bajar calidad. (Fuente: docs de R3F, "scaling performance".)
- Modelo: <= 300 KB, <= 20 k triángulos, texturas WebP <= 512 px. Pipeline: Blender -> `gltf-transform optimize` o `gltfpack` **sin `-c`** (solo cuantización, no necesita decodificador WASM) -> `gltf-validator`. Con Draco/Meshopt/KTX2 habría que abrir la CSP (3.8): evitarlo.
- Alojar el `.glb` en R2 (`deli-gastro-productos`) y agregar su host a `connect-src`.
- Detrás de una bandera (variable de entorno o tabla de configuración) para apagarlo sin desplegar.

Criterio de aceptación: chunk perezoso <= 120 KB gzip; 0 KB en la carga inicial; LCP y CLS sin cambios; en un equipo Android de gama baja (o con throttling 4x CPU de Lighthouse) el hero no baja de 30 fps o se degrada solo a imagen.

### 4.4 Reparto en agentes y archivos (sin pisarse)

Reglas generales: cada agente trabaja en su rama y, preferentemente, en un worktree propio (el repo ya tiene `.claude/worktrees/`). Después de la fase 0.5 los CSS están partidos y cada agente tiene archivos propios. Un único PR a la vez toca `package.json`/lockfile y otro único dueño toca `next.config.ts`/`wrangler.jsonc`.

| Agente | Responsabilidad | Archivos que **posee** (puede editar) | Archivos prohibidos |
|---|---|---|---|
| **G. QA y accesibilidad** | Fase 0, tests, presupuestos, CI | `tests/contrast.test.ts`, `e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `playwright.config.ts`, `eslint.config.mjs`, `scripts/measure-*.mjs`, `docs/baseline-*.md`, `.github/workflows/*` | `src/**` (solo abre issues/PRs de reporte) |
| **A. Tokens y color** | Fase 0.5 y color | `src/app/globals.css` (solo la partición inicial), `src/styles/tokens.css`, `src/styles/legacy-remap.css`, `AGENTS.md`, los 5 archivos con hex (`MapComponent.tsx` (solo colores), `ZoneEditorMap.tsx`, `ZoneLayers.tsx`, `cliente/page.tsx:174`, `ClienteBottomNav.tsx:34`) | `components/ui/*`, `layout.tsx` |
| **B. Tipografía** | Fuentes y escala | `src/app/layout.tsx` (solo bloque de fuentes), `src/styles/typography.css`; el **codemod global** de `text-[Npx]` solo en la ventana de integración | `components/ui/*` hasta el codemod |
| **C. Superficies y primitivas** | Cards, botones, formularios, shells | `src/components/ui/*` (excepto `Modal.tsx` y `AnimatedProgressBar.tsx`), `src/lib/buttonClasses.ts`, `src/styles/surfaces.css`, `src/app/cliente/layout.tsx`, `src/app/cliente/_components/ClienteBottomNav.tsx` y `CartBar.tsx`, `src/app/admin/layout.tsx` | `motion.css`, `tokens.css` |
| **D. Movimiento** | Fase 1 CSS, fase 2 View Transitions, spike Motion | `src/styles/motion.css`, `src/components/ui/Modal.tsx`, `src/components/ui/AnimatedProgressBar.tsx`, `src/components/motion/*` (nuevo), `src/app/admin/mapa/MapComponent.tsx` (solo el hook de movimiento), `src/app/cliente/pedidos/**` (solo `ViewTransition`) | `surfaces.css`, `package.json` (pide a E) |
| **E. Assets, SVG e imágenes** | Fase 1 de assets; **dueño de `package.json`, lockfile, `next.config.ts` y `wrangler.jsonc`** | `public/brand/*`, `scripts/optimize-*.mjs`, `svgo.config.mjs`, `src/components/illustrations/*`, `package.json`, `package-lock.json`, `next.config.ts`, `wrangler.jsonc` | `src/styles/*` |
| **F. 3D (con puerta)** | Fase 5 | `src/components/three/*` (nuevo), `public/models/*` (o R2), `src/app/cliente/_components/Hero3D.tsx` (nuevo) | Todo lo demás; pide a E los cambios de CSP/dependencias |

Orden de integración:

1. G entrega la fase 0 (sin cambios en `src/`).
2. A parte `globals.css` (único PR que reestructura ese archivo). Se fusiona primero.
3. A, B, C, D y E trabajan en paralelo sobre archivos disjuntos. Las únicas coincidencias están resueltas por reglas: `buttonClasses.ts` es de C (B y D le piden cambios de `tracking`/`transition` y C los aplica en el mismo PR); `Modal.tsx` es de D (C solo le pide el uso de `Card`/radios); `package.json` y `next.config.ts` son de E.
4. Ventana de integración: B ejecuta el codemod de tipografía **al final**, con todas las ramas fusionadas, y G regenera capturas.
5. D hace View Transitions y el spike de Motion sobre `main` ya integrado.
6. F empieza solo si pasa la puerta.

Paralelismo real: G es secuencial al inicio; después A, B, C, D y E son paralelos. F depende de C/D/E.

### 4.5 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pasar a fuentes variables cambia el aspecto (negritas reales) | Capturas antes/después y aprobación visual; el cambio es intencional |
| Quitar el 90 % de la raíz altera todo el layout | Hacerlo en un PR aparte tras la escala nueva, con capturas a 375/768/1280 |
| `@import` de CSS parciales en Tailwind v4 | Spike de 10 minutos en la fase 0.5; plan B: mantener un solo archivo con secciones y bloques de propiedad por comentarios |
| `<ViewTransition>` solo funciona con el React compilado de Next | Usarlo solo en App Router y según `view-transitions.md`; no importarlo desde código compartido fuera de él |
| CSP relajada por 3D/Lottie/Rive | No aceptar `'wasm-unsafe-eval'` sin revisión de seguridad; preferir modelos cuantizados y sin WASM |
| Dos versiones de `three` (R3F 0.187 vs model-viewer 0.183) | Elegir **una** opción 3D (B o C) |
| Hover/animación distinta en equipos sin soporte de Baseline reciente | Todo con `@supports` o degradación a estado final |
| Costos de Cloudflare Images | Estimar antes de activar el binding; alternativa: pre-optimizar con `sharp` y servir WebP estático |
| Dependencias nuevas y supply chain | Política 3.9; versiones exactas; una sola persona/agente toca `package.json` |
| Hippocratic License de `react-leaflet` | Revisión legal separada; evaluar `leaflet` + wrapper propio si hace falta |

### 4.6 Definición de terminado (por PR)

- `npm run lint`, `npm test`, `npm run build` y `npm run e2e` en verde.
- `node --test tests/contrast.test.ts` en verde; axe sin `serious`/`critical`.
- Capturas comparadas contra la línea base de la fase 0 y diferencias aprobadas.
- `npx next analyze`: sin aumento por encima del presupuesto del PR.
- Prueba manual con `prefers-reduced-motion: reduce`, con foco por teclado y a 200 % de zoom.
- Si agrega una dependencia: nota con licencia, mantenimiento, provenance, avisos y tamaño, como en las tablas de la sección 3.

---

## 5. Fuentes

**Registros y datos (consultados 2026-11-10)**
- npm registry: `https://registry.npmjs.org/<paquete>` y descargas `https://api.npmjs.org/downloads/point/last-week/<paquete>`
- GitHub (API): `svg/svgo`, `jagenjo/webglstudio.js`, `jagenjo/litegl.js`, `jagenjo/litescene.js`, `tweenjs/tween.js`, `motiondivision/motion`, `greensock/GSAP`, `mrdoob/three.js`, `pmndrs/react-three-fiber`, `pmndrs/drei`, `google/model-viewer`, `BabylonJS/Babylon.js`, `donmccurdy/glTF-Transform`, `zeux/meshoptimizer`, `google/draco`, `airbnb/lottie-web`, `LottieFiles/dotlottie-web`, `rive-app/rive-wasm`, `lovell/sharp`, `gregberge/svgr`, `radix-ui/colors`, `danburzo/culori`, `color-js/color.js`, `fontsource/fontsource`, `formkit/auto-animate`, `dequelabs/axe-core`, `PaulLeCam/react-leaflet`
- Avisos: `https://github.com/advisories/GHSA-w27v-7q3p-w38r`, `.../GHSA-4vpr-x523-8j87`, `.../GHSA-2p49-hgcm-8545`, `.../GHSA-xpqw-6gx7-v673`, `.../GHSA-wq5f-xc86-pv6w`; OSV `https://api.osv.dev/v1/querybatch`; Snyk `https://security.snyk.io/package/npm/svgo`; Socket `https://socket.dev/npm/package/@tweenjs/tween.js`
- Bundlephobia: `https://bundlephobia.com/api/size?package=<paquete>@<versión>`

**Documentación**
- WebGLStudio: `https://github.com/jagenjo/webglstudio.js` y `https://onedit.org/`
- tween.js: `https://github.com/tweenjs/tween.js` y `https://github.com/tweenjs/tween.js/releases/tag/v25.0.0`
- SVGO: `https://svgo.dev/docs/preset-default/`, `https://github.com/svg/svgo/releases/tag/v4.0.0`
- Motion: `https://motion.dev/docs/react-reduce-bundle-size`, `https://motion.dev/docs/gsap-vs-motion` (comparación de un proveedor interesado)
- GSAP: `https://gsap.com/standard-license`
- Plataforma: `https://github.com/web-platform-dx/web-features` (scroll-driven-animations, view-transitions, light-dark, text-wrap-balance, starting-style, oklab, color-mix, backdrop-filter), `https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline/scroll`, `https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API`, `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src`, `https://web.dev/articles/animations-guide`
- WCAG 2.2: `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html`, `.../non-text-contrast.html`, `.../target-size-minimum.html`
- Tailwind v4: `https://tailwindcss.com/docs/dark-mode`, `https://tailwindcss.com/docs/theme`
- Next 16 (locales): `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`, `lazy-loading.md`, `package-bundling.md`, `01-getting-started/13-fonts.md`, `03-api-reference/02-components/font.md`, `link.md`
- OpenNext Cloudflare: `https://opennext.js.org/cloudflare`, `https://opennext.js.org/cloudflare/howtos/image`
- Leaflet: `https://leafletjs.com/reference.html`
- 3D: `https://modelviewer.dev/examples/loading/`, `https://gltf-transform.dev/cli`, `https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md`, `https://r3f.docs.pmnd.rs/advanced/scaling-performance`
- Lottie/Rive: `https://github.com/LottieFiles/dotlottie-web/wiki/CSP-and-WASM-Self%E2%80%90Hosting-Guide`, `https://rive.app/docs/runtimes/web/preloading-wasm`
- Neumorfismo y accesibilidad: `https://axesslab.com/neumorphism/`, `https://medium.com/@xurxe/accessible-neumorphism-soft-ui-992286900bfa`
- Utopia: `https://utopia.fyi/`
- Cloudflare Web Analytics: `https://developers.cloudflare.com/web-analytics/`

**Pendiente de verificar (resumen)**: SSR-safety de importar tween.js; si `@formkit/auto-animate` respeta reduced-motion; compatibilidad en ejecución de R3F con el React 19.3 canary de Next; soporte `tnum` en Manrope/Inter; si `next/image` optimiza hoy en producción sin el binding `IMAGES`; si Cloudflare Web Analytics informa Core Web Vitals; Socket/Snyk para la mayoría de paquetes.

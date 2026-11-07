<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Skills disponibles en este proyecto

Todas las skills están en `./Skills/`. Leer el SKILL.md correspondiente antes de usarlas.

## Diseño UI/UX — Stitch Kit

| Skill | Carpeta | Uso |
|---|---|---|
| **stitch-orchestrator** | `Skills/stitch-orchestrator` | Flujo completo stitch: ideación → spec → componentes → a11y |
| **stitch-nextjs-components** | `Skills/stitch-nextjs-components` | Convierte diseños en componentes Next.js 15 App Router (Server/Client split, TypeScript strict) |
| **stitch-design-system** | `Skills/stitch-design-system` | Aplica consistencia visual al sistema neumórfico existente |
| **stitch-a11y** | `Skills/stitch-a11y` | Validación WCAG AA/AAA — contraste, aria, teclado |
| **stitch-animate** | `Skills/stitch-animate` | Agrega animaciones consistentes (Tailwind keyframes, Framer Motion) |
| **stitch-shadcn-ui** | `Skills/stitch-shadcn-ui` | Genera componentes al estilo shadcn/ui adaptables al neumorfismo |
| **stitch-react-components** | `Skills/stitch-react-components` | Componentes React puros con TypeScript strict |
| **stitch-html-components** | `Skills/stitch-html-components` | Componentes HTML5 semánticos |
| **stitch-ideate** | `Skills/stitch-ideate` | Analiza tendencias, propone 3 direcciones de diseño |
| **stitch-ued-guide** | `Skills/stitch-ued-guide` | Guía de experiencia de usuario |
| **stitch-ui-design-spec-generator** | `Skills/stitch-ui-design-spec-generator` | Genera specs de diseño detalladas |
| **stitch-ui-design-variants** | `Skills/stitch-ui-design-variants` | Genera variantes UI de un componente |
| **stitch-ui-prompt-architect** | `Skills/stitch-ui-prompt-architect` | Ingeniería de prompts para generación de UI |
| **stitch-design-md** | `Skills/stitch-design-md` | Crea y gestiona DESIGN.md del proyecto |
| **stitch-loop** | `Skills/stitch-loop` | Ciclo iterativo de refinamiento de diseño |

## Diseño UI/UX — Complementarios

| Skill | Carpeta | Uso |
|---|---|---|
| **ui-ux-pro-max** | `Skills/ui-ux-pro-max` | Jerarquía visual, spacing, estados interactivos, audit completo UX |
| **magicui** | `Skills/magicui` | Componentes animados de Magic UI para enriquecer el sistema |
| **the-architect** | `Skills/the-architect` | Decisiones de arquitectura técnica y de componentes |

## Workflow y ejecución

| Skill | Carpeta | Uso |
|---|---|---|
| **stitch-orchestrator** | `Skills/stitch-orchestrator` | Coordina el flujo completo de diseño → código |
| **writing-plans** | `Skills/writing-plans` | Crea planes de implementación estructurados |
| **executing-plans** | `Skills/executing-plans` | Ejecuta planes con checkpoints y control de estado |
| **verification-before-completion** | `Skills/verification-before-completion` | Verifica que el trabajo cumpla lo especificado antes de cerrar |
| **subagent-driven-development** | `Skills/subagent-driven-development` | Descompone tareas y las delega a subagentes paralelos |
| **systematic-debugging** | `Skills/systematic-debugging` | Debugging metódico para UI/lógica |
| **using-superpowers** | `Skills/using-superpowers` | Guía de uso de todas las capacidades de agente |

---

## Cloudflare: cuenta única del proyecto

**Todo va en la cuenta Opsyn-La gambeta Dely**: ID `e7351dd776e005da826ba6f2a5aae4c1`, subdominio `opsyn-la-gambeta-dely.workers.dev`, zona `la-gambeta.com`.

- NUNCA desplegar, crear recursos ni loguearse en otra cuenta (Opsyn wallet, Proyectos OPSYN, Opsyn Dely). Si algo vive en otra cuenta, se migra a esta.
- Ninguna URL, secreto o webhook nuevo apunta a `opsyn-dely.workers.dev` ni a `frankie-400.workers.dev`.
- Antes de desplegar, confirmar que el `account_id` del wrangler sea el de arriba. App: `bash scripts/cf-deploy.sh`.
- Workers de esta cuenta: `opsyn-dely` (`opsyndely.la-gambeta.com`), `whatsapp-bot`, `fudo-gateway`.
- Falta migrar: `uploads`, `pedidos-webhook`, `finanzas-sync`, `encuestas-cron`. `dely-proxy` queda sin uso cuando el webhook de Meta apunte directo a `whatsapp-bot`.

---

## Contexto del Design System Deli-Gastro

**Stack:** Next.js 16.2.4 App Router · TypeScript · Tailwind CSS v4 · Supabase SSR · React-Leaflet · n8n

**Tokens de color (globals.css):**
- Fondo raised: `#f0f3f8` | Fondo inset: `#e0e5ec`
- Naranja primario: `#ff7b00` (`--color-brand-orange`) | Hover: `#e66e00`
- Verde acento: `#4bfd39` (`--color-brand-green`)

**Clases utilitarias existentes:**
`.neumorphic` `.neumorphic-inset` `.neumorphic-hover` `.btn-glow` `.badge-green` `.badge-red` `.badge-blue` `.badge-yellow` `.badge-orange` `.glass-effect` `.card-hover-lift` `.page-fade` `.fade-up-1..4`

**Fuentes:** Manrope (títulos/display) + Inter (cuerpo/labels) — cargadas con `next/font` en `layout.tsx`

**Reglas absolutas:**
1. Tema claro/oscuro global, **oscuro por defecto** (`<html data-theme>`, `src/lib/theme/`). Sin clases `dark:`: los colores salen de los tokens `--app-*` de `globals.css`; los neutros de Tailwind se remapean ahí. Colores nuevos → token, no hex fijo.
2. NUNCA emojis como íconos estructurales → usar Lucide React
3. SIEMPRE `aria-label` en botones icon-only
4. NUNCA `<button>` anidado dentro de `<Link>`
5. Sin Material Symbols (eliminar `<link>` de `layout.tsx:31`)

**Portales:**
- Admin: `/src/app/admin/` — sidebar fijo, Kanban, mapa Leaflet, productos, puntos, configuración
- Cliente: `/src/app/cliente/` — `max-w-2xl mx-auto`, bottom-nav, chat IA, reseñas, fidelidad

**Fase 1 activa — componentes a crear en `src/components/ui/`:**
`Button` · `Modal` (con focus trap) · `Field` (label+input+error) · `Switch` · `Badge` · `Card` · `PageContainer` · `src/lib/cn.ts` · `src/lib/useFocusTrap.ts`

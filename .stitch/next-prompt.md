---
page: dashboard_admin
---
Una interfaz web de Dashboard de Administración para un restaurante de Delivery Gastronómico. Debe permitir la gestión de pedidos mediante un formato Kanban y mostrar KPIs rápidos.

**DESIGN SYSTEM (REQUIRED):**
# Design System Strategy: The Culinary Curator

## 1. Overview & Creative North Star
The "Culinary Curator" is our Creative North Star. In a market flooded with cluttered, grid-heavy delivery apps, this design system breaks the "template" look by treating food delivery as a high-end editorial experience. We move away from the "utility-first" aesthetic to a "photography-first" philosophy.

**The signature look is defined by:**
*   **Intentional Asymmetry:** Breaking the rigid 2-column grid to allow hero food items to "bleed" off-canvas or overlap containers.
*   **Tonal Depth:** Replacing 1px borders with sophisticated layer stacking.
*   **High-Contrast Editorial Type:** Pairing the technical precision of *Manrope* with the bold, charismatic personality of *Plus Jakarta Sans*.
*   **Breathing Room:** Using generous white space (Spacing 6 and 8) to ensure the vibrant primary green feels like a premium accent, not a chaotic noise.

---

## 2. Colors & Surface Philosophy
The palette centers on a high-energy `primary` green, balanced by a sophisticated range of `surface` and `secondary` tones to maintain a professional, reliable "gastronomic" feel.

### The "No-Line" Rule
**Strict Directive:** 1px solid borders are prohibited for sectioning. Contrast and boundaries must be achieved through background shifts.
*   Place a `surface-container-low` card on a `surface` background.
*   Use `surface-container-lowest` (pure white) only for the highest priority interactive elements or floating "Glassmorphism" panels.

### Surface Hierarchy & Nesting
Treat the UI as physical layers. An inner container should always be one "tier" higher or lower than its parent to define importance without lines.
*   **Base:** `surface` (#f5f6f7)
*   **Sectioning:** `surface-container` (#e6e8ea)
*   **High-Priority Cards:** `surface-container-lowest` (#ffffff)

### The "Glass & Gradient" Rule
To elevate the app beyond a standard "out-of-the-box" feel:
*   **Glassmorphism:** Use `surface-container-lowest` at 80% opacity with a `backdrop-blur` of 12px for floating navigation bars or "Add to Cart" modals.
*   **Signature Textures:** Apply a subtle linear gradient from `primary` (#016b00) to `primary-container` (#4bfd39) on main Action Buttons to give them a "juice" and dimension that feels edible and fresh.

---

## 3. Typography
We use two sans-serif families to balance energy with reliability.

*   **Display & Headline (Plus Jakarta Sans):** These are our "Voice." Use `display-lg` and `headline-md` for restaurant names and category headers. The wider aperture of Jakarta Sans feels modern, welcoming, and premium.
*   **Body & Title (Manrope):** This is our "Engine." Manrope’s geometric precision ensures that prices, delivery times, and ingredient lists remain highly legible even at `body-sm` (0.75rem).
*   **The Hierarchy Goal:** Large, bold headlines (`headline-lg`) paired with much smaller, high-tracking labels (`label-md`) creates an editorial "magazine" contrast that guides the eye instantly to the most important content.

---

## 4. Elevation & Depth
In this system, depth is organic, not artificial.

*   **Tonal Layering:** Avoid shadows for static cards. Instead, use the `surface-container` scale. A `surface-container-highest` element sitting on a `surface` background provides enough contrast for the eye to perceive depth.
*   **Ambient Shadows:** For "floating" elements (e.g., a floating Action Button), use a highly diffused shadow:
    *   *X: 0, Y: 8, Blur: 24, Spread: -4*
    *   *Color:* Use `on-surface` (#2c2f30) at 6% opacity. This mimics natural light rather than a harsh digital drop shadow.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., an inactive input state), use `outline-variant` (#abadae) at **20% opacity**. Never use 100% opaque outlines.

---

## 5. Components

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary-container`), `on-primary-container` text. Radius: `full`.
*   **Secondary:** `surface-container-highest` background with `on-surface` text. No border.
*   **Micro-Interaction:** On press, scale the button to 96% to provide tactile feedback.

### Cards & Food Displays
*   **Rule:** Forbid divider lines.
*   **Construction:** Use `surface-container-low` as the card base. The food image should use a `xl` (1.5rem) rounded corner, while the card container uses a `lg` (1rem) corner. This "nested rounding" creates a bespoke, high-end feel.
*   **Spacing:** Use `spacing-4` (1rem) internal padding.

### Input Fields
*   **State:** Use `surface-container` for the background. When focused, shift to `surface-container-lowest` and add a `primary` "Ghost Border" at 40% opacity.
*   **Labels:** Use `label-md` in `on-surface-variant` positioned 0.5rem above the input.

### Custom Component: The "Hero Plate"
For top-rated restaurants, use a circular image mask that overlaps the container edge by `spacing-4`. This breaks the "boxiness" of the mobile screen and creates a signature visual rhythm.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use `surface-container-lowest` for floating "Add to Cart" bars to make them feel like they are hovering above the content.
*   **Do** use `spacing-8` (2rem) between major sections to let the high-quality food photography "breathe."
*   **Do** use `primary-fixed` for price tags to make them pop against food imagery.

### Don’t:
*   **Don’t** use pure black (#000000) for text. Always use `on-surface` (#2c2f30) to maintain a soft, professional tone.
*   **Don’t** use `spacing-px` or `spacing-1` for layout. Small gaps create visual "vibration" and clutter. Stick to `spacing-2` as your minimum.
*   **Don’t** use 1px dividers to separate menu items. Use a `spacing-4` vertical gap and a subtle shift from `surface` to `surface-container-low`.

**Page Structure:**
1. Sidebar navigation with menu items (Dashboard, Pedidos, Productos, Ajustes).
2. Header with user profile, notifications, and search bar.
3. KPIs section (Ventas, Nuevos Pedidos, Pedidos Entregados).
4. Kanban board for active orders (Recibido, En Preparación, Listo, En Camino, Entregado).
5. Usa el estilo "Culinary Curator" para todos los componentes. Sin bordes divisorios de 1px. Usa tonos grises sutiles y tarjetas anidadas sin sombras fuertes para separar las columnas del Kanban.

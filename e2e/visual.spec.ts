import { expect, test } from "@playwright/test";
import { openUiRoute, UI_ROUTES, UI_THEMES, UI_VIEWPORTS } from "./support/ui-baseline";

// Baselines solo locales (Windows): ver docs/baseline-ui-2026-11.md. Se corren con `npm run e2e:visual`.
for (const route of UI_ROUTES) {
  for (const theme of UI_THEMES) {
    for (const viewport of UI_VIEWPORTS) {
      test(`${route.slug} ${theme} ${viewport.width}`, async ({ browser }) => {
        const { context, page } = await openUiRoute(browser, route, theme, viewport);
        try {
          await expect(page).toHaveScreenshot(`${route.slug}-${theme}-${viewport.width}.png`, {
            fullPage: true,
            mask: [page.locator(".leaflet-tile-pane"), page.locator(".leaflet-control-attribution")],
          });
        } finally {
          await context.close();
        }
      });
    }
  }
}

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";
import { openUiRoute, UI_ROUTES, UI_THEMES } from "./support/ui-baseline";

// Auditoría de la línea base: reporta y no falla. Se corre con `npm run e2e:a11y`.
const REPORT_DIR = join("test-results", "a11y");
const RAW_DIR = join(REPORT_DIR, "raw");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AUDIT_TAGS = [...WCAG_TAGS, "best-practice"];
const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;

interface Finding {
  readonly rule: string;
  readonly impact: string;
  readonly help: string;
  readonly wcag: boolean;
  readonly nodes: number;
}

interface PageResult {
  readonly route: string;
  readonly theme: string;
  readonly width: number;
  readonly findings: readonly Finding[];
}

function countByImpact(results: readonly PageResult[], onlyWcag: boolean): Record<string, number> {
  const findings = results.flatMap((result) => result.findings).filter((finding) => !onlyWcag || finding.wcag);
  return Object.fromEntries(IMPACTS.map((impact) => [impact, findings.filter((f) => f.impact === impact).length]));
}

function ruleTable(results: readonly PageResult[]): string[] {
  const rows = new Map<string, { impact: string; help: string; pages: number; nodes: number }>();
  for (const finding of results.flatMap((result) => result.findings)) {
    const row = rows.get(finding.rule) ?? { impact: finding.impact, help: finding.help, pages: 0, nodes: 0 };
    rows.set(finding.rule, { ...row, pages: row.pages + 1, nodes: row.nodes + finding.nodes });
  }
  return [...rows.entries()]
    .sort(([, a], [, b]) => IMPACTS.indexOf(a.impact as (typeof IMPACTS)[number]) - IMPACTS.indexOf(b.impact as (typeof IMPACTS)[number]))
    .map(([rule, row]) => `| ${rule} | ${row.impact} | ${row.pages} | ${row.nodes} | ${row.help} |`);
}

function pageRow(result: PageResult): string {
  const count = (impact: string) => result.findings.filter((finding) => finding.impact === impact).length;
  return `| ${result.route} | ${result.theme} | ${result.width} | ${IMPACTS.map(count).join(" | ")} |`;
}

function writeReport(): void {
  const results = readdirSync(RAW_DIR)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(RAW_DIR, name), "utf8")) as PageResult);
  writeFileSync(join(REPORT_DIR, "axe-report.json"), JSON.stringify(results, null, 2));
  writeFileSync(
    join(REPORT_DIR, "axe-report.md"),
    [
      "# Auditoría axe",
      "",
      "Cada celda cuenta reglas violadas (no nodos).",
      "",
      `Total reglas violadas por impacto: ${JSON.stringify(countByImpact(results, false))}`,
      `Solo WCAG: ${JSON.stringify(countByImpact(results, true))}`,
      "",
      "| Ruta | Tema | Ancho | critical | serious | moderate | minor |",
      "|---|---|---|---|---|---|---|",
      ...results.map(pageRow),
      "",
      "| Regla | Impacto | Páginas | Nodos | Descripción |",
      "|---|---|---|---|---|",
      ...ruleTable(results),
      "",
    ].join("\n"),
  );
}

test.beforeAll(() => {
  mkdirSync(RAW_DIR, { recursive: true });
});

test.afterAll(() => {
  writeReport();
});

for (const route of UI_ROUTES) {
  for (const theme of UI_THEMES) {
    test(`axe ${route.slug} ${theme}`, async ({ browser }) => {
      const viewport = { width: route.auditWidth, height: 900 };
      const { context, page } = await openUiRoute(browser, route, theme, viewport);
      try {
        const { violations } = await new AxeBuilder({ page }).withTags(AUDIT_TAGS).analyze();
        const result: PageResult = {
          route: route.path,
          theme,
          width: route.auditWidth,
          findings: violations.map((violation) => ({
            rule: violation.id,
            impact: violation.impact ?? "minor",
            help: violation.help,
            wcag: violation.tags.some((tag) => WCAG_TAGS.includes(tag)),
            nodes: violation.nodes.length,
          })),
        };
        writeFileSync(join(RAW_DIR, `${route.slug}-${theme}.json`), JSON.stringify(result));
      } finally {
        await context.close();
      }
    });
  }
}

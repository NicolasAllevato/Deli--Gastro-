/**
 * D1 como única fuente: zonas de delivery y reports_daily en la capa de datos.
 * Escrituras solo staff (admin/sistema); montos en pesos hacia afuera, centavos en D1.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { createZone, deleteZone, listAllZones, updateZone } from "../src/lib/data/zones.ts";
import { upsertDailyReport } from "../src/lib/data/reports.ts";
import { listDailyReports } from "../src/lib/data/catalog.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

const circle = { type: "circle" as const, lat: -34.6, lng: -58.4, radius_km: 3 };
const zone = { name: "Centro", shape: circle, fee: 1500.5, min_order: 8000, sort_order: 1, is_active: true };

describe("zonas de delivery (D1)", () => {
  it("crea, lista, edita y borra en pesos con centavos en D1", async () => {
    const z = await createZone(db, actors.admin, "11111111-1111-4111-8111-111111111111", zone);
    assert.equal(z.fee, 1500.5);
    assert.deepEqual(z.shape, circle);
    const raw = db.raw.prepare("SELECT fee_cents, min_order_cents FROM delivery_zones WHERE id = ?").get(z.id) as Record<string, number>;
    assert.deepEqual({ ...raw }, { fee_cents: 150050, min_order_cents: 800000 });

    const u = await updateZone(db, actors.admin, z.id, { fee: 2000, is_active: false });
    assert.ok(u);
    assert.equal(u.fee, 2000);
    assert.equal(u.is_active, false);
    assert.equal(u.name, "Centro", "un PATCH parcial no pisa el resto");

    assert.equal((await listAllZones(db, actors.admin)).length, 1);
    assert.equal(await deleteZone(db, actors.admin, z.id), true);
    assert.equal((await listAllZones(db, actors.admin)).length, 0);
  });

  it("editar una zona inexistente devuelve null", async () => {
    assert.equal(await updateZone(db, actors.admin, "22222222-2222-4222-8222-222222222222", { fee: 1 }), null);
  });

  it("rechaza campos fuera de la lista blanca", async () => {
    const z = await createZone(db, actors.admin, "33333333-3333-4333-8333-333333333333", zone);
    await assert.rejects(updateZone(db, actors.admin, z.id, { id: "x" } as never));
  });

  for (const who of ["anon", "ana", "rep1"] as const) {
    it(`${who} no puede escribir ni listar zonas`, async () => {
      const a = actors[who];
      await assert.rejects(createZone(db, a, "44444444-4444-4444-8444-444444444444", zone), ForbiddenError);
      await assert.rejects(updateZone(db, a, "44444444-4444-4444-8444-444444444444", { fee: 1 }), ForbiddenError);
      await assert.rejects(deleteZone(db, a, "44444444-4444-4444-8444-444444444444"), ForbiddenError);
      await assert.rejects(listAllZones(db, a), ForbiddenError);
    });
  }
});

describe("reports_daily (D1)", () => {
  it("upsert por fecha: no duplica y guarda centavos", async () => {
    await upsertDailyReport(db, actors.system, { report_date: "2026-11-13", total_income: 1000.25, total_orders: 3, orders_cancelled: 1 });
    await upsertDailyReport(db, actors.system, { report_date: "2026-11-13", total_income: 2000, total_orders: 4, orders_cancelled: 0 });
    const rows = await listDailyReports(db, actors.admin, "2026-11-01", "2026-11-30");
    assert.equal(rows.length, 1);
    const n = db.raw.prepare("SELECT total_income_cents, total_orders FROM reports_daily").get() as Record<string, number>;
    assert.deepEqual({ ...n }, { total_income_cents: 200000, total_orders: 4 });
  });

  it("rechaza fecha inválida", async () => {
    await assert.rejects(upsertDailyReport(db, actors.system, { report_date: "13/11/2026", total_income: 0, total_orders: 0, orders_cancelled: 0 }));
  });

  for (const who of ["anon", "ana", "rep1"] as const) {
    it(`${who} no puede escribir reports_daily`, async () => {
      await assert.rejects(
        upsertDailyReport(db, actors[who], { report_date: "2026-11-13", total_income: 0, total_orders: 0, orders_cancelled: 0 }),
        ForbiddenError,
      );
    });
  }
});

describe("rutas del área: con DATA_BACKEND=d1 no tocan Supabase", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("/api/zones escribe por la capa (dualWrite) y no usa supabase-js directo", () => {
    const src = read("src/app/api/zones/route.ts");
    assert.match(src, /dualWrite/);
    assert.match(src, /\.zones\.(create|update|remove)/);
    assert.doesNotMatch(src, /@supabase\//);
  });
  it("createAdminClient enruta a D1 con DATA_BACKEND=d1", () => {
    const src = read("src/utils/supabase/admin.ts");
    assert.match(src, /dataBackend\(\) === "d1"\) return createD1AdminClient\(\)/);
  });
  const area = [
    "src/app/api/products/route.ts", "src/app/api/categories/route.ts", "src/app/api/config/route.ts",
    "src/app/api/admin/reports/route.ts", "src/app/api/admin/reports/export/route.ts", "src/app/api/admin/clients/export/route.ts",
    "src/app/api/admin/executive/route.ts", "src/app/api/admin/executive/settings/route.ts", "src/app/api/admin/daily-summary/route.ts",
    "src/app/api/cron/daily-summary/route.ts", "src/app/api/admin/catalog/import/route.ts", "src/app/api/admin/catalog/export/route.ts",
    "src/lib/reports/data.ts", "src/lib/daily-summary/send.ts", "src/lib/delivered-map-server.ts", "src/lib/zones-server.ts",
    "src/lib/catalog/apply.ts", "src/app/admin/tablero/page.tsx", "src/app/admin/productos/page.tsx", "src/app/admin/carta/page.tsx",
  ];
  for (const f of area) {
    it(`${f} solo obtiene la base por createAdminClient/@/lib/data`, () => {
      const src = read(f);
      assert.doesNotMatch(src, /from "@supabase\/(supabase-js|ssr)"/);
      assert.doesNotMatch(src, /SUPABASE_(URL|SERVICE_ROLE_KEY)|\/rest\/v1\//);
    });
  }
});

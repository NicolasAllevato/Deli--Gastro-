import test from "node:test";
import assert from "node:assert/strict";
import { buildZoneResolver, fetchByCursor, toReviewInputs } from "../src/lib/reports/executiveZones.ts";
import type { DeliveryZone } from "../src/lib/zones.ts";
import type { ReportOrder } from "../src/lib/reports/analytics.ts";

const zone = (id: string, name: string, lat: number, sort_order: number, is_active = true): DeliveryZone => ({
  id, name, fee: 0, min_order: 0, sort_order, is_active,
  shape: { type: "circle", lat, lng: -58, radius_km: 2 },
});

const order = (id: string) => ({ id }) as ReportOrder;

test("zoneOf resuelve la zona por coordenadas y devuelve null sin ellas", () => {
  const zones = [zone("Z1", "Centro", -34, 1), zone("Z2", "Norte", -33, 2)];
  const { zoneOf, zoneNames } = buildZoneResolver(
    [
      { id: "a", delivery_lat: -34, delivery_lng: -58 },
      { id: "b", delivery_lat: "-33", delivery_lng: "-58" },
      { id: "c", delivery_lat: null, delivery_lng: null },
      { id: "d", delivery_lat: -10, delivery_lng: -58 },
    ],
    zones,
  );
  assert.equal(zoneOf(order("a")), "Z1");
  assert.equal(zoneOf(order("b")), "Z2");
  assert.equal(zoneOf(order("c")), null);
  assert.equal(zoneOf(order("d")), null);
  assert.equal(zoneOf(order("zzz")), null);
  assert.deepEqual(zoneNames, { Z1: "Centro", Z2: "Norte" });
});

test("las zonas inactivas no asignan pedidos pero conservan su nombre", () => {
  const { zoneOf, zoneNames } = buildZoneResolver(
    [{ id: "a", delivery_lat: -34, delivery_lng: -58 }],
    [zone("Z1", "Centro", -34, 0, false)],
  );
  assert.equal(zoneOf(order("a")), null);
  assert.equal(zoneNames.Z1, "Centro");
});

test("toReviewInputs mapea feedback a comment sin mutar la entrada", () => {
  const rows = [{ order_id: "o1", rating: 2, feedback: "frío", created_at: "2026-01-01T00:00:00Z" }];
  const out = toReviewInputs(rows);
  assert.deepEqual(out, [{ rating: 2, created_at: "2026-01-01T00:00:00Z", order_id: "o1", comment: "frío" }]);
  assert.equal("comment" in rows[0]!, false);
});

test("fetchByCursor pagina con cursor (created_at, id) y no marca truncated si termina", async () => {
  const all = [
    { id: "c", created_at: "2026-10-03T10:00:00Z" },
    { id: "b", created_at: "2026-10-03T10:00:00Z" },
    { id: "a", created_at: "2026-10-02T10:00:00Z" },
  ];
  const cursors: unknown[] = [];
  const result = await fetchByCursor(
    async (cursor) => {
      cursors.push(cursor);
      return { data: cursor ? all.slice(2) : all.slice(0, 2), error: null };
    },
    2,
    5,
  );
  assert.deepEqual(result.rows.map((r) => r.id), ["c", "b", "a"]);
  assert.equal(result.truncated, false);
  assert.deepEqual(cursors, [null, { created_at: "2026-10-03T10:00:00Z", id: "b" }]);
});

test("fetchByCursor devuelve truncated: true al llegar al tope con la última página llena", async () => {
  let n = 0;
  const result = await fetchByCursor(
    async () => ({ data: [{ id: `r${n}`, created_at: `2026-10-0${++n}T00:00:00Z` }], error: null }),
    1,
    3,
  );
  assert.equal(result.rows.length, 3);
  assert.equal(result.truncated, true);
});

test("fetchByCursor propaga errores", async () => {
  await assert.rejects(fetchByCursor(async () => ({ data: null, error: { message: "x" } }), 10, 2));
});

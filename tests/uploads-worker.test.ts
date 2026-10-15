import { test } from "node:test";
import assert from "node:assert/strict";
import { getUploadsWorkerConfig, uploadViaWorker } from "../src/lib/storage/uploads-worker.ts";

test("config: null si falta URL o token", () => {
  assert.equal(getUploadsWorkerConfig({}), null);
  assert.equal(getUploadsWorkerConfig({ UPLOADS_WORKER_URL: "https://x.dev" }), null);
  assert.deepEqual(
    getUploadsWorkerConfig({ UPLOADS_WORKER_URL: "https://x.dev/", UPLOADS_WORKER_TOKEN: "t" }),
    { url: "https://x.dev", token: "t" },
  );
});

test("uploadViaWorker envía bearer y content-type y devuelve la URL", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ success: true, key: "productos/a.png", url: "https://pub.r2.dev/productos/a.png" }), { status: 201 });
  }) as unknown as typeof fetch;
  const url = await uploadViaWorker({ url: "https://w.dev", token: "tok" }, new Uint8Array([1]).buffer, "image/png", fake);
  assert.equal(url, "https://pub.r2.dev/productos/a.png");
  assert.equal(seen!.url, "https://w.dev/upload");
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer tok");
  assert.equal(h["content-type"], "image/png");
});

test("uploadViaWorker propaga el error del Worker", async () => {
  const fake = (async () => new Response(JSON.stringify({ error: "El contenido no es una imagen válida." }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(
    uploadViaWorker({ url: "https://w.dev", token: "tok" }, new Uint8Array([1]).buffer, "image/png", fake),
    /no es una imagen válida/,
  );
});

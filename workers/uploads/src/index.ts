import { isAuthorized, isValidObjectKey, MAX_SIZE_BYTES, validateImage } from "./validate";

export interface Env {
  BUCKET: R2Bucket;
  /** Bearer compartido con la ruta Next `/api/upload` (secret). */
  UPLOADS_TOKEN: string;
  /** Base pública del bucket (r2.dev o dominio propio), var no secreta. */
  PUBLIC_BASE_URL: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SIZE_BYTES) return json({ error: "El archivo supera el límite de 5MB." }, 413);

  const bytes = new Uint8Array(await request.arrayBuffer());
  const result = validateImage(request.headers.get("content-type"), bytes);
  if (!result.ok) return json({ error: result.error }, 400);

  const key = `productos/${crypto.randomUUID()}.${result.ext}`;
  await env.BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: request.headers.get("content-type")!.split(";")[0].trim(),
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  return json({ success: true, key, url }, 201);
}

async function handleDelete(key: string, env: Env): Promise<Response> {
  if (!isValidObjectKey(key)) return json({ error: "Clave inválida." }, 400);
  await env.BUCKET.delete(key);
  return json({ success: true });
}

/**
 * Worker `uploads`: sube imágenes de productos al bucket R2 vía binding, sin
 * necesitar las R2 API keys S3. Solo lo llama el servidor Next (`/api/upload`),
 * que ya autenticó al admin; acá se exige el bearer compartido.
 *
 *   POST   /upload                 body = bytes de la imagen, content-type real
 *   DELETE /objects/productos/<uuid>.<ext>
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAuthorized(request.headers.get("authorization"), env.UPLOADS_TOKEN)) {
      return json({ error: "No autorizado." }, 401);
    }
    const { pathname } = new URL(request.url);
    try {
      if (request.method === "POST" && pathname === "/upload") return await handleUpload(request, env);
      if (request.method === "DELETE" && pathname.startsWith("/objects/")) {
        let key: string;
        try {
          key = decodeURIComponent(pathname.slice("/objects/".length));
        } catch {
          return json({ error: "Clave inválida." }, 400);
        }
        return await handleDelete(key, env);
      }
      return json({ error: "No encontrado." }, 404);
    } catch (error: unknown) {
      console.error("uploads worker error", error instanceof Error ? error.message : error);
      return json({ error: "Error interno subiendo el archivo." }, 500);
    }
  },
};

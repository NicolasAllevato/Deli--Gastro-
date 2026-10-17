import { z } from "zod";

const workerResponseSchema = z.object({
  success: z.literal(true),
  key: z.string(),
  url: z.string().url(),
});

export interface UploadsWorkerConfig {
  url: string;
  token: string;
}

/** Devuelve la config del Worker `uploads` si ambas variables están seteadas. */
export function getUploadsWorkerConfig(env: Readonly<Record<string, string | undefined>> = process.env): UploadsWorkerConfig | null {
  const url = env.UPLOADS_WORKER_URL?.trim();
  const token = env.UPLOADS_WORKER_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

const UPLOAD_TIMEOUT_MS = 15_000;

/** Sube la imagen al Worker `uploads` (binding R2) y devuelve su URL pública. */
export async function uploadViaWorker(
  config: UploadsWorkerConfig,
  bytes: ArrayBuffer,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${config.url}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Worker de uploads respondió ${res.status}.`;
    throw new Error(message);
  }
  return workerResponseSchema.parse(body).url;
}

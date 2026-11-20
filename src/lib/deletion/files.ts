/** Bucket privado de fotos de reclamos (binding `RECLAMOS`) para borrarlas al eliminar datos. null fuera de Cloudflare o sin binding. */
import type { PortFiles } from "./api.ts";

interface R2Like {
  delete(keys: string | string[]): Promise<void>;
}

export async function reclamosFileStore(): Promise<PortFiles | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const bucket = (getCloudflareContext().env as { RECLAMOS?: R2Like }).RECLAMOS;
    return bucket ? { delete: (keys) => bucket.delete(keys) } : null;
  } catch {
    return null;
  }
}

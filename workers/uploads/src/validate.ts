export const MAX_SIZE_BYTES = 5 * 1024 * 1024;

type AllowedType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSIONS: Record<AllowedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ValidationResult = { ok: true; ext: string } | { ok: false; error: string };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

function matchesSignature(type: AllowedType, bytes: Uint8Array): boolean {
  switch (type) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
}

/** Valida tipo declarado, tamaño y firma real (magic bytes) de la imagen. */
export function validateImage(contentType: string | null, bytes: Uint8Array): ValidationResult {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!(type in EXTENSIONS)) return { ok: false, error: "Tipo no permitido. Usá JPG, PNG o WEBP." };
  if (bytes.byteLength === 0) return { ok: false, error: "Archivo vacío." };
  if (bytes.byteLength > MAX_SIZE_BYTES) return { ok: false, error: "El archivo supera el límite de 5MB." };
  const allowed = type as AllowedType;
  if (!matchesSignature(allowed, bytes)) return { ok: false, error: "El contenido no es una imagen válida." };
  return { ok: true, ext: EXTENSIONS[allowed] };
}

/** Compara `Authorization: Bearer <token>` en tiempo constante. */
export function isAuthorized(header: string | null, expected: string): boolean {
  if (!header || !expected || !header.startsWith("Bearer ")) return false;
  const enc = new TextEncoder();
  const a = enc.encode(header.slice(7));
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const KEY_RE = /^productos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isValidObjectKey(key: string): boolean {
  return KEY_RE.test(key);
}

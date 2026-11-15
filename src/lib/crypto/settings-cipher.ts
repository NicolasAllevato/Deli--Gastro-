/**
 * Cifrado de la configuración sensible guardada en D1 (`integration_settings`).
 *
 * AES-256-GCM con WebCrypto (anda igual en Workers, en la app OpenNext y en Node 24). La clave sale del
 * Worker secret `SETTINGS_ENC_KEY` (32 bytes en base64). IV aleatorio de 12 bytes por valor.
 * Formato versionado: `v1:<iv base64>:<cifrado+tag base64>`. Sin dependencias: lo importa también el
 * Worker whatsapp-bot por ruta relativa. Nunca loguear ni devolver el texto plano ni la clave.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SettingsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsKeyError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Importa la clave (cacheada por valor). Lanza `SettingsKeyError` si falta o no mide 32 bytes. */
export function importSettingsKey(keyB64: string | null | undefined): Promise<CryptoKey> {
  const raw = keyB64?.trim();
  if (!raw) return Promise.reject(new SettingsKeyError("Falta SETTINGS_ENC_KEY."));
  const cached = keyCache.get(raw);
  if (cached) return cached;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(raw);
  } catch {
    return Promise.reject(new SettingsKeyError("SETTINGS_ENC_KEY no es base64 válido."));
  }
  if (bytes.length !== KEY_BYTES) return Promise.reject(new SettingsKeyError("SETTINGS_ENC_KEY tiene que medir 32 bytes."));
  const key = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  keyCache.set(raw, key);
  return key;
}

export async function encryptSetting(plain: string, keyB64: string | null | undefined): Promise<string> {
  const key = await importSettingsKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/** Descifra; lanza si el formato es desconocido, la clave es otra o el valor fue alterado. */
export async function decryptSetting(stored: string, keyB64: string | null | undefined): Promise<string> {
  const [version, ivB64, ctB64, ...rest] = stored.split(":");
  if (version !== VERSION || !ivB64 || !ctB64 || rest.length > 0) throw new Error("Formato de valor cifrado desconocido.");
  const key = await importSettingsKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivB64) }, key, fromBase64(ctB64));
  return new TextDecoder().decode(plain);
}

import { cleanEnv } from "@/lib/clean-env";

/**
 * Copia cifrada y reversible del PIN de cada repartidor (migración 030), para que el admin pueda
 * volver a verla. AES-256-GCM con WebCrypto (anda igual en Node y en Workers). La clave vive en
 * el secreto de servidor COURIER_PIN_KEY (32 bytes en base64) y nunca llega al navegador.
 * El ingreso del repartidor sigue validando contra pin_hash: esto es solo para mostrarlo.
 */

const VERSION = "v1";
const IV_BYTES = 12;
/** Clave fija del modo demo (sin secretos reales). */
const DEMO_KEY_B64 = Buffer.from("demo-courier-pin-key-32-bytes!!!").toString("base64");

const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const fromB64 = (text: string): Uint8Array<ArrayBuffer> => {
  const buf = Buffer.from(text, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
};

/** Clave en base64, o null si no está configurada (entonces no se guarda copia cifrada). */
export function pinKeyB64(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = cleanEnv(env.COURIER_PIN_KEY);
  if (key) return key;
  return env.NEXT_PUBLIC_DEMO_MODE === "true" ? DEMO_KEY_B64 : null;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("COURIER_PIN_KEY tiene que ser de 32 bytes en base64.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Cifra el PIN atado al repartidor (AAD = user_id): una copia no sirve en otra fila. */
export async function encryptPin(pin: string, userId: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(pin);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) },
    key,
    data,
  );
  return `${VERSION}.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

/** Descifra; null si el formato, la clave o el repartidor no coinciden. */
export async function decryptPin(blob: string, userId: string, keyB64: string): Promise<string | null> {
  const [version, ivB64, ctB64] = blob.split(".");
  if (version !== VERSION || !ivB64 || !ctB64) return null;
  try {
    const key = await importKey(keyB64);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64), additionalData: new TextEncoder().encode(userId) },
      key,
      fromB64(ctB64),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

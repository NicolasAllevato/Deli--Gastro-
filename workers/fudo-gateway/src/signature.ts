/** HMAC-SHA256 en hex con Web Crypto. Lo usan Fudo (`fudo-signature`) y la app (`x-gateway-signature`). */

const encoder = new TextEncoder();

async function key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function hmacHex(body: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `crypto.subtle.verify` compara en tiempo constante. */
export async function verifyHmacHex(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
  const bytes = new Uint8Array(signature.trim().match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await key(secret, "verify"), bytes, encoder.encode(body));
}

/**
 * Privacidad del bot: suma `inspectPrivacy` a la inspección de salida y redacta los logs del Worker.
 * La lógica vive en src/lib/whatsapp/privacy.ts (compartida con la app).
 */
import { inspectPrivacy, mergeInspections, redactingLog } from "../../../src/lib/whatsapp/privacy.ts";

export { maskPhone, redactPii, safeError } from "../../../src/lib/whatsapp/privacy.ts";

/** Inspección de salida existente + privacidad (emails, tarjetas, CBU, DNI, ids internos, SQL, trazas). */
export function withPrivacy<R extends string>(text: string, base: { verdict: string; reasons: R[] }) {
  return mergeInspections(base, inspectPrivacy(text));
}

/** Logger del Worker: todo lo que se imprime pasa por la redacción. */
export const workerLog = redactingLog((message, detail) =>
  detail === undefined ? console.error(message) : console.error(message, detail),
);

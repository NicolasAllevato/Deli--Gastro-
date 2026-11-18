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
export const workerLog = redactingLog((message, detail) => {
  // Errores como error; lo informativo (p. ej. una llamada a la app que salió bien) como log, para no confundir.
  const hasCode = typeof detail === "object" && detail !== null && "code" in detail;
  const write = hasCode || /error|fall|agotad|bloquead|sin |no se pudo/i.test(message) ? console.error : console.log;
  if (detail === undefined) write(message);
  else write(message, detail);
});

// U+FEFF armado con su código: un carácter invisible pegado en el fuente se pierde con los editores.
const BOM = String.fromCharCode(0xfeff);

/**
 * Quita el BOM (U+FEFF) que agrega PowerShell al pegar valores en Vercel, y los espacios
 * de los bordes. Sin esto, una clave con BOM rompe los headers ("Cannot convert argument
 * to a ByteString") o cambia el hash de los PIN.
 * Recibe el valor (no el nombre) para que Next pueda incrustar las NEXT_PUBLIC_ en el cliente.
 */
export function cleanEnv(value: string | undefined): string {
  const raw = value ?? "";
  return (raw.startsWith(BOM) ? raw.slice(1) : raw).trim();
}

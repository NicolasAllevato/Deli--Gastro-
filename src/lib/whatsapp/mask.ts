const VISIBLE = 4;

/** "EAAGm0PX4ZCpsBA" → "••••CpsBA"-style hint: nunca devuelve el secreto completo. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  // Un secreto corto no puede mostrar sus últimos caracteres sin exponerse.
  if (value.length <= VISIBLE * 2) return "••••";
  return `••••${value.slice(-VISIBLE)}`;
}

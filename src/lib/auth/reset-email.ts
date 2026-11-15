/**
 * Email de "olvidé mi contraseña". El link de Better Auth ya viene codificado
 * (callbackURL=%2Frestablecer): NO se vuelve a codificar (encodeURI lo dejaba en %252F y
 * Better Auth respondía "Invalid callbackURL"). En el HTML solo se escapa para el atributo.
 */
export interface ResetEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildResetEmail(url: string): ResetEmail {
  const href = escapeHtml(url);
  return {
    subject: "Restablecer tu contraseña de Opsyn Dely",
    text: `Para elegir una contraseña nueva entrá a este link (vence en 15 minutos y sirve una sola vez):\n${url}\n\nSi no lo pediste, ignorá este correo.`,
    html: `<p>Para elegir una contraseña nueva entrá a este link (vence en 15 minutos y sirve una sola vez):</p><p><a href="${href}">Restablecer contraseña</a></p><p>Si no lo pediste, ignorá este correo.</p>`,
  };
}

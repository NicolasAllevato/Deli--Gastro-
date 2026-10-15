export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "app-theme";
export const DEFAULT_THEME: AppTheme = "dark";

/**
 * Script inline para `<head>`: aplica el tema guardado antes del primer paint (sin parpadeo).
 * Texto fijo, sin datos del usuario: es seguro inyectarlo con dangerouslySetInnerHTML.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:"${DEFAULT_THEME}";}catch(e){document.documentElement.dataset.theme="${DEFAULT_THEME}";}})();`;

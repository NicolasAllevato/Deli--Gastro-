import type { CapacitorConfig } from "@capacitor/cli";

// La app no empaqueta la web: abre el portal del repartidor en producción, así cada deploy de
// Vercel llega a los teléfonos sin publicar otra APK. `www/` es solo el respaldo sin conexión.
const config: CapacitorConfig = {
  appId: "app.opsyn.dely.repartidor",
  appName: "Dely Repartidor",
  webDir: "www",
  server: {
    url: "https://dely.opsyn.app/repartidor",
    // El login vuelve a /login y a /aceptar-terminos del mismo dominio.
    allowNavigation: ["dely.opsyn.app"],
    androidScheme: "https",
  },
  android: {
    // Nunca contenido http dentro de la app.
    allowMixedContent: false,
  },
};

export default config;

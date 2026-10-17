import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { ConsentManager } from "@/components/site/ConsentManager";
import { BRAND } from "@/lib/brand";
import { CONSENT_COOKIE } from "@/lib/consent/consentCore";

export const metadata: Metadata = { title: `Política de cookies | ${BRAND.appName}` };

const ITEMS = [
  { name: "Sesión (sb-*)", kind: "Esencial · cookie", use: "Mantiene tu sesión iniciada de forma segura.", life: "Hasta cerrar sesión" },
  { name: CONSENT_COOKIE, kind: "Esencial · cookie", use: "Guarda tu elección sobre cookies para no volver a preguntarte.", life: "180 días" },
  { name: "Carrito", kind: "Esencial · sesión del navegador", use: "Guarda los productos que agregaste antes de confirmar.", life: "Hasta cerrar la pestaña" },
  { name: "app-theme", kind: "Preferencias · almacenamiento local", use: "Recuerda si elegiste tema claro u oscuro. Solo con tu permiso.", life: "Hasta que lo borres o retires el permiso" },
] as const;

export default function CookiesPage() {
  return (
    <LegalPage
      title="Política de cookies"
      intro={
        <p>
          {BRAND.appName} usa cookies esenciales para funcionar y, solo si lo aceptás, cookies de preferencias.
          No usamos cookies de publicidad ni de seguimiento de terceros. Podés cambiar tu elección cuando
          quieras desde este panel.
        </p>
      }
      sections={[
        { title: "Tus preferencias", body: <ConsentManager /> },
        {
          title: "Qué guardamos",
          body: (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider">
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Para qué</th>
                    <th className="py-2">Duración</th>
                  </tr>
                </thead>
                <tbody>
                  {ITEMS.map((it) => (
                    <tr key={it.name} className="border-t border-gray-200/60 align-top">
                      <td className="py-2 pr-3 font-bold text-gray-800">{it.name}</td>
                      <td className="py-2 pr-3">{it.kind}</td>
                      <td className="py-2 pr-3">{it.use}</td>
                      <td className="py-2">{it.life}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          title: "Cómo controlarlas",
          body: (
            <p>
              Además de este panel, podés borrar las cookies y el almacenamiento desde la configuración de tu
              navegador. Si bloqueás las esenciales no vas a poder iniciar sesión ni hacer pedidos.
            </p>
          ),
        },
        {
          title: "Cambios",
          body: (
            <p>
              Si sumamos una categoría nueva o una herramienta de analítica, te vamos a volver a preguntar antes
              de activarla y actualizaremos esta política.
            </p>
          ),
        },
      ]}
    />
  );
}

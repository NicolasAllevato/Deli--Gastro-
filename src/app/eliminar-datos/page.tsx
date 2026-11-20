import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Eliminación de datos | ${BRAND.appName}` };

/**
 * URL de instrucciones de eliminación de datos que exige Meta para la revisión de la app (la ruta está registrada en Meta: no cambiarla).
 * Clientes: piden la baja por email. Personal del local: elimina su usuario desde "Mi cuenta" (docs/eliminacion-datos.md).
 * Editar esta página NO cambia LEGAL_BUNDLE_VERSION (solo las versiones de LEGAL_DOCUMENTS obligan a volver a aceptar).
 */
export default function EliminarDatosPage() {
  const mail = (
    <a className="font-bold underline" href={`mailto:${BRAND.contactEmail}?subject=Eliminar%20mis%20datos`}>
      {BRAND.contactEmail}
    </a>
  );

  return (
    <LegalPage
      title="Cómo eliminar tus datos"
      intro={
        <p>
          Podés pedir en cualquier momento que borremos los datos personales que {BRAND.appName} guarda sobre vos,
          incluidos los que se obtuvieron al iniciar sesión con Facebook o al escribir por WhatsApp.
        </p>
      }
      sections={[
        {
          title: "Si sos cliente o escribiste por WhatsApp",
          body: (
            <p>
              Mandá un email a {mail} con el asunto «Eliminar mis datos», desde el correo de tu cuenta o indicando el teléfono con el
              que escribiste al comercio. Te respondemos por el mismo medio.
            </p>
          ),
        },
        {
          title: "Si conectaste Facebook",
          body: (
            <p>
              Si conectaste tu cuenta de WhatsApp Business con Facebook, podés quitar el acceso desde Facebook en Configuración →
              Seguridad e inicio de sesión → Apps y sitios web → {BRAND.appName} → Eliminar. También podés pedirlo por email a {mail}.
            </p>
          ),
        },
        {
          title: "Si sos personal del local",
          body: (
            <p>
              Ingresá al panel y andá a <strong>Mi cuenta → Eliminar cuenta</strong> (el ícono de la persona, arriba a la derecha). Te pedimos tu
              contraseña actual y que escribas ELIMINAR. Se elimina en el momento tu usuario, tus sesiones y tu contraseña, y te mandamos un
              email para avisarte. Lo que se hizo en el local (pedidos, clientes y el resto del historial) queda como estaba.
            </p>
          ),
        },
        {
          title: "Qué borramos y en cuánto tiempo",
          body: (
            <p>
              Respondemos los pedidos por email dentro de los 30 días de recibidos. Se eliminan tu cuenta de acceso, tus sesiones y tu
              contraseña. El historial de pedidos ya realizados y las constancias de aceptación de los términos se conservan, porque
              hacen falta para fines contables, fiscales y legales.
            </p>
          ),
        },
      ]}
    />
  );
}

import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Eliminación de datos | ${BRAND.appName}` };

/** URL de instrucciones de eliminación de datos que exige Meta para la revisión de la app. */
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
          title: "Si escribiste por WhatsApp",
          body: (
            <p>
              Mandá un email a {mail} con el asunto «Eliminar mis datos» indicando el teléfono con el que escribiste
              al comercio.
            </p>
          ),
        },
        {
          title: "Si tenés una cuenta o conectaste Facebook",
          body: (
            <>
              <p>
                Mandá un email a {mail} con el asunto «Eliminar mis datos» desde el correo de tu cuenta. Si conectaste
                tu cuenta de WhatsApp Business con Facebook, también podés quitar el acceso desde Facebook en
                Configuración → Seguridad e inicio de sesión → Apps y sitios web → {BRAND.appName} → Eliminar.
              </p>
            </>
          ),
        },
        {
          title: "Qué borramos y en cuánto tiempo",
          body: (
            <p>
              Borramos tu cuenta, teléfono, direcciones, conversaciones, audios transcriptos y tokens de acceso
              dentro de los 30 días de recibido el pedido, y te confirmamos por el mismo medio. Solo conservamos lo
              que la ley exige guardar para fines contables o fiscales de los pedidos ya realizados.
            </p>
          ),
        },
      ]}
    />
  );
}

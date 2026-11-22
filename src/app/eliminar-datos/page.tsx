import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Eliminación de datos | ${BRAND.appName}` };

/**
 * URL de instrucciones de eliminación de datos que exige Meta para la revisión de la app (la ruta está registrada en Meta: no cambiarla).
 * Clientes: dan de baja su cuenta desde su panel (Mi perfil). Personal del local: desde "Mi cuenta" (docs/eliminacion-datos.md).
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
        <>
          <p>
            Podés dar de baja tu cuenta de {BRAND.appName} en cualquier momento desde tu panel. Al hacerlo no vas a poder volver a ingresar con esa
            cuenta y dejás de recibir los emails promocionales y las promociones por WhatsApp asociadas a ella. Conservamos el historial de tus
            pedidos por motivos contables y legales.
          </p>
          <p className="mt-2">
            Abajo te explicamos el paso a paso, cómo frenar los mensajes promocionales en tu número de WhatsApp y qué hacer si conectaste Facebook.
          </p>
        </>
      }
      sections={[
        {
          title: "Si sos cliente: dá de baja tu cuenta desde tu panel",
          body: (
            <>
              <p>
                Ingresá a tu cuenta y andá a <strong>Mi perfil → Configuración de la cuenta → Dar de baja la cuenta</strong>. Te pedimos tu
                contraseña actual (o el email de tu cuenta, si no tenés contraseña) y que escribas ELIMINAR. La baja es inmediata y no se hace
                por WhatsApp.
              </p>
              <p>Antes de confirmar tenés que tildar que entendés lo que implica:</p>
              <ul className="list-disc pl-5 flex flex-col gap-1">
                <li>No vas a poder volver a ingresar con esa cuenta.</li>
                <li>Vas a dejar de recibir emails promocionales.</li>
                <li>
                  Vas a dejar de recibir las promociones por WhatsApp asociadas a tu cuenta. Para frenar cualquier mensaje promocional en tu
                  número, respondé <strong>BAJA</strong> por WhatsApp.
                </li>
                <li>Conservamos el historial de tus pedidos por motivos contables y legales.</li>
              </ul>
              <p>Si tenés un pedido en curso, vas a poder dar de baja la cuenta cuando se entregue o se cancele.</p>
              <p>Si no podés ingresar a tu cuenta, escribinos a {mail} y te ayudamos.</p>
            </>
          ),
        },
        {
          title: "Si conectaste Facebook",
          body: (
            <p>
              Si conectaste tu cuenta de WhatsApp Business con Facebook, podés quitar el acceso desde Facebook en Configuración →
              Seguridad e inicio de sesión → Apps y sitios web → {BRAND.appName} → Eliminar. Quitar el acceso desde Facebook no borra
              lo que ya guardamos (el nombre y el email de la cuenta de Facebook que hizo la conexión, el usuario del panel y la fecha, y el
              token de WhatsApp del comercio): para que lo eliminemos, pedilo por email a {mail} y lo borramos dentro de los 30 días.
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
              La baja desde el panel es inmediata: se eliminan tu cuenta de acceso, tus sesiones y tu contraseña, y tu ficha de cliente queda
              dada de baja de las promociones y de las encuestas. Para frenar cualquier mensaje promocional en tu número, respondé BAJA por
              WhatsApp. El historial de pedidos ya realizados y las constancias de aceptación de los términos se
              conservan, porque hacen falta para fines contables, fiscales y legales. Si pedís ayuda por email, te respondemos dentro de los
              30 días.
            </p>
          ),
        },
      ]}
    />
  );
}

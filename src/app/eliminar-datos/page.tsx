import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Eliminación de datos | ${BRAND.appName}` };

/**
 * URL de instrucciones de eliminación de datos que exige Meta para la revisión de la app (la ruta está registrada en Meta: no cambiarla).
 * La lista de datos sale de docs/eliminacion-datos.md. Editar esta página NO cambia LEGAL_BUNDLE_VERSION (solo las versiones de
 * LEGAL_DOCUMENTS obligan a volver a aceptar), así que no fuerza ninguna re-aceptación.
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
          title: "Desde tu cuenta (la forma más rápida)",
          body: (
            <>
              <p>
                Ingresá con tu usuario y andá a <strong>Configuración de la cuenta → Eliminar cuenta</strong>. En el portal de clientes
                está en <em>Mi perfil</em>; el personal del local lo encuentra en <em>Mi cuenta</em> (el ícono de la persona, arriba a la
                derecha).
              </p>
              <p>
                Te pedimos tu contraseña actual y que escribas ELIMINAR. Se borra en el momento y se cierra tu sesión. Si no tenés
                cuenta, si sos repartidor o si tenés un pedido en curso, pedilo por email como se explica abajo.
              </p>
            </>
          ),
        },
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
          title: "Qué datos borramos",
          body: (
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>Tu cuenta: nombre, email, teléfono, foto y contraseña, y las sesiones abiertas.</li>
              <li>Tus direcciones de entrega, la ubicación y las notas de tus pedidos.</li>
              <li>Tus conversaciones de WhatsApp: mensajes, audios transcriptos y ubicaciones.</li>
              <li>Tus puntos, canjes y reseñas.</li>
              <li>Los pagos iniciados que la aplicación tenía registrados.</li>
              <li>Tus reclamos: el texto, las notas del local y las fotos que enviaste.</li>
              <li>Si sos repartidor: tu ficha, tu ubicación y tus habilitaciones.</li>
              <li>La IP y el dispositivo con los que aceptaste los Términos y la Política de privacidad.</li>
              <li>Tus tokens de acceso y de recuperación de contraseña.</li>
            </ul>
          ),
        },
        {
          title: "Qué conservamos",
          body: (
            <>
              <p>Solo lo que la ley exige guardar para fines contables o fiscales de los pedidos ya realizados, sin tus datos personales:</p>
              <ul className="list-disc pl-5 flex flex-col gap-1">
                <li>De cada pedido: número, fecha, productos, importes, medio de pago y estado.</li>
                <li>De cada reclamo: número, categoría, estado y compensación otorgada.</li>
                <li>Una constancia anónima de que se aceptó cada versión de los Términos y de la Política (documento, versión y fecha).</li>
                <li>Un registro del pedido de eliminación (fecha, canal y cuántos registros se tocaron), sin tu teléfono ni tu email.</li>
              </ul>
              <p>
                Los datos que hayan llegado a servicios de terceros (por ejemplo Meta/WhatsApp, Mercado Pago o el sistema de gestión del
                local) se rigen por las políticas de cada uno; si necesitás ayuda para pedirles la baja, escribinos.
              </p>
            </>
          ),
        },
        {
          title: "En cuánto tiempo",
          body: (
            <p>
              Si lo hacés desde tu cuenta, se borra en el momento. Si lo pedís por email, borramos tus datos dentro de los 30 días de
              recibido el pedido y te confirmamos por el mismo medio.
            </p>
          ),
        },
      ]}
    />
  );
}

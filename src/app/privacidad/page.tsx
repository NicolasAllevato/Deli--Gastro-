import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Política de privacidad | ${BRAND.appName}` };

export default function PrivacidadPage() {
  return (
    <LegalPage
      title="Política de privacidad"
      intro={
        <p>
          En {BRAND.company} cuidamos los datos personales conforme a la Ley 25.326 de Protección de los Datos
          Personales. El comercio donde hacés tu pedido es responsable de tus datos; {BRAND.company} los trata
          por cuenta de ese comercio para prestar el servicio de {BRAND.appName}.
        </p>
      }
      sections={[
        {
          title: "Quién trata tus datos",
          body: (
            <p>
              {BRAND.company}, nombre comercial de {BRAND.legal.holder} (empresa unipersonal), CUIT{" "}
              {BRAND.legal.cuit}, con domicilio en {BRAND.legal.address}.
            </p>
          ),
        },
        {
          title: "Qué datos recopilamos",
          body: (
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>Datos de cuenta: nombre, email, teléfono y contraseña (guardada con hash).</li>
              <li>Datos de entrega: direcciones y ubicación aproximada para calcular el envío.</li>
              <li>Pedidos: productos, importes, forma de pago, estados y reseñas.</li>
              <li>WhatsApp: los mensajes y audios que envíes al número del comercio (los audios se transcriben).</li>
              <li>Puntos y canjes del programa de fidelización.</li>
            </ul>
          ),
        },
        {
          title: "Para qué los usamos",
          body: (
            <p>
              Para tomar y entregar tus pedidos, avisarte su estado, gestionar tus puntos, enviarte una encuesta
              de satisfacción y, solo si lo pediste escribiendo ALTA por WhatsApp, enviarte promociones. Podés
              dejar de recibirlas escribiendo BAJA.
            </p>
          ),
        },
        {
          title: "Con quién los compartimos",
          body: (
            <p>
              Solo con proveedores necesarios para prestar el servicio: alojamiento y base de datos, Meta
              (WhatsApp Business), el proveedor de inteligencia artificial que procesa los mensajes del asistente
              y servicios de mapas para ubicar direcciones. No vendemos datos personales.
            </p>
          ),
        },
        {
          title: "Cuánto tiempo los guardamos",
          body: (
            <p>
              Mientras tengas una cuenta activa y luego el tiempo que exijan las obligaciones legales y
              contables del comercio. Podés pedir antes la eliminación de tu cuenta.
            </p>
          ),
        },
        {
          title: "Seguridad",
          body: (
            <p>
              Usamos conexiones cifradas, contraseñas con hash y control de acceso por rol. Ningún sistema es
              infalible: si detectamos un incidente que te afecte, te lo informaremos.
            </p>
          ),
        },
        {
          title: "Tus derechos",
          body: (
            <>
              <p>
                Podés acceder, rectificar, actualizar o suprimir tus datos escribiendo a{" "}
                <a className="font-bold underline" href={`mailto:${BRAND.contactEmail}`}>
                  {BRAND.contactEmail}
                </a>
                . El acceso es gratuito en intervalos no menores a seis meses (art. 14, Ley 25.326).
              </p>
              <p>
                La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende las
                denuncias por incumplimiento de las normas de protección de datos personales.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

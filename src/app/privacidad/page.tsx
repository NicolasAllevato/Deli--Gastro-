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
              <li>
                Conexión de WhatsApp: cuando el comercio conecta su número con Facebook, guardamos el nombre y el email de
                la cuenta de Facebook que hizo la conexión (si Meta los informa), el usuario del panel que la cerró y la fecha.
              </li>
              <li>
                Token de acceso de WhatsApp: guardamos cifrado el token que Meta entrega al comercio al conectar su número,
                solo para enviar y recibir los mensajes de ese comercio.
              </li>
              <li>Puntos y canjes del programa de fidelización.</li>
              <li>
                Datos técnicos que se recogen automáticamente al usar la plataforma: dirección IP, tipo de navegador o
                dispositivo, registros de acceso y errores del servidor, y las cookies descriptas en nuestra política de cookies.
              </li>
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
            <>
              <p>
                Solo con proveedores necesarios para prestar el servicio. No vendemos datos personales ni los usamos
                para publicidad de terceros.
              </p>
              <ul className="list-disc pl-5 flex flex-col gap-1">
                <li>Cloudflare: alojamiento de la aplicación, base de datos, almacenamiento de archivos y modelos de inteligencia artificial.</li>
                <li>Supabase: copia de respaldo de la base de datos.</li>
                <li>OpenAI: procesa el texto de los mensajes del asistente de WhatsApp para generar las respuestas.</li>
                <li>Meta (WhatsApp Business): envío y recepción de mensajes.</li>
                <li>Fudo: sistema de gestión del comercio, al que se informan los pedidos.</li>
                <li>
                  Cuando se activen: Mercado Pago (cobro de pedidos) y servicios de mapas (ubicar direcciones y calcular
                  envíos).
                </li>
              </ul>
            </>
          ),
        },
        {
          title: "Dónde se procesan los datos",
          body: (
            <p>
              Nuestros proveedores procesan los datos fuera de Argentina, principalmente en Estados Unidos (base de datos
              y respaldo) y en la red global de Cloudflare. Al usar el servicio aceptás esa transferencia internacional;
              exigimos a los proveedores medidas de seguridad adecuadas.
            </p>
          ),
        },
        {
          title: "Cuánto tiempo los guardamos",
          body: (
            <p>
              Mientras tengas una cuenta activa y luego el tiempo que exijan las obligaciones legales y
              contables del comercio. Podés pedir antes la eliminación de tu cuenta o de tus datos.
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
                <strong>Cómo pedir la eliminación de tus datos:</strong> desde tu panel (Mi perfil → Configuración de la
                cuenta → Dar de baja la cuenta), o por email a {BRAND.contactEmail}. Los pasos completos, incluido qué hacer
                si conectaste Facebook, están en{" "}
                <a className="font-bold underline" href="/eliminar-datos">
                  Cómo eliminar tus datos
                </a>
                . Respondemos dentro de los 30 días y, si no podemos borrar algo (por ejemplo, por obligaciones contables o
                fiscales), te explicamos el motivo.
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

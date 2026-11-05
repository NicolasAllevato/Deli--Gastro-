import type { Metadata } from "next";
import { LegalPage } from "@/components/site/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Términos y condiciones | ${BRAND.appName}` };

export default function TerminosPage() {
  return (
    <LegalPage
      title="Términos y condiciones"
      intro={
        <p>
          Estos términos regulan el uso de {BRAND.appName}, la plataforma de gestión de pedidos y delivery
          desarrollada por {BRAND.company}. Al usar la plataforma aceptás estas condiciones.
        </p>
      }
      sections={[
        {
          title: "Titular del servicio",
          body: (
            <p>
              {BRAND.company} es el nombre comercial de {BRAND.legal.holder} (empresa unipersonal), CUIT{" "}
              {BRAND.legal.cuit}, con domicilio en {BRAND.legal.address}. Contacto:{" "}
              <a className="font-bold underline" href={`mailto:${BRAND.contactEmail}`}>
                {BRAND.contactEmail}
              </a>
              .
            </p>
          ),
        },
        {
          title: "El servicio",
          body: (
            <p>
              {BRAND.appName} permite a comercios gastronómicos recibir y gestionar pedidos (web y WhatsApp),
              coordinar repartidores, administrar un programa de puntos y ver informes. Cada comercio es quien
              vende sus productos y responde por precios, stock, entregas y facturación.
            </p>
          ),
        },
        {
          title: "Cuentas y acceso",
          body: (
            <p>
              Cada usuario es responsable de mantener la confidencialidad de su contraseña y de la actividad de
              su cuenta. Los accesos de administrador y repartidor los otorga el comercio. Podemos suspender
              cuentas usadas para fraude, abuso o en violación de estos términos.
            </p>
          ),
        },
        {
          title: "Pedidos, precios y pagos",
          body: (
            <p>
              Los precios, costos de envío y tiempos estimados los define el comercio y se calculan en el
              servidor al confirmar el pedido. Un pedido puede cancelarse dentro de la ventana que fije el
              comercio. Los medios de pago y reembolsos son responsabilidad del comercio.
            </p>
          ),
        },
        {
          title: "Asistente por WhatsApp e inteligencia artificial",
          body: (
            <p>
              El asistente automatizado puede responder consultas y armar pedidos, pero el pedido solo se crea
              cuando lo confirmás de forma expresa. Sus respuestas pueden contener errores: ante cualquier duda
              prevalece la información del comercio. Podés pedir atención de una persona en cualquier momento.
            </p>
          ),
        },
        {
          title: "Puntos y recompensas",
          body: (
            <p>
              Los puntos no tienen valor monetario, no son transferibles y se rigen por las reglas que publique
              cada comercio, que puede modificarlas o dar de baja el programa avisando con anticipación.
            </p>
          ),
        },
        {
          title: "Uso aceptable",
          body: (
            <p>
              No está permitido usar la plataforma para actividades ilícitas, intentar acceder a datos de otros
              usuarios, interferir con su funcionamiento ni generar pedidos falsos.
            </p>
          ),
        },
        {
          title: "Propiedad intelectual",
          body: (
            <p>
              El software, la marca {BRAND.appName} y sus diseños pertenecen a {BRAND.company}. El contenido que
              carga cada comercio (menú, imágenes, textos) sigue siendo de ese comercio.
            </p>
          ),
        },
        {
          title: "Responsabilidad",
          body: (
            <p>
              Trabajamos para que la plataforma esté disponible y segura, pero puede haber interrupciones por
              mantenimiento o por servicios de terceros (WhatsApp, proveedores de nube). En la medida en que lo
              permita la ley, {BRAND.company} no responde por daños indirectos derivados de esas interrupciones.
            </p>
          ),
        },
        {
          title: "Cambios y ley aplicable",
          body: (
            <p>
              Podemos actualizar estos términos; los cambios relevantes se informarán en la plataforma. Se
              aplican las leyes de la República Argentina, incluida la Ley 24.240 de Defensa del Consumidor.
            </p>
          ),
        },
      ]}
    />
  );
}

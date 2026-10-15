import type { Metadata } from "next";
import { ErrorScreen } from "@/components/site/ErrorScreen";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Página no encontrada | ${BRAND.appName}` };

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="No encontramos esta página"
      message="Puede que el enlace esté mal escrito o que la página ya no exista. Volvé al inicio para elegir tu portal."
    />
  );
}

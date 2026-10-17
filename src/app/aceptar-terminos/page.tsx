import type { Metadata } from "next";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { AcceptTermsClient } from "./AcceptTermsClient";

export const metadata: Metadata = { title: `Aceptar términos | ${BRAND.appName}` };

export default function AceptarTerminosPage() {
  return (
    <Suspense>
      <AcceptTermsClient />
    </Suspense>
  );
}

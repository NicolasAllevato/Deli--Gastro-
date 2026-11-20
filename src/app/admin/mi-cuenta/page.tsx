import type { Metadata } from "next";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";

export const metadata: Metadata = { title: "Mi cuenta | Opsyn Dely" };

/**
 * Cuenta propia del personal del local (dueño, gerente, cajero). La puede abrir todo el personal: no depende de ninguna sección
 * (ver SELF_SERVICE_PAGES en src/lib/auth/permissions.ts).
 */
export default function MiCuentaPage() {
  return (
    <div className="page-fade flex flex-col gap-4 p-2 max-w-3xl">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Mi cuenta</h1>
        <p className="text-sm text-gray-500 mt-1">Ajustes de tu usuario del panel.</p>
      </header>
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Configuración de la cuenta</h2>
      <DeleteAccountCard />
    </div>
  );
}

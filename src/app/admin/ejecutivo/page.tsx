import type { Metadata } from "next";
import EjecutivoClient from "./EjecutivoClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tablero ejecutivo | Deli-Gastro" };

export default function EjecutivoPage() {
  return <EjecutivoClient />;
}

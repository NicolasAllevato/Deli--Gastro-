import { redirect } from "next/navigation";

// El inicio del panel es el tablero ejecutivo. La autenticación la resuelve
// src/proxy.ts (matcher /admin/:path*) antes de llegar acá.
export default function AdminIndexPage(): never {
  redirect("/admin/ejecutivo");
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Search } from "lucide-react";
import type { LegalUserRow } from "@/app/api/admin/legal/route";
import { formatDateTimeAR } from "@/lib/time-ar";

interface Doc { id: "terminos" | "privacidad"; title: string; version: string; href: string }
interface Payload { documents: Doc[]; users: LegalUserRow[]; truncated: boolean }

const ROLE_LABEL: Record<string, string> = { admin: "Admin", cliente: "Cliente", repartidor: "Repartidor" };
const fmt = (iso?: string) => (iso ? formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" }) : null);

export default function LegalAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/admin/legal", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Error al cargar.");
        setData((await r.json()) as Payload);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error al cargar."));
  }, []);

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !q || (u.email ?? "").toLowerCase().includes(q));
  }, [data, query]);

  const confirmed = (data?.users ?? []).filter((u) => u.complete).length;

  return (
    <div className="page-fade flex flex-col gap-4 p-2">
      <header>
        <h1 className="font-headline text-2xl font-black text-gray-800">Documentos legales</h1>
        <p className="text-sm text-gray-500 mt-1">
          Quién aceptó los Términos y la Política de privacidad, y cuándo. Cada documento se acepta por separado
          al primer ingreso; si cambia la versión, se vuelve a pedir.
        </p>
      </header>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {!data && !error && <div className="h-40 rounded-2xl shimmer" aria-hidden />}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="neumorphic rounded-2xl p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Confirmados</p>
              <p className="text-2xl font-black text-gray-800 mt-1">{confirmed}</p>
            </div>
            {data.documents.map((d) => (
              <div key={d.id} className="neumorphic rounded-2xl p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{d.title}</p>
                <p className="text-sm font-bold text-gray-800 mt-1">Versión vigente: {d.version}</p>
              </div>
            ))}
          </div>

          <label className="neumorphic-inset rounded-full flex items-center gap-2 px-4 py-2.5 max-w-sm">
            <Search size={16} className="text-gray-500" aria-hidden />
            <span className="sr-only">Buscar por email</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por email"
              className="bg-transparent outline-none text-sm text-gray-800 placeholder-gray-500 flex-1"
            />
          </label>

          <div className="neumorphic rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Rol</th>
                  {data.documents.map((d) => <th key={d.id} className="px-4 py-3">{d.title}</th>)}
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={3 + data.documents.length} className="px-4 py-6 text-center text-gray-500">Todavía no hay aceptaciones registradas.</td></tr>
                )}
                {users.map((u) => (
                  <tr key={u.userId} className="border-t border-gray-200/60">
                    <td className="px-4 py-3 font-bold text-gray-800">{u.email ?? u.userId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[u.role ?? ""] ?? u.role ?? "—"}</td>
                    {data.documents.map((d) => (
                      <td key={d.id} className="px-4 py-3 text-gray-600">
                        {fmt(u.accepted[d.id]) ?? <span className="text-gray-400">Pendiente</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      {u.complete ? (
                        <span className="badge-green inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
                          <CheckCircle2 size={13} aria-hidden /> Confirmado
                        </span>
                      ) : (
                        <span className="badge-yellow inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
                          <Clock size={13} aria-hidden /> Incompleto
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.truncated && <p className="text-xs text-gray-500">Se muestran las aceptaciones más recientes.</p>}
        </>
      )}
    </div>
  );
}

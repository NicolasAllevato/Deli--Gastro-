"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface TemplateItem {
  name: string;
  label: string;
  category: "UTILITY" | "MARKETING";
  purpose: string;
  footer: string | null;
  preview: string;
  status: string;
}

interface Payload {
  connected: boolean;
  metaError: string | null;
  templates: TemplateItem[];
}

const STATUS: Record<string, { label: string; tone: "green" | "yellow" | "red" | "blue" }> = {
  APPROVED: { label: "Aprobada", tone: "green" },
  PENDING: { label: "En revisión", tone: "yellow" },
  IN_APPEAL: { label: "En apelación", tone: "yellow" },
  REJECTED: { label: "Rechazada", tone: "red" },
  PAUSED: { label: "Pausada", tone: "red" },
  DISABLED: { label: "Deshabilitada", tone: "red" },
  NOT_CREATED: { label: "Sin crear", tone: "blue" },
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

export default function PlantillasPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await request<Payload>("/api/whatsapp/templates"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las plantillas.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async (name: string) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await request("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNotice("Plantilla enviada a Meta. Queda en revisión hasta que la aprueben (suele tardar minutos u horas).");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo crear la plantilla.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <FileText size={20} aria-hidden />
        </div>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Plantillas de WhatsApp</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">
            Mensajes aprobados por Meta que se envían solos: confirmación, seguimiento, encuesta y promociones.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}
      {data && !data.connected && (
        <p role="status" className="text-xs font-bold text-yellow-800 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200">
          Conectá WhatsApp (con el WABA ID) para poder crear las plantillas.
        </p>
      )}
      {data?.metaError && <p role="alert" className="text-xs font-bold text-red-600">Meta respondió: {data.metaError}</p>}

      <p className="text-xs text-gray-500">
        Solo se avisa por WhatsApp a quienes ya le escribieron al local. Las promociones, únicamente a quienes aceptaron recibirlas.
      </p>

      <ul className="space-y-3">
        {data?.templates.map((t) => {
          const status = STATUS[t.status] ?? { label: t.status, tone: "blue" as const };
          return (
            <li key={t.name} className="neumorphic rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-headline font-bold text-sm text-gray-800">{t.label}</h2>
                <Badge tone={t.category === "MARKETING" ? "orange" : "blue"}>
                  {t.category === "MARKETING" ? "Marketing" : "Utilidad"}
                </Badge>
                <span className="ml-auto"><Badge tone={status.tone}>{status.label}</Badge></span>
              </div>
              <p className="text-xs text-gray-500">{t.purpose}</p>
              <p className="text-sm text-gray-700 neumorphic-inset rounded-xl p-3 whitespace-pre-wrap">
                {t.preview}
                {t.footer && <span className="block text-[11px] text-gray-500 mt-1">{t.footer}</span>}
              </p>
              {t.status === "NOT_CREATED" && (
                <Button size="sm" variant="secondary" onClick={() => create(t.name)} loading={busy === t.name} disabled={!data.connected}>
                  Crear en Meta
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

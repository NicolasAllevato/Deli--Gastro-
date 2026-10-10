"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound, MessageCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

interface State {
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
  accessTokenHint: string;
  appSecretHint: string;
  canSend: boolean;
  canReceive: boolean;
}

interface TestResult {
  displayPhoneNumber: string;
  verifiedName: string;
  quality: string | null;
}

const STEPS = [
  "Creá una app en Meta for Developers con el producto WhatsApp y asociala a tu cuenta de Meta Business.",
  "En WhatsApp Manager agregá tu método de pago (tarjeta). Los mensajes los cobra Meta a tu cuenta.",
  "Aceptá los Términos de la WhatsApp Business Cloud API y registrá el número que va a atender los pedidos.",
  "En Configuración del negocio creá un usuario del sistema y generá un token permanente con los permisos whatsapp_business_messaging y whatsapp_business_management.",
  "Pegá acá el Phone Number ID, el WABA ID, el token y el App Secret (Configuración de la app → Básica).",
  "En Meta, en WhatsApp → Configuración, cargá la URL del webhook y el token de verificación de abajo, y suscribite al campo messages.",
] as const;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-bold ${ok ? "text-green-700" : "text-gray-500"}`}>
      <Icon size={14} aria-hidden /> {label}
    </span>
  );
}

export default function WhatsAppPage() {
  const [state, setState] = useState<State | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("/api/whatsapp/webhook");

  const apply = useCallback((next: State) => {
    setState(next);
    setPhoneNumberId(next.phoneNumberId);
    setWabaId(next.wabaId);
    setVerifyToken(next.verifyToken);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebhookUrl(`${window.location.origin}/api/whatsapp/webhook`);
    request<State>("/api/whatsapp/config").then(apply).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración."),
    );
  }, [apply]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await request<State>("/api/whatsapp/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId, wabaId, accessToken, appSecret, verifyToken }),
      });
      apply(next);
      setAccessToken("");
      setAppSecret("");
      setNotice("Configuración guardada.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setTest(null);
    try {
      setTest(await request<TestResult>("/api/whatsapp/test", { method: "POST" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo probar la conexión.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text).then(
      () => setNotice(`${what} copiado.`),
      () => setError("No se pudo copiar. Seleccionalo y copialo a mano."),
    );
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full neumorphic flex items-center justify-center text-brand-orange">
          <MessageCircle size={20} aria-hidden />
        </div>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">WhatsApp</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">Conectá el número que va a recibir y tomar los pedidos.</p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">{notice}</p>}

      <section className="neumorphic rounded-2xl p-5 flex flex-wrap gap-x-8 gap-y-2" aria-label="Estado de la conexión">
        <StatusBadge ok={state?.canSend ?? false} label="Envío de mensajes" />
        <StatusBadge ok={state?.canReceive ?? false} label="Recepción de mensajes (webhook)" />
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Cómo conectarlo</h2>
        <ol className="list-decimal pl-5 space-y-1.5 text-xs text-gray-600">
          {STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Credenciales">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Credenciales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone Number ID" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} inputMode="numeric" />
          <Field label="WABA ID" value={wabaId} onChange={(e) => setWabaId(e.target.value)} inputMode="numeric" />
          <Field
            label="Token de acceso"
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={state?.accessTokenHint || "Pegá el token"}
            hint={state?.accessTokenHint ? "Guardado. Dejalo vacío para conservarlo." : undefined}
          />
          <Field
            label="App Secret"
            type="password"
            autoComplete="off"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={state?.appSecretHint || "Pegá el App Secret"}
            hint={state?.appSecretHint ? "Guardado. Dejalo vacío para conservarlo." : undefined}
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="Token de verificación" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
          </div>
          <Button size="sm" variant="secondary" leftIcon={<KeyRound size={14} aria-hidden />} onClick={() => setVerifyToken(randomToken())}>
            Generar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} loading={busy}>Guardar</Button>
          <Button size="sm" variant="secondary" onClick={testConnection} disabled={busy || !state?.canSend}>Probar conexión</Button>
        </div>

        {test && (
          <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">
            Conectado: {test.verifiedName} · {test.displayPhoneNumber}
            {test.quality ? ` · calidad ${test.quality}` : ""}
          </p>
        )}
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-3" aria-label="Datos para Meta">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Datos para cargar en Meta</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl neumorphic-inset text-xs text-gray-700">{webhookUrl}</code>
          <Button variant="icon" size="sm" aria-label="Copiar URL del webhook" onClick={() => copy(webhookUrl, "URL")}>
            <Copy size={14} aria-hidden />
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Meta solo acepta URLs públicas con HTTPS: en tu computadora usá un túnel (por ejemplo cloudflared) o probalo ya desplegado.
        </p>
      </section>
    </div>
  );
}

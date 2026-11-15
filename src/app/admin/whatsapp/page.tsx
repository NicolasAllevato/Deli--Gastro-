"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, KeyRound, MessageCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import type { ConnectedBySummary } from "@/lib/whatsapp/connected-by";
import { EmbeddedSignup } from "./EmbeddedSignup";
import { formatDateAR } from "@/lib/time-ar";

interface State {
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
  appId: string;
  configId: string;
  coexistence: boolean;
  coexistenceLocked: boolean;
  accessTokenHint: string;
  appSecretHint: string;
  canSend: boolean;
  canReceive: boolean;
  connectedBy: ConnectedBySummary | null;
}

interface Check {
  status: "ok" | "error" | "pending";
  detail: string;
}

interface Diagnosis {
  phone: Check;
  waba: Check;
  subscription: Check;
  ready: boolean;
}

const STEPS = [
  "Creá una app en Meta for Developers con el producto WhatsApp y asociala a tu cuenta de Meta Business.",
  "En WhatsApp Manager agregá tu método de pago (tarjeta). Los mensajes los cobra Meta a tu cuenta.",
  "Agregá el número que va a atender los pedidos y verificalo por SMS o llamada. Activá la verificación en dos pasos y anotá el PIN de 6 dígitos.",
  "En Configuración del negocio creá un usuario del sistema, asignale la app y la cuenta de WhatsApp, y generá un token permanente con los permisos whatsapp_business_messaging y whatsapp_business_management.",
  "Pegá acá el Phone Number ID, el WABA ID, el token y el App Secret (Configuración de la app → Básica) y guardá.",
  "En Meta, en WhatsApp → Configuración, cargá la URL del webhook y el token de verificación de abajo, y suscribite al campo messages.",
  "Acá abajo: «Registrar número» con el PIN (solo la primera vez) y «Suscribir app». Terminá con «Revisar vinculación»: los tres puntos tienen que quedar en verde.",
] as const;

const CHECK_LABELS: ReadonlyArray<[keyof Omit<Diagnosis, "ready">, string]> = [
  ["phone", "Número"],
  ["waba", "Cuenta de WhatsApp Business"],
  ["subscription", "App suscrita a la cuenta"],
];

const CHECK_TONE: Record<Check["status"], string> = {
  ok: "text-green-700",
  error: "text-red-600",
  pending: "text-yellow-700",
};

/**
 * «usuario del panel dueno@… · Facebook (informado por el navegador): Ana Pérez (ana@…) · 8/11/2026».
 * El usuario del panel sale de la sesión del servidor (verificado); el de Facebook lo declara el navegador,
 * por eso va rotulado. Cada dato aparece solo si existe.
 */
function describeConnectedBy(by: ConnectedBySummary): string {
  const facebook = [by.facebookName, by.facebookEmail && `(${by.facebookEmail})`].filter(Boolean).join(" ");
  const parts = [
    by.adminEmail && `usuario del panel ${by.adminEmail}`,
    facebook && `Facebook (informado por el navegador): ${facebook}`,
    by.connectedAt && formatDateAR(by.connectedAt),
  ].filter(Boolean);
  return parts.join(" · ");
}

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
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [coexistence, setCoexistence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<Diagnosis | null>(null);
  const [pin, setPin] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("/api/whatsapp/webhook");

  const apply = useCallback((next: State) => {
    setState(next);
    setPhoneNumberId(next.phoneNumberId);
    setWabaId(next.wabaId);
    setVerifyToken(next.verifyToken);
    setAppId(next.appId);
    setConfigId(next.configId);
    setCoexistence(next.coexistence);
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
        // Sin token de verificación se genera uno: es un dato que nadie tiene que inventar.
        body: JSON.stringify({
          phoneNumberId, wabaId, accessToken, appSecret, appId, configId,
          verifyToken: verifyToken.trim() || randomToken(),
          coexistence: coexistence ? "1" : "0",
        }),
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

  const testConnection = useCallback(async () => {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      setTest(await request<Diagnosis>("/api/whatsapp/test", { method: "POST" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo revisar la conexión.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Verificación automática: con un número conectado se revisa sola una vez al cargar.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!state?.canSend || autoChecked.current) return;
    autoChecked.current = true;
    void testConnection();
  }, [state?.canSend, testConnection]);

  const progress: ReadonlyArray<[string, boolean]> = [
    ["Credenciales de la app", Boolean(state?.appId && state?.configId && state?.appSecretHint)],
    ["Número conectado", Boolean(state?.canSend && state?.wabaId)],
    ["Verificado", Boolean(test?.ready)],
  ];

  const link = async (body: { action: "subscribe" } | { action: "register"; pin: string }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await request<{ message: string }>("/api/whatsapp/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNotice(res.message);
      if (body.action === "register") setPin("");
      setTest(await request<Diagnosis>("/api/whatsapp/test", { method: "POST" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar el paso.");
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

      <section className="neumorphic rounded-2xl p-5 space-y-3" aria-label="Estado de la conexión">
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2" aria-label="Pasos del alta">
          {progress.map(([label, done], i) => (
            <li key={label} className="flex items-center gap-2 text-xs">
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center font-black ${done ? "bg-green-50 text-green-700" : "neumorphic-inset text-gray-500"}`}
                aria-hidden
              >
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              <span className={done ? "font-bold text-gray-700" : "text-gray-600"}>
                {label}
                <span className="sr-only">{done ? " (listo)" : " (pendiente)"}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <StatusBadge ok={state?.canSend ?? false} label="Envío de mensajes" />
          <StatusBadge ok={state?.canReceive ?? false} label="Recepción de mensajes (webhook)" />
        </div>
        {state?.connectedBy && (
          <p className="text-xs text-gray-600" data-testid="connected-by">
            Conectado por {describeConnectedBy(state.connectedBy)}
          </p>
        )}
      </section>

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Credenciales de la app">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">1. Credenciales de la app de Meta</h2>
        <p className="text-xs text-gray-500">
          Se cargan una sola vez. Están en Meta for Developers: App ID y App Secret en «Configuración de la app → Básica»;
          el Config ID en «WhatsApp → Embedded Signup». Se guardan cifrados.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" />
          <Field label="Config ID" value={configId} onChange={(e) => setConfigId(e.target.value)} inputMode="numeric" />
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
        <Switch
          checked={coexistence}
          onChange={setCoexistence}
          label="Coexistencia con la app WhatsApp Business"
          disabled={!state || state.coexistenceLocked}
          hint={
            state?.coexistenceLocked
              ? "Definido por la variable de entorno WHATSAPP_COEXISTENCE: no se puede cambiar desde acá."
              : "Prendelo si el local sigue usando el número en el celular (sin PIN). Apagalo para un número nuevo solo para el bot."
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} loading={busy}>Guardar</Button>
        </div>
      </section>

      <EmbeddedSignup
        appId={state?.appId ?? ""}
        configId={state?.configId ?? ""}
        coexistence={state ? state.coexistence : null}
        dirty={
          state !== null &&
          (coexistence !== state.coexistence || appId !== state.appId || configId !== state.configId || appSecret !== "")
        }
        canConnect={Boolean(state?.appSecretHint)}
        onConnected={(message) => {
          setError(null);
          setNotice(message);
          request<State>("/api/whatsapp/config").then(apply).catch(() => undefined);
          void testConnection();
        }}
        onError={(message) => {
          setNotice(null);
          setError(message);
        }}
      />

      <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Verificación">
        <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">3. Verificación</h2>
        <p className="text-xs text-gray-500">
          Se revisa sola al abrir esta página y después de conectar: número, cuenta y suscripción del webhook.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<RefreshCw size={14} aria-hidden />} onClick={testConnection} loading={busy} disabled={!state?.canSend}>
            Volver a revisar
          </Button>
          {test && test.subscription.status !== "ok" && (
            <Button size="sm" variant="secondary" onClick={() => link({ action: "subscribe" })} disabled={busy || !state?.wabaId}>
              Suscribir ahora
            </Button>
          )}
        </div>
        {!state?.canSend && <p className="text-xs text-gray-500">Todavía no hay un número conectado: completá el paso 2.</p>}

        {test && (
          <ul role="status" className="space-y-2" aria-label="Resultado de la revisión">
            {CHECK_LABELS.map(([key, label]) => {
              const check = test[key];
              const Icon = check.status === "ok" ? CheckCircle2 : XCircle;
              return (
                <li key={key} className="flex items-start gap-2 text-xs">
                  <Icon size={14} className={`shrink-0 mt-0.5 ${CHECK_TONE[check.status]}`} aria-hidden />
                  <span>
                    <span className="font-bold text-gray-700">{label}:</span>{" "}
                    <span className={CHECK_TONE[check.status]}>{check.detail}</span>
                  </span>
                </li>
              );
            })}
            {test.ready && (
              <li className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">
                Listo: el número envía y recibe mensajes, y el bot ya usa estas credenciales (puede tardar hasta un minuto).
              </li>
            )}
          </ul>
        )}
      </section>

      <details className="neumorphic rounded-2xl p-5 group">
        <summary className="cursor-pointer font-headline font-bold text-sm uppercase tracking-widest text-gray-700">
          Avanzado: carga manual y datos del webhook
        </summary>
        <div className="space-y-5 mt-4">
          <p className="text-xs text-gray-500">
            Solo si no podés usar «Conectar con Facebook» o Meta no eligió el número solo.
          </p>
          <ol className="list-decimal pl-5 space-y-1.5 text-xs text-gray-600">
            {STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>

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
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field
                  label="Token de verificación"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  hint="Si queda vacío se genera solo al guardar."
                />
              </div>
              <Button size="sm" variant="secondary" leftIcon={<KeyRound size={14} aria-hidden />} onClick={() => setVerifyToken(randomToken())}>
                Generar
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} loading={busy}>Guardar</Button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field
                label="PIN de 6 dígitos"
                type="password"
                autoComplete="off"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => link({ action: "register", pin })}
              disabled={busy || !state?.canSend || pin.length !== 6}
            >
              Registrar número
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            El registro con PIN es solo para números nuevos cargados a mano (con coexistencia no hace falta). Si Meta dice que ya está registrado, seguí.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-700">URL del webhook para Meta</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl neumorphic-inset text-xs text-gray-700">{webhookUrl}</code>
              <Button variant="icon" size="sm" aria-label="Copiar URL del webhook" onClick={() => copy(webhookUrl, "URL")}>
                <Copy size={14} aria-hidden />
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Meta solo acepta URLs públicas con HTTPS: en tu computadora usá un túnel (por ejemplo cloudflared) o probalo ya desplegado.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

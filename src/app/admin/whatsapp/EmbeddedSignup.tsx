"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { buildSignupExtras, parseSignupMessage } from "@/lib/whatsapp/embedded-signup";

const GRAPH_VERSION = "v26.0";
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

interface FacebookSdk {
  init: (options: { appId: string; version: string; xfbml: boolean }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ) => void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

interface Props {
  appId: string;
  configId: string;
  /** Valor GUARDADO del interruptor de coexistencia; `null` mientras carga. */
  coexistence: boolean | null;
  /** Hay cambios sin guardar en las credenciales o el interruptor: se bloquea el botón. */
  dirty: boolean;
  canConnect: boolean;
  onConnected: (message: string) => void;
  onError: (message: string) => void;
}

/** Lo que informó Meta: el EVENTO decide el modo (coexistencia sin PIN, o número nuevo con PIN). */
type SignupIds = { kind: "standard"; phoneNumberId: string; wabaId: string } | { kind: "coexistence"; wabaId: string };

interface Pending {
  code: string;
  ids: SignupIds;
}

function loadSdk(appId: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      if (!window.FB) return reject(new Error("No se pudo cargar el SDK de Facebook."));
      window.FB.init({ appId, version: GRAPH_VERSION, xfbml: false });
      resolve(window.FB);
    };
    if (window.FB) return ready();
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("No se pudo cargar el SDK de Facebook. Revisá tu conexión o el bloqueador de anuncios."));
    document.head.appendChild(script);
  });
}

function buildBody(code: string, ids: SignupIds, pin: string): Record<string, string> {
  return ids.kind === "coexistence"
    ? { mode: "coexistence", code, wabaId: ids.wabaId }
    : { mode: "standard", code, phoneNumberId: ids.phoneNumberId, wabaId: ids.wabaId, pin };
}

/** Botón «Conectar con Facebook»: Embedded Signup de WhatsApp (el servidor guarda token e ids). */
export function EmbeddedSignup({ appId, configId, coexistence, dirty, canConnect, onConnected, onError }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const ids = useRef<SignupIds | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseSignupMessage(event);
      if (parsed?.kind === "finish") ids.current = { kind: "standard", phoneNumberId: parsed.phoneNumberId, wabaId: parsed.wabaId };
      // Coexistencia: Meta solo informa el waba_id; el servidor resuelve el número.
      if (parsed?.kind === "finish_coexistence") ids.current = { kind: "coexistence", wabaId: parsed.wabaId };
      if (parsed?.kind === "cancel") cancelled.current = true;
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const submit = async (code: string, signupIds: SignupIds, pinValue: string) => {
    if (signupIds.kind === "standard" && !/^\d{6}$/.test(pinValue)) {
      setPending({ code, ids: signupIds });
      onError("Meta terminó el alta como número nuevo: ingresá un PIN de 6 dígitos y tocá «Terminar conexión».");
      return;
    }
    const res = await fetch("/api/whatsapp/embedded-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(code, signupIds, pinValue)),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; ready?: boolean; warnings?: string[] };
    if (!res.ok) throw new Error(json.error ?? "No se pudo completar la conexión.");
    setPending(null);
    const base = json.ready ? "WhatsApp conectado: el número envía y recibe mensajes." : "Conectado, pero revisá la vinculación más abajo.";
    onConnected([base, ...(json.warnings ?? [])].join(" "));
  };

  const finish = async (code: string) => {
    // El mensaje con los ids puede llegar un instante después del callback de FB.login.
    for (let i = 0; i < 20 && !ids.current; i++) await new Promise((r) => setTimeout(r, 150));
    if (!ids.current) {
      throw new Error(
        "Meta cerró la ventana sin hacer el alta de WhatsApp (no pidió número ni QR). Suele pasar mientras la verificación del negocio está pendiente o si el número no cumple los requisitos de coexistencia. Reintentá cuando Meta apruebe la verificación.",
      );
    }
    await submit(code, ids.current, pin);
  };

  const connect = async () => {
    setBusy(true);
    setPending(null);
    ids.current = null;
    cancelled.current = false;
    try {
      const fb = await loadSdk(appId);
      fb.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            setBusy(false);
            if (!cancelled.current) onError("No se completó el inicio de sesión con Facebook.");
            return;
          }
          finish(code)
            .catch((e: unknown) => onError(e instanceof Error ? e.message : "No se pudo conectar."))
            .finally(() => setBusy(false));
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: buildSignupExtras(coexistence === true),
        },
      );
    } catch (e: unknown) {
      setBusy(false);
      onError(e instanceof Error ? e.message : "No se pudo iniciar el inicio de sesión.");
    }
  };

  const completePending = () => {
    if (!pending) return;
    setBusy(true);
    submit(pending.code, pending.ids, pin)
      .catch((e: unknown) => onError(e instanceof Error ? e.message : "No se pudo conectar."))
      .finally(() => setBusy(false));
  };

  const missing = !appId || !configId;
  const loading = coexistence === null;
  const showPin = pending !== null || coexistence === false;
  const pinOk = /^\d{6}$/.test(pin);

  return (
    <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Conectar con Facebook">
      <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Conectar con Facebook</h2>
      <p className="text-xs text-gray-500">
        Iniciá sesión con tu cuenta de Meta, elegí o creá el número y listo: el token, la cuenta y la suscripción se cargan solos.{" "}
        {coexistence
          ? "Modo coexistencia: el número sigue en la app WhatsApp Business del celular y vas a escanear un código con esa app, sin PIN. Si Meta termina el alta como número nuevo, te vamos a pedir el PIN."
          : "Elegí un PIN de 6 dígitos para el número (queda como verificación en dos pasos)."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {showPin && (
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
        )}
        {pending ? (
          <Button size="sm" leftIcon={<LogIn size={14} aria-hidden />} onClick={completePending} loading={busy} disabled={!pinOk}>
            Terminar conexión
          </Button>
        ) : (
          <Button
            size="sm"
            leftIcon={<LogIn size={14} aria-hidden />}
            onClick={connect}
            loading={busy}
            disabled={missing || !canConnect || loading || dirty || (coexistence === false && !pinOk)}
          >
            Conectar con Facebook
          </Button>
        )}
      </div>
      {missing && <p className="text-xs text-gray-500">Cargá el App ID y el Config ID de tu app de Meta (en «Credenciales») para habilitar el botón.</p>}
      {!missing && !canConnect && <p className="text-xs text-gray-500">Cargá y guardá el App Secret en «Credenciales» para habilitar el botón.</p>}
      {dirty && <p className="text-xs text-gray-500">Hay cambios sin guardar en «Credenciales»: guardalos para habilitar el botón (se usa el valor guardado).</p>}
    </section>
  );
}

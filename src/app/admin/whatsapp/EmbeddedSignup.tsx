"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { parseSignupMessage } from "@/lib/whatsapp/embedded-signup";

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
  canConnect: boolean;
  onConnected: (message: string) => void;
  onError: (message: string) => void;
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

/** Botón «Conectar con Facebook»: Embedded Signup de WhatsApp (el servidor guarda token e ids). */
export function EmbeddedSignup({ appId, configId, canConnect, onConnected, onError }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = useRef<{ phoneNumberId: string; wabaId: string } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseSignupMessage(event);
      if (parsed?.kind === "finish") ids.current = { phoneNumberId: parsed.phoneNumberId, wabaId: parsed.wabaId };
      if (parsed?.kind === "cancel") cancelled.current = true;
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const finish = async (code: string, pinValue: string) => {
    // El mensaje con los ids puede llegar un instante después del callback de FB.login.
    for (let i = 0; i < 20 && !ids.current; i++) await new Promise((r) => setTimeout(r, 150));
    if (!ids.current) throw new Error("Meta no informó el número elegido. Intentá de nuevo.");

    const res = await fetch("/api/whatsapp/embedded-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, ...ids.current, pin: pinValue }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; ready?: boolean };
    if (!res.ok) throw new Error(json.error ?? "No se pudo completar la conexión.");
    onConnected(json.ready ? "WhatsApp conectado: el número envía y recibe mensajes." : "Conectado, pero revisá la vinculación más abajo.");
  };

  const connect = async () => {
    setBusy(true);
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
          finish(code, pin)
            .catch((e: unknown) => onError(e instanceof Error ? e.message : "No se pudo conectar."))
            .finally(() => setBusy(false));
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: "3" },
        },
      );
    } catch (e: unknown) {
      setBusy(false);
      onError(e instanceof Error ? e.message : "No se pudo iniciar el inicio de sesión.");
    }
  };

  const missing = !appId || !configId;

  return (
    <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Conectar con Facebook">
      <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-gray-700">Conectar con Facebook</h2>
      <p className="text-xs text-gray-500">
        Iniciá sesión con tu cuenta de Meta, elegí o creá el número y listo: el token, la cuenta y la suscripción se cargan solos.
        Elegí un PIN de 6 dígitos para el número (queda como verificación en dos pasos).
      </p>
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
          leftIcon={<LogIn size={14} aria-hidden />}
          onClick={connect}
          loading={busy}
          disabled={missing || !canConnect || pin.length !== 6}
        >
          Conectar con Facebook
        </Button>
      </div>
      {missing && <p className="text-xs text-gray-500">Cargá el App ID y el Config ID de tu app de Meta (en «Credenciales») para habilitar el botón.</p>}
      {!missing && !canConnect && <p className="text-xs text-gray-500">Cargá y guardá el App Secret en «Credenciales» para habilitar el botón.</p>}
    </section>
  );
}

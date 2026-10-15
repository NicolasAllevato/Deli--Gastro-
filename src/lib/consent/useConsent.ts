"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme/themeConfig";
import { CONSENT_COOKIE, readConsentFromCookieHeader, serializeConsentCookie, type Consent } from "./consentCore";

const EVENT = "consent-change";

/** Consentimiento actual leído de la cookie (null = todavía no decidió). */
export function readConsent(): Consent | null {
  try {
    return readConsentFromCookieHeader(document.cookie);
  } catch {
    return null;
  }
}

/** Guarda la elección y aplica sus efectos: sin "preferencias" no queda nada guardado del tema. */
export function saveConsent(consent: Consent): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = serializeConsentCookie(consent) + secure;
  try {
    if (consent.preferences) {
      // Lo que ya eligió en esta pestaña pasa a recordarse.
      const current = document.documentElement.dataset.theme;
      if (current === "light" || current === "dark") window.localStorage.setItem(THEME_STORAGE_KEY, current);
    } else {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch {
    /* sin almacenamiento no hay nada que guardar ni borrar */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Borra la elección: el banner vuelve a aparecer. */
export function clearConsent(): void {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

// useSyncExternalStore exige una instantánea estable: se compara por el texto de la cookie.
let lastRaw: string | null = null;
let lastValue: Consent | null = null;
function snapshot(): Consent | null {
  const raw = typeof document === "undefined" ? "" : document.cookie;
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = readConsent();
  }
  return lastValue;
}

/**
 * `ready` es falso en el servidor y en el primer render: así el banner no parpadea
 * antes de saber si ya hubo una decisión.
 */
export function useConsent(): { consent: Consent | null; ready: boolean; save: (c: Consent) => void; clear: () => void } {
  const consent = useSyncExternalStore(subscribe, snapshot, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const save = useCallback((c: Consent) => saveConsent(c), []);
  const clear = useCallback(() => clearConsent(), []);
  return { consent, ready, save, clear };
}

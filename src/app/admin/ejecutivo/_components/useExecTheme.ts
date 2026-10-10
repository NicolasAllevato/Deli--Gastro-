"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ExecTheme = "light" | "dark";
const STORAGE_KEY = "exec-theme";
const EVENT = "exec-theme-change";

function read(): ExecTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Tema del tablero persistido en localStorage (tolera que no esté disponible). */
export function useExecTheme(): [ExecTheme, (next: ExecTheme) => void] {
  const theme = useSyncExternalStore(subscribe, read, (): ExecTheme => "light");
  const setTheme = useCallback((next: ExecTheme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* sin almacenamiento el cambio no se persiste */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [theme, setTheme];
}

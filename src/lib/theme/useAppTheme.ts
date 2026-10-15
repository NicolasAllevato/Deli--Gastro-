"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, type AppTheme } from "./themeConfig";

export type { AppTheme };

const EVENT = "app-theme-change";

/** Lee el tema guardado. Sin almacenamiento disponible (modo privado, bloqueado) usa el predeterminado. */
export function readTheme(): AppTheme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
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

/** Tema de toda la app: se refleja en `<html data-theme>` y se persiste en localStorage. */
export function useAppTheme(): [AppTheme, (next: AppTheme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, (): AppTheme => DEFAULT_THEME);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: AppTheme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* sin almacenamiento el cambio dura solo esta pestaña */
    }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [theme, setTheme];
}

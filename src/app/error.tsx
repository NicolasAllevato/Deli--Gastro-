"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/site/ErrorScreen";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error inesperado de una pantalla. El detalle va al log, no al usuario. */
export default function ErrorPage({ error, reset }: Props) {
  useEffect(() => {
    console.error("[app] error de pantalla", error.digest ?? "", error);
  }, [error]);

  return (
    <ErrorScreen
      code="Ups"
      title="Algo salió mal"
      message="Tuvimos un problema al mostrar esta pantalla. Probá de nuevo; si sigue pasando, avisanos."
      action={
        <button type="button" onClick={reset} className="neumorphic neumorphic-hover rounded-full px-6 py-3 text-sm font-bold text-gray-700">
          Reintentar
        </button>
      }
    />
  );
}

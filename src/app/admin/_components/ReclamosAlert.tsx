"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FALLBACK_POLL_MS } from "@/lib/live-refresh";
import { leerVistos, marcarVisto, reclamosPorAvisar, textoAviso, type ReclamoParaAviso } from "@/lib/reclamos/aviso-panel";

export interface ReclamosResumen {
  abiertos: number;
  enCurso: number;
  vencidos: number;
  recientes: ReclamoParaAviso[];
}

/** Mismo intervalo de respaldo que el resto del panel en vivo (los reclamos los escribe el Worker del bot). */
const POLL_MS = FALLBACK_POLL_MS;

/** Contadores de reclamos para el panel (badge del menú y aviso). Se refresca cada minuto. */
export function useReclamosResumen(): ReclamosResumen | null {
  const [data, setData] = useState<ReclamosResumen | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/reclamos/resumen", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<ReclamosResumen>) : null))
        .then((next) => {
          if (alive && next) setData(next);
        })
        .catch(() => {
          /* sin red: se reintenta en el próximo ciclo */
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return data;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Dos tonos cortos con WebAudio. false si el navegador lo bloquea (todavía no hubo interacción). */
async function sonar(ctxRef: { current: AudioContext | null }): Promise<boolean> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctxRef.current ??= new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (ctx.state !== "running") return false;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reclamo nuevo en cualquier pantalla del admin: suena y abre una ventana. Cada reclamo se avisa una sola vez
 * (vistos en localStorage). Si el navegador bloquea el sonido, la ventana sale igual con un aviso para activarlo.
 */
export function ReclamoNuevoModal({ resumen }: { resumen: ReclamosResumen | null }) {
  const router = useRouter();
  const [actual, setActual] = useState<ReclamoParaAviso | null>(null);
  const [sinSonido, setSinSonido] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const vistos = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!resumen || actual) return;
    vistos.current ??= leerVistos(storage());
    const [siguiente] = reclamosPorAvisar(resumen.recientes ?? [], vistos.current);
    if (!siguiente) return;
    vistos.current = marcarVisto(storage(), vistos.current, siguiente.id);
    void sonar(audio).then((ok) => {
      setSinSonido(!ok);
      setActual(siguiente);
    });
  }, [resumen, actual]);

  if (!actual) return null;
  const cerrar = () => setActual(null);
  return (
    <Modal
      open
      onClose={cerrar}
      title="Nuevo reclamo"
      description={textoAviso(actual)}
      size="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={cerrar}>Cerrar</Button>
          <Button
            onClick={() => {
              cerrar();
              router.push(`/admin/reclamos?id=${encodeURIComponent(actual.id)}`);
            }}
          >
            Ver reclamo
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-800">{textoAviso(actual)}</p>
      {sinSonido && (
        <div className="mt-3 text-xs text-gray-600 space-y-2">
          <p>El navegador bloqueó el sonido del aviso. Activalo para escuchar los próximos reclamos.</p>
          <Button size="sm" variant="secondary" onClick={() => void sonar(audio).then((ok) => setSinSonido(!ok))}>
            Activar sonido
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Aviso arriba del contenido: reclamos sin atender y los que pasaron 2 h con el local abierto. */
export function ReclamosAlert({ resumen }: { resumen: ReclamosResumen | null }) {
  if (!resumen || resumen.abiertos === 0) return null;
  const vencidos = resumen.vencidos > 0;
  return (
    <div
      role="status"
      className={`mx-3 mb-2 px-4 py-2.5 rounded-2xl neumorphic flex flex-wrap items-center gap-2 text-sm ${vencidos ? "text-red-600" : "text-gray-700"}`}
    >
      <AlertTriangle size={16} aria-hidden className={vencidos ? "text-red-600" : "text-brand-orange"} />
      <span className="font-bold">
        {resumen.abiertos === 1 ? "1 reclamo sin atender" : `${resumen.abiertos} reclamos sin atender`}
      </span>
      {vencidos && <span>· {resumen.vencidos} lleva{resumen.vencidos === 1 ? "" : "n"} más de 2 h abierto{resumen.vencidos === 1 ? "" : "s"}</span>}
      <Link href="/admin/reclamos?estado=abierto" className="ml-auto font-bold text-brand-orange hover:underline">
        Ver reclamos
      </Link>
    </div>
  );
}

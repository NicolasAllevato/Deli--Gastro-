"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TriangleAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DELETION_CONFIRM_WORD, type DeletionEligibilityView } from "@/lib/deletion/types";

const FORM_ID = "eliminar-cuenta-form";
const FAIL = "No se pudo eliminar la cuenta. Probá de nuevo.";

/** Lo que escribió el usuario, sin espacios ni minúsculas: "eliminar " también vale. */
const normalizeConfirm = (value: string) => value.trim().toUpperCase();

async function loadEligibility(): Promise<DeletionEligibilityView> {
  const res = await fetch("/api/account/delete", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as (DeletionEligibilityView & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "No se pudo verificar si podés eliminar tu cuenta.");
  return json;
}

async function requestDeletion(password: string): Promise<void> {
  const res = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, confirm: DELETION_CONFIRM_WORD }),
  });
  if (res.ok) return;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(json?.error ?? FAIL);
}

/**
 * "Eliminar cuenta" de la configuración personal (cliente y personal del local). Pide la contraseña actual y escribir ELIMINAR,
 * elimina de inmediato y manda a la página de confirmación. El servidor valida todo otra vez: acá solo se muestra u oculta la acción.
 * Repartidores, dueño principal y último dueño activo no pueden (el servidor dice por qué).
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const [eligibility, setEligibility] = useState<DeletionEligibilityView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carga inicial: el setState ocurre dentro de la promesa, no en el cuerpo del efecto.
  useEffect(() => {
    let alive = true;
    loadEligibility()
      .then((e) => alive && setEligibility(e))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : "No se pudo verificar."));
    return () => {
      alive = false;
    };
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setPassword("");
    setConfirm("");
    setError(null);
  }, [busy]);

  const ready = password.length > 0 && normalizeConfirm(confirm) === DELETION_CONFIRM_WORD;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestDeletion(password);
      // La sesión ya no existe: a la página pública de confirmación, y se refresca para soltar lo que el portal tenía cargado.
      router.replace("/cuenta-eliminada");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : FAIL);
      setBusy(false);
    }
  }

  const blocked = eligibility !== null && !eligibility.canDelete;

  return (
    <section aria-labelledby="eliminar-cuenta-titulo" className="neumorphic rounded-[2rem] p-5 flex flex-col gap-3">
      <h3 id="eliminar-cuenta-titulo" className="font-headline font-black text-base text-gray-800 flex items-center gap-2">
        <Trash2 size={16} className="text-red-600" aria-hidden /> Eliminar cuenta
      </h3>
      <p className="text-sm text-gray-600 leading-relaxed">
        Borramos tu cuenta, tus datos de contacto y de entrega, tu historial de WhatsApp, tus puntos y tus reseñas. Los pedidos que ya hiciste se
        conservan sin tus datos personales (solo fecha, importes y estado), porque la ley lo exige para fines contables. No se puede deshacer.
      </p>
      {blocked && (
        <p role="note" className="flex items-start gap-2 text-xs text-gray-600 rounded-xl neumorphic-inset px-4 py-2.5">
          <TriangleAlert size={15} className="shrink-0 mt-0.5 text-brand-orange" aria-hidden />
          {eligibility.reason}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-xs font-bold text-red-600">
          {loadError}
        </p>
      )}
      <div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          leftIcon={<Trash2 size={15} aria-hidden />}
          disabled={eligibility === null || blocked}
          onClick={() => setOpen(true)}
        >
          Eliminar mi cuenta
        </Button>
      </div>

      <Modal
        open={open}
        onClose={close}
        size="md"
        title="Eliminar mi cuenta"
        description="Esta acción es definitiva: no vas a poder recuperar tu cuenta ni tus datos."
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} variant="danger" loading={busy} disabled={!ready}>
              Eliminar definitivamente
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Contraseña actual"
            type="password"
            required
            value={password}
            maxLength={128}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            label={`Escribí ${DELETION_CONFIRM_WORD} para confirmar`}
            required
            value={confirm}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-xs font-bold text-red-600">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </section>
  );
}

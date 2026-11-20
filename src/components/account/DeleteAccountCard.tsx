"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { TriangleAlert, UserX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DELETION_CONFIRM_WORD, type DeletionEligibilityView } from "@/lib/deletion/types";

const FORM_ID = "baja-cuenta-form";
const FAIL = "No se pudo dar de baja la cuenta. Probá de nuevo.";

export type AccountRole = "cliente" | "admin";

/** Lo que se le aclara a quien da de baja su cuenta, antes de confirmar. Es lo mismo que explica /eliminar-datos. */
const CONSEQUENCES: Record<AccountRole, readonly string[]> = {
  cliente: [
    "No vas a poder volver a ingresar con esta cuenta.",
    "Vas a dejar de recibir emails promocionales.",
    "Vas a dejar de recibir mensajes de WhatsApp del local.",
    "Conservamos el historial de tus pedidos por motivos contables y legales.",
  ],
  admin: [
    "No vas a poder volver a ingresar con este usuario.",
    "Lo que se hizo en el local (pedidos, clientes y el resto del historial) queda como estaba.",
  ],
};

const SUMMARY: Record<AccountRole, string> = {
  cliente:
    "Si das de baja tu cuenta no vas a poder volver a ingresar con ella, vas a dejar de recibir emails promocionales y mensajes de WhatsApp del local. " +
    "Conservamos el historial de tus pedidos por motivos contables y legales. No se puede deshacer.",
  admin:
    "Eliminamos tu usuario del panel: tu cuenta, tus sesiones abiertas y tu contraseña. Lo que se hizo en el local (pedidos, clientes, WhatsApp y el " +
    "resto del historial) queda como está. Te mandamos un email para avisarte. No se puede deshacer.",
};

/** Lo que escribió la persona, sin espacios ni minúsculas: "eliminar " también vale. */
const normalizeConfirm = (value: string) => value.trim().toUpperCase();

async function loadEligibility(): Promise<DeletionEligibilityView> {
  const res = await fetch("/api/account/delete", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as (DeletionEligibilityView & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "No se pudo verificar si podés dar de baja tu cuenta.");
  return json;
}

async function requestDeletion(body: { password?: string; confirmEmail?: string }): Promise<void> {
  const res = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, confirm: DELETION_CONFIRM_WORD }),
  });
  if (res.ok) return;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(json?.error ?? FAIL);
}

/**
 * "Dar de baja la cuenta" de la configuración de la cuenta (cliente y personal del local). Antes de confirmar se aclara qué implica y hay que
 * tildar "Entiendo"; además pide la contraseña actual (o, si la cuenta no tiene, el email exacto de la cuenta) y escribir ELIMINAR. Baja de
 * inmediato y manda a la página de confirmación. El servidor valida todo otra vez: acá solo se muestra u oculta la acción. Repartidores, el
 * dueño principal, el último dueño activo y un cliente con un pedido en curso no pueden (el servidor dice por qué).
 */
export function DeleteAccountCard({ role = "admin" }: { role?: AccountRole }) {
  const router = useRouter();
  const understoodId = useId();
  const [eligibility, setEligibility] = useState<DeletionEligibilityView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [secret, setSecret] = useState("");
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
    setUnderstood(false);
    setSecret("");
    setConfirm("");
    setError(null);
  }, [busy]);

  const byEmail = eligibility?.method === "email";
  const ready = understood && secret.trim().length > 0 && normalizeConfirm(confirm) === DELETION_CONFIRM_WORD;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestDeletion(byEmail ? { confirmEmail: secret.trim() } : { password: secret });
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
    <section aria-labelledby="baja-cuenta-titulo" className="neumorphic rounded-[2rem] p-5 flex flex-col gap-3">
      <h3 id="baja-cuenta-titulo" className="font-headline font-black text-base text-gray-800 flex items-center gap-2">
        <UserX size={16} className="text-red-600" aria-hidden /> Dar de baja la cuenta
      </h3>
      <p className="text-sm text-gray-600 leading-relaxed">{SUMMARY[role]}</p>
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
        <Button type="button" variant="danger" size="sm" leftIcon={<UserX size={15} aria-hidden />} disabled={eligibility === null || blocked} onClick={() => setOpen(true)}>
          Dar de baja mi cuenta
        </Button>
      </div>

      <Modal
        open={open}
        onClose={close}
        size="md"
        title="Dar de baja mi cuenta"
        description="Esta acción es definitiva."
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} variant="danger" loading={busy} disabled={!ready}>
              Dar de baja definitivamente
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
          <div role="note" className="rounded-2xl border-2 border-red-500/60 bg-red-500/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-black text-red-600">
              <TriangleAlert size={17} className="shrink-0" aria-hidden /> Antes de confirmar, tené en cuenta
            </p>
            <ul className="mt-2 list-disc pl-5 flex flex-col gap-1 text-sm font-bold text-gray-800">
              {CONSEQUENCES[role].map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <label htmlFor={understoodId} className="flex items-start gap-3 text-sm font-bold text-gray-800 cursor-pointer">
            <input
              id={understoodId}
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-orange)]"
            />
            Entiendo lo que implica y quiero dar de baja mi cuenta.
          </label>
          <Field
            label={byEmail ? "Email de tu cuenta" : "Contraseña actual"}
            type={byEmail ? "email" : "password"}
            required
            value={secret}
            maxLength={byEmail ? 254 : 128}
            autoComplete={byEmail ? "off" : "current-password"}
            spellCheck={false}
            onChange={(e) => setSecret(e.target.value)}
            hint={byEmail ? "Tu cuenta no tiene contraseña: confirmá escribiendo el email exacto de la cuenta." : undefined}
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

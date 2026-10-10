"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { ZoneRow } from "@/lib/reports/executive";
import { DEFAULTS, parseSettings, type ExecutiveSettings, type ExecutiveSettingsPatch } from "@/lib/reports/executiveSettings";
import { SettingsCopilotSection } from "./SettingsCopilotSection";
import { SettingsKpiSection } from "./SettingsKpiSection";
import { SettingsZonesSection } from "./SettingsZonesSection";
import { knownZones } from "./settingsDraft";
import type { ExecTheme } from "./useExecTheme";

interface Props {
  open: boolean;
  theme: ExecTheme;
  onClose: () => void;
  settings: ExecutiveSettings | null;
  zoneOptions: Array<{ id: string; label: string }>;
  zoneRows: ZoneRow[];
  saveSettings: (patch: ExecutiveSettingsPatch) => Promise<string | null>;
}

type FormProps = Omit<Props, "open" | "theme">;

function SettingsForm({ onClose, settings, zoneOptions, zoneRows, saveSettings }: FormProps) {
  const [draft, setDraft] = useState<ExecutiveSettings>(settings ?? DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = knownZones(draft, zoneOptions, zoneRows);

  async function handleSave() {
    const parsed = parseSettings(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await saveSettings(parsed.settings);
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="max-h-[60dvh] overflow-y-auto pr-1 flex flex-col gap-6 custom-scrollbar">
        <SettingsKpiSection draft={draft} onChange={setDraft} />
        <SettingsZonesSection draft={draft} zones={zones} onChange={setDraft} />
        <SettingsCopilotSection draft={draft} onChange={setDraft} />
      </div>
      {error && (
        <p role="alert" className="text-sm font-bold text-red-700 break-words">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3 border-t border-gray-300 pt-4">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleSave} loading={saving}>
          Guardar ajustes
        </Button>
      </div>
    </div>
  );
}

export function SettingsDrawer({ open, theme, ...rest }: Props) {
  return (
    <Modal open={open} onClose={rest.onClose} title="Ajustes del tablero" description="Metas, tiempos, zonas y reglas del copiloto." size="lg">
      <div className="exec-theme exec-modal" data-theme={theme}>
        <SettingsForm {...rest} />
      </div>
    </Modal>
  );
}

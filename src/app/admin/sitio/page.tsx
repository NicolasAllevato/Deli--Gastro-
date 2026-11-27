"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, ImageDown, Loader2, PlusCircle, Save, Send, Sparkles, WifiOff, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/orders";
import { formatDateTimeAR } from "@/lib/time-ar";
import { EditableArea } from "../_components/AdminAccess";

type Confidence = "alta" | "media" | "baja";

interface AppProduct { id: string; name: string; categoryName: string | null; price: number; hasPhoto: boolean }
interface SavedLink {
  appProductId: string; kind: "product" | "promotion"; siteId: string; siteVariantId: string | null; lastPushError?: string | null;
}
interface RunSummary { ops?: number; ok?: number; errors?: number; pending?: number; failure?: string; errorList?: Array<{ name: string; message: string }> }
interface LastRun { trigger: string; startedAt: string; finishedAt: string | null; ok: boolean | null; summary: RunSummary | null }
interface PublishPreview { hasKey: boolean; error?: string; lines: string[]; warnings: string[]; opCount: number; lastRun: LastRun | null }
interface Suggestion extends SavedLink { siteLabel: string; confidence: Confidence }
interface SiteProduct { id: string; name: string; hasPhoto: boolean; variants: Array<{ id: string; label: string }> }
interface SiteSummary {
  categories: Array<{ id: string; name: string; channel: string; products: SiteProduct[] }>;
  promotions: Array<{ id: string; name: string; hasPhoto: boolean }>;
}
interface SitioState {
  connection: { hasKey: boolean; ok: boolean; error?: string };
  products: AppProduct[];
  links: SavedLink[];
  suggestions: Suggestion[];
  site: SiteSummary | null;
}
interface PhotoOutcome { productId: string; name: string; reason?: string }
interface PhotoResult { copied: PhotoOutcome[]; skipped: PhotoOutcome[]; failed: PhotoOutcome[] }

const TRIGGER_LABEL: Record<string, string> = { manual: "a mano", cron: "automática", cambio: "por un cambio en la app" };

function runText(run: LastRun | null): string {
  if (!run) return "Todavía no se publicó nada.";
  const when = formatDateTimeAR(run.startedAt, { dateStyle: "short", timeStyle: "short" });
  const sum = run.summary;
  const detail = run.finishedAt === null ? "en curso" : sum?.failure ? `falló: ${sum.failure}` : `${sum?.ok ?? 0} bien · ${sum?.errors ?? 0} con error`;
  return `Última publicación (${TRIGGER_LABEL[run.trigger] ?? run.trigger}) ${when}: ${detail}.`;
}

const CHANNEL_LABEL: Record<string, string> = { salon: "salón", delivery: "delivery", ambos: "salón y delivery" };
const CONFIDENCE_TONE: Record<Confidence, "green" | "yellow" | "orange"> = { alta: "green", media: "yellow", baja: "orange" };

const selectClass =
  "w-full min-w-56 px-3 py-2 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40";

/** Valor del selector: "" sin vincular · "p:<producto>:<variante>" · "m:<promoción>". */
const encode = (l: Pick<SavedLink, "kind" | "siteId" | "siteVariantId"> | undefined): string =>
  !l ? "" : l.kind === "promotion" ? `m:${l.siteId}` : `p:${l.siteId}:${l.siteVariantId ?? ""}`;

function decode(value: string): { kind: "product" | "promotion"; siteId: string; siteVariantId: string | null } | null {
  if (value.startsWith("m:")) return { kind: "promotion", siteId: value.slice(2), siteVariantId: null };
  if (value.startsWith("p:")) {
    const [, siteId, variantId] = value.split(":");
    return { kind: "product", siteId, siteVariantId: variantId || null };
  }
  return null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "No se pudo completar la operación.");
  return json;
}

function SiteOptions({ site }: { site: SiteSummary }) {
  return (
    <>
      <option value="">Sin vincular</option>
      {site.categories.map((c) => (
        <optgroup key={c.id} label={`${c.name} (${CHANNEL_LABEL[c.channel] ?? c.channel})`}>
          {c.products.flatMap((p) =>
            p.variants.length === 0
              ? [<option key={p.id} value={`p:${p.id}:`}>{p.name}</option>]
              : p.variants.map((v) => <option key={`${p.id}:${v.id}`} value={`p:${p.id}:${v.id}`}>{`${p.name} · ${v.label}`}</option>),
          )}
        </optgroup>
      ))}
      {site.promotions.length > 0 && (
        <optgroup label="Promociones">
          {site.promotions.map((p) => <option key={p.id} value={`m:${p.id}`}>{p.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

export default function SitioPage() {
  const [state, setState] = useState<SitioState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [busy, setBusy] = useState<"save" | "photos" | "publish" | "create" | null>(null);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [createCat, setCreateCat] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoResult | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<SitioState>("/api/admin/sitio");
      setState(next);
      setDrafts({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar.");
    }
  }, []);

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await api<PublishPreview>("/api/admin/sitio/publish"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular lo que falta publicar.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api<SitioState>("/api/admin/sitio")
      .then((next) => alive && (setState(next), setError(null)))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "No se pudo cargar."));
    api<PublishPreview>("/api/admin/sitio/publish")
      .then((p) => alive && setPreview(p))
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const linkByProduct = useMemo(() => new Map((state?.links ?? []).map((l) => [l.appProductId, l])), [state]);
  const suggestionByProduct = useMemo(() => new Map((state?.suggestions ?? []).map((s) => [s.appProductId, s])), [state]);
  const valueOf = (id: string): string => drafts[id] ?? encode(linkByProduct.get(id));
  const changes = (state?.products ?? []).filter((p) => p.id in drafts && drafts[p.id] !== encode(linkByProduct.get(p.id)));
  const goodSuggestions = (state?.suggestions ?? []).filter((s) => s.confidence === "alta" && !(s.appProductId in drafts));

  const rows = (state?.products ?? []).filter((p) => !onlyUnlinked || valueOf(p.id) === "");

  function acceptHigh() {
    setDrafts((d) => ({ ...d, ...Object.fromEntries(goodSuggestions.map((s) => [s.appProductId, encode(s)])) }));
  }

  async function save() {
    setBusy("save");
    setNotice(null);
    setError(null);
    try {
      const links = changes.map((p) => ({ appProductId: p.id, site: decode(drafts[p.id]) }));
      const r = await api<{ saved: number; removed: number }>("/api/admin/sitio/links", { method: "PUT", body: JSON.stringify({ links }) });
      await load();
      setNotice(`Listo: ${r.saved} vinculados y ${r.removed} sin vincular.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(null);
    }
  }

  async function publishNow() {
    setBusy("publish");
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ status: string; summary?: RunSummary }>("/api/admin/sitio/publish", { method: "POST", body: "{}" });
      setNotice(`Publicado: ${r.summary?.ok ?? 0} bien y ${r.summary?.errors ?? 0} con error.`);
      await Promise.all([load(), loadPreview()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo publicar.");
    } finally {
      setBusy(null);
    }
  }

  async function createOnSite(appProductId: string) {
    const siteCategoryId = createCat[appProductId];
    if (!siteCategoryId) return;
    setBusy("create");
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ photo: string; photoError?: string }>("/api/admin/sitio/create-product", {
        method: "POST", body: JSON.stringify({ appProductId, siteCategoryId }),
      });
      setNotice(r.photo === "fallo" ? `Creado en el sitio, pero la foto falló: ${r.photoError}` : "Creado en el sitio y vinculado.");
      await Promise.all([load(), loadPreview()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear en el sitio.");
    } finally {
      setBusy(null);
    }
  }

  async function importPhotos() {
    setBusy("photos");
    setNotice(null);
    setError(null);
    setPhotos(null);
    try {
      setPhotos(await api<PhotoResult & { success: true }>("/api/admin/sitio/import-photos", { method: "POST", body: "{}" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron traer las fotos.");
    } finally {
      setBusy(null);
    }
  }

  const connected = state?.connection.ok === true;
  const linkedCount = state?.links.length ?? 0;

  return (
    <EditableArea section="configuracion">
      <div className="page-fade flex flex-col gap-4 p-2">
        <header>
          <h1 className="font-headline text-2xl font-black text-gray-800">Sitio web</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vinculá cada producto de la app con su par en el sitio de la pizzería. Con el vínculo hecho, podés traer al sistema las fotos
            que ya están cargadas en el sitio. Los precios, estados y fotos se publican desde la sección de abajo.
          </p>
        </header>

        {error && <div role="alert" className="badge-red text-xs font-bold px-3 py-2 rounded-lg">{error}</div>}
        {notice && <div role="status" className="badge-green text-xs font-bold px-3 py-2 rounded-lg">{notice}</div>}

        {!state && !error && (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</p>
        )}

        {state && (
          <>
            <section className="neumorphic rounded-2xl p-4 flex flex-wrap items-center gap-3" aria-label="Estado de la conexión">
              {connected ? <Wifi size={18} aria-hidden className="text-gray-600" /> : <WifiOff size={18} aria-hidden className="text-gray-600" />}
              <div className="flex-1 min-w-48">
                <p className="font-bold text-gray-800 text-sm">{connected ? "Conectado con el sitio" : "Sin conexión con el sitio"}</p>
                <p className="text-xs text-gray-500">
                  {connected
                    ? `${state.site?.categories.reduce((n, c) => n + c.products.length, 0) ?? 0} productos y ${state.site?.promotions.length ?? 0} promociones en el sitio · ${linkedCount} de ${state.products.length} productos de la app vinculados`
                    : state.connection.error ?? "No se pudo leer el sitio."}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void load()}>Volver a leer</Button>
            </section>

            {connected && state.site && (
              <>
                <section className="neumorphic rounded-2xl p-4 flex flex-col gap-3" aria-label="Publicar en el sitio">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-48">
                      <p className="font-bold text-gray-800 text-sm">Publicar en el sitio</p>
                      <p className="text-xs text-gray-500">
                        La app manda: precios, productos ocultos y fotos de la app pasan al sitio. Se publica solo cada 15 minutos y cuando
                        guardás un cambio.
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void publishNow()} loading={busy === "publish"} disabled={busy !== null || (preview?.opCount ?? 0) === 0}
                      leftIcon={<Send size={14} aria-hidden />}>
                      Publicar ahora{preview && preview.opCount > 0 ? ` (${preview.opCount})` : ""}
                    </Button>
                  </div>
                  {preview?.warnings.map((w) => (
                    <p key={w} role="alert" className="badge-yellow text-xs font-bold px-3 py-2 rounded-lg flex items-start gap-2">
                      <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" /> {w}
                    </p>
                  ))}
                  {preview?.error && <p className="text-xs text-gray-600">No se pudo calcular los cambios: {preview.error}</p>}
                  {preview && !preview.error && (
                    preview.lines.length === 0 ? (
                      <p className="text-sm text-gray-600">El sitio está al día con la app.</p>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-gray-700">{preview.lines.length} cambios pendientes</p>
                        <ul className="mt-1 max-h-48 overflow-auto text-xs text-gray-600 list-disc pl-5" aria-label="Cambios pendientes">
                          {preview.lines.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
                        </ul>
                      </div>
                    )
                  )}
                  <p className="text-xs text-gray-500">{runText(preview?.lastRun ?? null)}</p>
                  {preview?.lastRun?.summary?.errorList?.map((e) => (
                    <p key={e.name} className="text-xs text-gray-600">{e.name}: {e.message}</p>
                  ))}
                </section>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
                    Solo los que faltan vincular
                  </label>
                  <span className="flex-1" />
                  <Button variant="secondary" size="sm" onClick={acceptHigh} disabled={goodSuggestions.length === 0 || busy !== null}
                    leftIcon={<Sparkles size={14} aria-hidden />}>
                    Aceptar sugerencias de confianza alta ({goodSuggestions.length})
                  </Button>
                  <Button size="sm" onClick={() => void save()} disabled={changes.length === 0} loading={busy === "save"}
                    leftIcon={<Save size={14} aria-hidden />}>
                    Guardar{changes.length > 0 ? ` (${changes.length})` : ""}
                  </Button>
                </div>

                <ul className="neumorphic rounded-2xl p-4 flex flex-col gap-3" aria-label="Productos de la app">
                  {rows.length === 0 && <li className="text-sm text-gray-500">No hay productos para mostrar.</li>}
                  {rows.map((p) => {
                    const suggestion = suggestionByProduct.get(p.id);
                    const value = valueOf(p.id);
                    const showSuggestion = suggestion && !linkByProduct.has(p.id) && value !== encode(suggestion);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-48">
                          <p className="font-bold text-gray-800 truncate">{p.name}</p>
                          <p className="text-xs text-gray-500">
                            {p.categoryName ?? "Sin categoría"} · {formatMoney(p.price)} · {p.hasPhoto ? "Con foto" : "Sin foto"}
                          </p>
                          {linkByProduct.get(p.id)?.lastPushError && (
                            <p className="mt-1 text-xs font-bold text-gray-700">Último error al publicar: {linkByProduct.get(p.id)?.lastPushError}</p>
                          )}
                          {showSuggestion && (
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              Sugerido: {suggestion.siteLabel}
                              <Badge tone={CONFIDENCE_TONE[suggestion.confidence]}>Confianza {suggestion.confidence}</Badge>
                              <button type="button" className="underline font-bold"
                                onClick={() => setDrafts((d) => ({ ...d, [p.id]: encode(suggestion) }))}>
                                Usar
                              </button>
                            </p>
                          )}
                        </div>
                        {!linkByProduct.has(p.id) && value === "" && (
                          <span className="flex items-center gap-2">
                            <select value={createCat[p.id] ?? ""} onChange={(e) => setCreateCat((c) => ({ ...c, [p.id]: e.target.value }))}
                              aria-label={`Categoría del sitio para crear ${p.name}`} className={selectClass}>
                              <option value="">Categoría para crear…</option>
                              {state.site!.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <Button variant="secondary" size="sm" onClick={() => void createOnSite(p.id)}
                              disabled={!createCat[p.id] || busy !== null || changes.length > 0} leftIcon={<PlusCircle size={14} aria-hidden />}>
                              Crear en el sitio
                            </Button>
                          </span>
                        )}
                        <select value={value} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                          aria-label={`Producto del sitio para ${p.name}`} className={selectClass}>
                          <SiteOptions site={state.site!} />
                        </select>
                      </li>
                    );
                  })}
                </ul>

                <section className="neumorphic rounded-2xl p-4 flex flex-col gap-3" aria-label="Fotos del sitio">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-48">
                      <p className="font-bold text-gray-800 text-sm">Traer fotos del sitio</p>
                      <p className="text-xs text-gray-500">
                        Copia la foto del sitio a los productos vinculados que todavía no tienen una. Las fotos que ya cargaste no se tocan.
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void importPhotos()} loading={busy === "photos"}
                      disabled={changes.length > 0 || linkedCount === 0} leftIcon={<ImageDown size={14} aria-hidden />}>
                      Traer fotos
                    </Button>
                  </div>
                  {changes.length > 0 && <p className="text-xs text-gray-500">Guardá los cambios antes de traer las fotos.</p>}
                  {photos && (
                    <div role="status" className="text-sm text-gray-700 flex flex-col gap-1">
                      <p className="flex items-center gap-2 font-bold"><CheckCheck size={14} aria-hidden />
                        {photos.copied.length} copiadas · {photos.skipped.length} salteadas · {photos.failed.length} con error
                      </p>
                      {photos.failed.map((f) => <p key={f.productId} className="text-xs text-gray-600">{f.name}: {f.reason}</p>)}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </EditableArea>
  );
}

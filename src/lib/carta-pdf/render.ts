/**
 * Carta en PDF con el diseño de la carta impresa del local: fondo crema, marco fileteado, logo, jugador de fondo
 * y la pelota abajo (imágenes extraídas de la carta original, ver scripts/carta-pdf-assets.py), con fuentes Lora
 * embebidas. PDF 1.4 escrito a mano, sin dependencias: corre igual en Workers (OpenNext), en Node y en los tests.
 * Los precios llegan ya resueltos desde los productos (nunca se guardan en la carta).
 */
import * as assets from "./assets.generated.ts";
import type { CartaFontAsset, CartaImageAsset } from "./assets.generated.ts";

export interface CartaPdfItem {
  nombre: string;
  nota?: string | null;
  /** Un precio por columna (null = sin precio vinculado: se muestra solo el nombre). */
  precios: (number | null)[];
}

export interface CartaPdfSection {
  titulo: string;
  /** Rótulos de las columnas de precio (p. ej. ["8 porciones", "Porción"]). Vacío = una columna sin rótulo. */
  columnas: string[];
  /** "gustos": un solo precio en el título (el del primer ítem con precio) y los ítems sin precio. */
  estilo: "lista" | "gustos";
  nota?: string | null;
  items: CartaPdfItem[];
}

export interface CartaPdfInput {
  secciones: CartaPdfSection[];
  footer?: string;
}

const W = 595.28;
const H = 841.89;
const X0 = 84;
const COL_RIGHT = 392;
const COL_W = 64;
const TOP = 670;
/** Límite inferior del contenido: la hoja 1 tiene la pelota y las esquinas; las siguientes, el fileteado bajo. */
const BOTTOM_FIRST = 236;
const BOTTOM_REST = 92;

const RED = "0.70 0.09 0.08";
const INK = "0.16 0.10 0.07";
const MUTED = "0.45 0.33 0.25";
const CREAM = "0.965 0.910 0.820";

/** "$25.000" (con coma si tiene centavos). */
export function pesosCarta(value: number): string {
  const cents = Math.round(value * 100);
  const int = Math.trunc(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = Math.abs(cents) % 100;
  return `${cents < 0 ? "-" : ""}$${int}${dec ? `,${String(dec).padStart(2, "0")}` : ""}`;
}

// --- texto WinAnsi ------------------------------------------------------------------------------------------
const CP1252: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };

/** Códigos WinAnsi del texto: lo que no entra (emojis, etc.) se descarta. */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/\s+/g, " ")) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else if (CP1252[ch]) out.push(CP1252[ch]);
  }
  return out;
}

const width = (font: CartaFontAsset, text: string, size: number): number =>
  winAnsi(text).reduce((acc, c) => acc + (font.widths[c - 32] ?? 500), 0) * size / 1000;

const pdfString = (text: string): string =>
  `(${winAnsi(text).map((c) => (c === 0x28 || c === 0x29 || c === 0x5c ? `\\${String.fromCharCode(c)}` : c < 0x80 ? String.fromCharCode(c) : `\\${c.toString(8).padStart(3, "0")}`)).join("")})`;

type FontKey = "R" | "B" | "I";
const FONTS: Record<FontKey, CartaFontAsset> = { R: assets.loraRegular, B: assets.loraBold, I: assets.loraItalic };

/** Recorta con "…" hasta que entre en el ancho. */
function fit(text: string, font: FontKey, size: number, max: number): string {
  if (width(FONTS[font], text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && width(FONTS[font], `${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// --- páginas ------------------------------------------------------------------------------------------------
type ImageKey = "marco" | "logo" | "jugador" | "marcoSuperior" | "pie";
const IMAGES: Record<ImageKey, CartaImageAsset> = {
  marco: assets.marco,
  logo: assets.logo,
  jugador: assets.jugador,
  marcoSuperior: assets.marcoSuperior,
  pie: assets.pie,
};

class Page {
  ops: string[] = [];
  y = TOP;
  readonly first: boolean;
  constructor(first: boolean) {
    this.first = first;
    this.ops.push(`${CREAM} rg 0 0 ${W} ${H} re f`);
    this.ops.push("q /GsJugador gs");
    this.image("jugador", 280, 186, 335, 466);
    this.ops.push("Q");
    if (first) this.image("marco", -1, -40, 597, 895);
    else {
      this.image("pie", 11, 1, 585, 247);
      this.image("marcoSuperior", -1, 241, 597, 617);
    }
    this.image("logo", 113, 606, 369, 246);
  }
  get bottom(): number {
    return this.first ? BOTTOM_FIRST : BOTTOM_REST;
  }
  image(key: ImageKey, x: number, y: number, w: number, h: number) {
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${key} Do Q`);
  }
  text(font: FontKey, size: number, color: string, x: number, y: number, value: string) {
    this.ops.push(`BT ${color} rg /F${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`);
  }
  right(font: FontKey, size: number, color: string, xRight: number, y: number, value: string) {
    this.text(font, size, color, xRight - width(FONTS[font], value, size), y, value);
  }
  /** Puntos guía sutiles entre el nombre y el primer precio. */
  leader(x1: number, x2: number, y: number) {
    if (x2 - x1 < 8) return;
    this.ops.push(`q ${MUTED} RG 0.8 w 1 J [0.1 3.2] 0 d ${x1.toFixed(2)} ${(y + 1.5).toFixed(2)} m ${x2.toFixed(2)} ${(y + 1.5).toFixed(2)} l S Q`);
  }
}

const colRight = (count: number, i: number): number => COL_RIGHT - (count - 1 - i) * COL_W;

function sectionHeaderHeight(s: CartaPdfSection): number {
  return 24 + (s.nota ? 11 : 0);
}
const ITEM = 15.5;
const itemHeight = (it: CartaPdfItem): number => ITEM + (it.nota ? 9 : 0);

function layout(input: CartaPdfInput): Page[] {
  const pages: Page[] = [new Page(true)];
  let page = pages[0];
  const ensure = (h: number) => {
    if (page.y - h < page.bottom) {
      page = new Page(false);
      pages.push(page);
    }
  };

  for (const s of input.secciones) {
    if (s.items.length === 0) continue;
    const firstItem = s.items[0] ? itemHeight(s.items[0]) : 0;
    ensure(sectionHeaderHeight(s) + firstItem);
    if (page.y !== TOP) page.y -= 8;
    const cols = Math.max(1, s.columnas.length);
    page.text("B", 15, RED, X0, page.y, s.titulo.toUpperCase());
    if (s.estilo === "gustos") {
      const unico = s.items.flatMap((i) => i.precios).find((p): p is number => typeof p === "number");
      if (unico !== undefined) page.right("B", 13, INK, COL_RIGHT, page.y, `${pesosCarta(unico)} c/u`);
    } else {
      s.columnas.forEach((label, i) => page.right("I", 8.5, RED, colRight(cols, i), page.y, `(${label})`));
    }
    page.y -= 6;
    page.ops.push(`q ${RED} RG 0.6 w ${X0} ${page.y.toFixed(2)} m ${COL_RIGHT} ${page.y.toFixed(2)} l S Q`);
    page.y -= 14;
    if (s.nota) {
      page.text("I", 8.5, MUTED, X0, page.y + 3, s.nota);
      page.y -= 11;
    }
    for (const it of s.items) {
      ensure(itemHeight(it));
      const priceStart = s.estilo === "gustos" ? COL_RIGHT : colRight(cols, 0) - COL_W + 10;
      const name = fit(it.nombre, "R", 12, priceStart - X0 - 6);
      page.text("R", 12, INK, X0, page.y, name);
      if (s.estilo !== "gustos") {
        const prices = Array.from({ length: cols }, (_, i) => it.precios[i] ?? null);
        const anyPrice = prices.some((p) => p !== null);
        if (anyPrice) {
          const firstWithPrice = prices.findIndex((p) => p !== null);
          const priceText = pesosCarta(prices[firstWithPrice] as number);
          const firstX = colRight(cols, firstWithPrice) - width(FONTS.B, priceText, 12);
          page.leader(X0 + width(FONTS.R, name, 12) + 4, firstX - 4, page.y);
        }
        prices.forEach((p, i) => {
          if (p !== null) page.right("B", 12, INK, colRight(cols, i), page.y, pesosCarta(p));
        });
      }
      if (it.nota) {
        page.text("I", 8.5, MUTED, X0 + 2, page.y - 9.5, `(${it.nota})`);
        page.y -= 9;
      }
      page.y -= ITEM;
    }
  }
  if (input.footer) {
    const last = pages[pages.length - 1];
    last.text("I", 8, MUTED, X0, last.first ? BOTTOM_FIRST - 18 : BOTTOM_REST - 22, input.footer);
  }
  return pages;
}

// --- escritura del PDF --------------------------------------------------------------------------------------
function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const latin1Bytes = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private offsets: number[] = [];
  private next = 1;
  reserve(): number {
    return this.next++;
  }
  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }
  raw(s: string) {
    this.push(latin1Bytes(s));
  }
  obj(id: number, body: string) {
    this.offsets[id] = this.size;
    this.raw(`${id} 0 obj\n${body}\nendobj\n`);
  }
  stream(id: number, dict: string, data: Uint8Array) {
    this.offsets[id] = this.size;
    this.raw(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    this.push(data);
    this.raw("\nendstream\nendobj\n");
  }
  finish(rootId: number): Uint8Array {
    const xref = this.size;
    let tail = `xref\n0 ${this.next}\n0000000000 65535 f \n`;
    for (let id = 1; id < this.next; id++) tail += `${String(this.offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
    tail += `trailer\n<< /Size ${this.next} /Root ${rootId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.raw(tail);
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

const FONT_NAMES: Record<FontKey, string> = { R: "Lora-Regular", B: "Lora-Bold", I: "Lora-Italic" };

function writeFont(w: Writer, key: FontKey): number {
  const f = FONTS[key];
  const fileId = w.reserve();
  const descId = w.reserve();
  const fontId = w.reserve();
  w.stream(fileId, `/Filter /FlateDecode /Length1 ${f.length}`, base64Bytes(f.file));
  w.obj(
    descId,
    `<< /Type /FontDescriptor /FontName /${FONT_NAMES[key]} /Flags ${key === "I" ? 98 : 34} /FontBBox [-500 -300 1300 1100] ` +
      `/ItalicAngle ${key === "I" ? -12 : 0} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight 700 /StemV ${key === "B" ? 140 : 80} /FontFile2 ${fileId} 0 R >>`,
  );
  w.obj(
    fontId,
    `<< /Type /Font /Subtype /TrueType /BaseFont /${FONT_NAMES[key]} /FirstChar 32 /LastChar 255 ` +
      `/Widths [${f.widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${descId} 0 R >>`,
  );
  return fontId;
}

function writeImage(w: Writer, img: CartaImageAsset): number {
  const maskId = w.reserve();
  const id = w.reserve();
  w.stream(maskId, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, base64Bytes(img.alpha));
  w.stream(id, `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /SMask ${maskId} 0 R`, base64Bytes(img.jpeg));
  return id;
}

/** Bytes del PDF de la carta. */
export function renderCartaPdf(input: CartaPdfInput): Uint8Array {
  const pages = layout(input);
  const w = new Writer();
  w.raw("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const catalogId = w.reserve();
  const pagesId = w.reserve();
  const fontIds = (Object.keys(FONTS) as FontKey[]).map((k) => `/F${k} ${writeFont(w, k)} 0 R`).join(" ");
  const imageIds = (Object.keys(IMAGES) as ImageKey[]).map((k) => `/${k} ${writeImage(w, IMAGES[k])} 0 R`).join(" ");
  const resources = `<< /Font << ${fontIds} >> /XObject << ${imageIds} >> /ExtGState << /GsJugador << /Type /ExtGState /ca 0.38 >> >> >>`;
  const pageIds = pages.map((p) => {
    const contentId = w.reserve();
    const pageId = w.reserve();
    w.stream(contentId, "", latin1Bytes(p.ops.join("\n")));
    w.obj(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
    return pageId;
  });
  w.obj(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  w.obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return w.finish(catalogId);
}

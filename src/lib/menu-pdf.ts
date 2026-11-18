/**
 * Carta en PDF sin dependencias: un PDF 1.4 mínimo con las fuentes estándar Helvetica (no se embeben,
 * así que pesa pocos KB) y codificación WinAnsi (tildes y ñ). Puro TypeScript: corre igual en Workers
 * (OpenNext), en Node y en los tests. Lo usa GET /api/public/carta.pdf y lo manda el bot por WhatsApp.
 */

export interface MenuPdfItem {
  name: string;
  price: number;
}

export interface MenuPdfCategory {
  name: string;
  items: MenuPdfItem[];
}

export interface MenuPdfInput {
  businessName: string;
  categories: MenuPdfCategory[];
  /** Pie de página (p. ej. "Precios vigentes al 17/11/2026"). */
  footer?: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const LINE = 18;
const MAX_NAME = 70;

/** "$3.500" (sin decimales si es entero; con coma si los tiene). */
export function pesos(value: number): string {
  const cents = Math.round(value * 100);
  const int = Math.trunc(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = Math.abs(cents) % 100;
  return `${cents < 0 ? "-" : ""}$${int}${dec ? `,${String(dec).padStart(2, "0")}` : ""}`;
}

/** Deja solo caracteres de Latin-1 (WinAnsi): emojis y símbolos raros se van. */
function latin1(text: string): string {
  return text.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
}

const esc = (text: string): string => latin1(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Ancho aproximado de Helvetica (promedio de 0,5 em): alcanza para alinear precios a la derecha. */
const approxWidth = (text: string, size: number): number => latin1(text).length * size * 0.5;

type Op = string;

function text(x: number, y: number, size: number, bold: boolean, value: string): Op {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(value)}) Tj ET`;
}

/** Arma las páginas (cada una es una lista de operadores de contenido). */
function layout(input: MenuPdfInput): Op[][] {
  const pages: Op[][] = [];
  let ops: Op[] = [];
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = PAGE_H - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) newPage();
  };

  ops.push(text(MARGIN, y - 10, 24, true, input.businessName || "Carta"));
  y -= 34;
  ops.push(text(MARGIN, y - 6, 12, false, "Carta"));
  y -= 30;

  for (const cat of input.categories) {
    if (cat.items.length === 0) continue;
    ensure(LINE * 3);
    ops.push(text(MARGIN, y, 15, true, cat.name));
    ops.push(`0.8 g ${MARGIN} ${(y - 5).toFixed(1)} ${PAGE_W - 2 * MARGIN} 0.8 re f 0 g`);
    y -= LINE + 6;
    for (const item of cat.items) {
      ensure(LINE);
      const price = pesos(item.price);
      const name = latin1(item.name).slice(0, MAX_NAME);
      ops.push(text(MARGIN + 8, y, 11, false, name));
      ops.push(text(PAGE_W - MARGIN - approxWidth(price, 11), y, 11, true, price));
      y -= LINE;
    }
    y -= 10;
  }
  if (input.footer) {
    ensure(LINE);
    ops.push(text(MARGIN, MARGIN, 9, false, input.footer));
  }
  newPage();
  return pages;
}

/** Bytes del PDF (Latin-1: cada carácter es un byte). */
export function renderMenuPdf(input: MenuPdfInput): Uint8Array {
  const pages = layout(input);
  const objects: string[] = [];
  // 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, después página + contenido por cada hoja.
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((ops, i) => {
    const pageId = pageIds[i];
    const stream = ops.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** Agrupa los productos del portal por categoría (orden alfabético; sin categoría → "Otros" al final). */
export function groupForPdf(
  products: readonly { name: string; price: number; category_id: string | null }[],
  categories: readonly { id: string; name: string }[],
): MenuPdfCategory[] {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, MenuPdfItem[]>();
  for (const p of products) {
    const cat = (p.category_id && names.get(p.category_id)) || "Otros";
    groups.set(cat, [...(groups.get(cat) ?? []), { name: p.name, price: p.price }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Otros" ? 1 : b === "Otros" ? -1 : a.localeCompare(b, "es")))
    .map(([name, items]) => ({ name, items: [...items].sort((x, y) => x.name.localeCompare(y.name, "es")) }));
}

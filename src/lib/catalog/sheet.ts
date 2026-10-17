import type { Category, Product } from "@/types/catalog";

/** Columnas de la planilla de la carta (la misma para Excel y CSV). */
export const CATALOG_HEADERS = ["ID", "Categoría", "Nombre", "Descripción", "Precio", "Activo", "Puntos por $100", "Imagen"] as const;

export const MAX_PRICE = 10_000_000;
export const MAX_IMPORT_ROWS = 2000;

export type Cell = string | number;

export interface RowError {
  line: number;
  message: string;
}

/** Fila ya leída y validada; `undefined` = la columna no estaba en el archivo. */
export interface ParsedRow {
  line: number;
  id?: string;
  categoryName?: string;
  name: string;
  description?: string;
  price: number;
  isActive?: boolean;
  /** `null` = celda vacía (hereda de la categoría); `undefined` = columna ausente. */
  points?: number | null;
}

export interface NewProductPlan {
  line: number;
  name: string;
  description: string;
  price: number;
  categoryName: string | null;
  isActive: boolean;
  points: number | null;
}

export interface ProductUpdatePlan {
  line: number;
  id: string;
  name: string;
  /** Campos que cambian, en español, para mostrar en la vista previa. */
  changes: string[];
  patch: {
    name?: string;
    description?: string;
    price?: number;
    /** `null` = quitar la categoría. */
    categoryName?: string | null;
    is_active?: boolean;
    points_per_100?: number | null;
  };
}

export interface ImportPlan {
  creates: NewProductPlan[];
  updates: ProductUpdatePlan[];
  unchanged: number;
  errors: RowError[];
  newCategories: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Exportación ─────────────────────────────────────────────────────────────

export function productsToRows(products: readonly Product[], categories: readonly Category[]): Cell[][] {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return products.map((p) => [
    p.id,
    names.get(p.category_id) ?? "",
    p.name,
    p.description,
    p.price,
    p.is_active ? "Sí" : "No",
    p.points_per_100 ?? "",
    // Las imágenes embebidas del modo demo no se exportan: pesan y no sirven fuera de la app.
    p.image_url.startsWith("data:") ? "" : p.image_url,
  ]);
}

// ─── Lectura de CSV ──────────────────────────────────────────────────────────

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

/** CSV según RFC 4180 (comillas, saltos dentro de celda); detecta `;` de Excel es-AR. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Validación de filas ─────────────────────────────────────────────────────

type Column = "id" | "category" | "name" | "description" | "price" | "active" | "points";

const HEADER_ALIASES: Record<string, Column> = {
  id: "id",
  categoria: "category",
  nombre: "name",
  producto: "name",
  descripcion: "description",
  precio: "price",
  activo: "active",
  activa: "active",
  estado: "active",
  "puntos por $100": "points",
  puntos: "points",
};

const TRUE_VALUES = new Set(["si", "s", "1", "true", "yes", "activo", "activa"]);
const FALSE_VALUES = new Set(["no", "n", "0", "false", "inactivo", "inactiva"]);

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Acepta 1500, "1500.5", "1.500,50" y "$ 1.500". Devuelve NaN si no es un número. */
export function parsePrice(value: unknown): number {
  if (typeof value === "number") return value;
  const raw = cellText(value).replace(/[$\s]/g, "");
  if (raw === "") return Number.NaN;
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  let normalized = raw;
  if (hasDot && hasComma) {
    normalized = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  }
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export function parseCatalogRows(sheet: ReadonlyArray<ReadonlyArray<unknown>>): { rows: ParsedRow[]; errors: RowError[] } {
  const [header = [], ...body] = sheet;
  const columns = new Map<Column, number>();
  header.forEach((title, index) => {
    const column = HEADER_ALIASES[normalize(cellText(title))];
    if (column && !columns.has(column)) columns.set(column, index);
  });

  const missing = (["name", "price"] as const).filter((c) => !columns.has(c));
  if (missing.length > 0) {
    const labels = missing.map((c) => (c === "name" ? "Nombre" : "Precio")).join(" y ");
    return { rows: [], errors: [{ line: 1, message: `Falta la columna ${labels} en la primera fila.` }] };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const at = (cells: ReadonlyArray<unknown>, column: Column) => {
    const index = columns.get(column);
    return index === undefined ? undefined : cells[index];
  };

  body.forEach((cells, offset) => {
    const line = offset + 2;
    if (cells.every((c) => cellText(c) === "")) return;

    const name = cellText(at(cells, "name"));
    if (name === "") { errors.push({ line, message: "El nombre está vacío." }); return; }
    if (name.length > 120) { errors.push({ line, message: `"${name.slice(0, 20)}…": el nombre supera 120 caracteres.` }); return; }

    const price = parsePrice(at(cells, "price"));
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
      errors.push({ line, message: `"${name}": el precio no es válido.` });
      return;
    }

    const id = cellText(at(cells, "id"));
    if (id !== "" && !UUID.test(id)) { errors.push({ line, message: `"${name}": el ID no es válido.` }); return; }

    let isActive: boolean | undefined;
    const activeText = normalize(cellText(at(cells, "active")));
    if (activeText !== "") {
      if (TRUE_VALUES.has(activeText)) isActive = true;
      else if (FALSE_VALUES.has(activeText)) isActive = false;
      else { errors.push({ line, message: `"${name}": "Activo" debe ser Sí o No.` }); return; }
    }

    let points: number | null | undefined;
    if (columns.has("points")) {
      const raw = cellText(at(cells, "points"));
      if (raw === "") points = null;
      else {
        const n = parsePrice(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1000) { errors.push({ line, message: `"${name}": los puntos por $100 no son válidos.` }); return; }
        points = n;
      }
    }

    const description = columns.has("description") ? cellText(at(cells, "description")) : undefined;
    if (description !== undefined && description.length > 500) {
      errors.push({ line, message: `"${name}": la descripción supera 500 caracteres.` });
      return;
    }

    rows.push({
      line,
      ...(id !== "" ? { id: id.toLowerCase() } : {}),
      ...(columns.has("category") ? { categoryName: cellText(at(cells, "category")) } : {}),
      name,
      ...(description !== undefined ? { description } : {}),
      price,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(points !== undefined ? { points } : {}),
    });
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 1, message: `El archivo supera el máximo de ${MAX_IMPORT_ROWS} productos.` }] };
  }
  return { rows, errors };
}

// ─── Plan de importación ─────────────────────────────────────────────────────

export function planImport(
  rows: readonly ParsedRow[],
  products: readonly Product[],
  categories: readonly Category[],
): ImportPlan {
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const categoryByKey = new Map(categories.map((c) => [normalize(c.name), c.name]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryNameOf = (p: Product) => categoryNameById.get(p.category_id) ?? "";
  const productByKey = new Map(products.map((p) => [`${normalize(p.name)}|${normalize(categoryNameOf(p))}`, p]));

  const plan: ImportPlan = { creates: [], updates: [], unchanged: 0, errors: [], newCategories: [] };
  const seenProducts = new Set<string>();
  const seenNew = new Set<string>();
  const newCategoryKeys = new Set<string>();

  /** Nombre canónico de la categoría (la existente si coincide; si no, se crea). */
  const resolveCategory = (name: string): string | null => {
    const trimmed = name.trim();
    if (trimmed === "") return null;
    const key = normalize(trimmed);
    const existing = categoryByKey.get(key);
    if (existing) return existing;
    if (!newCategoryKeys.has(key)) { newCategoryKeys.add(key); plan.newCategories.push(trimmed); }
    return trimmed;
  };

  for (const row of rows) {
    const target = row.id
      ? productById.get(row.id)
      : productByKey.get(`${normalize(row.name)}|${normalize(row.categoryName ?? "")}`);

    if (row.id && !target) {
      plan.errors.push({ line: row.line, message: `"${row.name}": el ID no existe en la carta actual.` });
      continue;
    }

    if (!target) {
      const key = `${normalize(row.name)}|${normalize(row.categoryName ?? "")}`;
      if (seenNew.has(key)) {
        plan.errors.push({ line: row.line, message: `"${row.name}": está repetido en el archivo.` });
        continue;
      }
      seenNew.add(key);
      plan.creates.push({
        line: row.line,
        name: row.name,
        description: row.description ?? "",
        price: row.price,
        categoryName: resolveCategory(row.categoryName ?? ""),
        isActive: row.isActive ?? true,
        points: row.points ?? null,
      });
      continue;
    }

    if (seenProducts.has(target.id)) {
      plan.errors.push({ line: row.line, message: `"${row.name}": está repetido en el archivo.` });
      continue;
    }
    seenProducts.add(target.id);

    const changes: string[] = [];
    const patch: ProductUpdatePlan["patch"] = {};
    // Emparejado por nombre: el nombre es la clave, solo se renombra cuando viene el ID.
    if (row.id && row.name !== target.name) { changes.push("nombre"); patch.name = row.name; }
    if (row.description !== undefined && row.description !== target.description) { changes.push("descripción"); patch.description = row.description; }
    if (row.price !== target.price) { changes.push("precio"); patch.price = row.price; }
    if (row.isActive !== undefined && row.isActive !== target.is_active) { changes.push("activo"); patch.is_active = row.isActive; }
    if (row.points !== undefined && row.points !== target.points_per_100) { changes.push("puntos"); patch.points_per_100 = row.points; }
    if (row.categoryName !== undefined && normalize(row.categoryName) !== normalize(categoryNameOf(target))) {
      changes.push("categoría");
      patch.categoryName = resolveCategory(row.categoryName);
    }

    if (changes.length === 0) plan.unchanged += 1;
    else plan.updates.push({ line: row.line, id: target.id, name: target.name, changes, patch });
  }

  return plan;
}

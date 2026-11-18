/**
 * De los datos a las secciones del PDF. Puro: lo usan la ruta /api/public/carta.pdf y los tests.
 * Con carta estructurada se respeta su orden y nombres; sin carta, se arma por categorías como antes.
 */
import type { CartaPdfSection } from "./render.ts";

interface ProductoRef {
  precio: number;
}
interface SeccionLike {
  titulo: string;
  columnas: string[];
  estilo: "lista" | "gustos";
  nota: string | null;
  items: { nombre: string; nota: string | null; productos: (ProductoRef | null)[] }[];
}

export function seccionesDesdeCarta(secciones: readonly SeccionLike[]): CartaPdfSection[] {
  return secciones
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      titulo: s.titulo,
      columnas: s.columnas,
      estilo: s.estilo,
      nota: s.nota,
      items: s.items.map((i) => ({ nombre: i.nombre, nota: i.nota, precios: i.productos.map((p) => (p ? p.precio : null)) })),
    }));
}

/** Respaldo sin carta estructurada: una sección por categoría (alfabético, "Otros" al final). */
export function seccionesDesdeCategorias(
  products: readonly { name: string; price: number; category_id: string | null }[],
  categories: readonly { id: string; name: string }[],
): CartaPdfSection[] {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, { nombre: string; precios: number[] }[]>();
  for (const p of products) {
    const cat = (p.category_id && names.get(p.category_id)) || "Otros";
    groups.set(cat, [...(groups.get(cat) ?? []), { nombre: p.name, precios: [p.price] }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Otros" ? 1 : b === "Otros" ? -1 : a.localeCompare(b, "es")))
    .map(([titulo, items]) => ({
      titulo,
      columnas: [],
      estilo: "lista" as const,
      items: [...items].sort((x, y) => x.nombre.localeCompare(y.nombre, "es")),
    }));
}

type Cell = string | number;

/** Excel y Google Sheets ejecutan celdas que empiezan con estos caracteres como fórmulas. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: Cell, delimiter: string): string {
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV con saltos CRLF. Las celdas de texto con aspecto de fórmula se neutralizan. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  delimiter = ",",
): string {
  return [headers, ...rows].map((row) => row.map((c) => cell(c, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

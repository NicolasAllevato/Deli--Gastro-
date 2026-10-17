import ExcelJS from "exceljs";
import { CATALOG_HEADERS, MAX_IMPORT_ROWS, parseCsv, type Cell } from "./sheet";

export type CatalogFormat = "xlsx" | "csv";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Planilla de la carta lista para editar en Excel (precios con formato, cabecera fija). */
export async function buildCatalogXlsx(rows: ReadonlyArray<ReadonlyArray<Cell>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Carta", { views: [{ state: "frozen", ySplit: 1 }] });

  sheet.columns = [
    { header: CATALOG_HEADERS[0], width: 38 },
    { header: CATALOG_HEADERS[1], width: 20 },
    { header: CATALOG_HEADERS[2], width: 30 },
    { header: CATALOG_HEADERS[3], width: 44 },
    { header: CATALOG_HEADERS[4], width: 12, style: { numFmt: "#,##0.00" } },
    { header: CATALOG_HEADERS[5], width: 10 },
    { header: CATALOG_HEADERS[6], width: 16 },
    { header: CATALOG_HEADERS[7], width: 40 },
  ];
  rows.forEach((row) => sheet.addRow([...row]));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CATALOG_HEADERS.length } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Valor de celda de ExcelJS reducido a texto o número (fórmulas → su resultado). */
function plainValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value instanceof Date) return "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("result" in value) return plainValue(value.result as ExcelJS.CellValue);
  if ("text" in value) return String(value.text);
  return "";
}

/** Lee la primera hoja de un .xlsx o un .csv como matriz de celdas. */
export async function readCatalogFile(filename: string, bytes: ArrayBuffer): Promise<Cell[][]> {
  if (/\.csv$/i.test(filename)) return parseCsv(new TextDecoder("utf-8").decode(bytes));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  if (sheet.rowCount > MAX_IMPORT_ROWS + 1) {
    throw new Error(`El archivo supera el máximo de ${MAX_IMPORT_ROWS} productos.`);
  }

  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    for (let col = 1; col <= CATALOG_HEADERS.length + 4; col++) cells.push(plainValue(row.getCell(col).value));
    rows.push(cells);
  });
  return rows;
}

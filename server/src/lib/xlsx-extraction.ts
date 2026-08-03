/**
 * Divini Blueprint - REAL XLSX budget import, using `exceljs` (MIT,
 * https://github.com/exceljs/exceljs). Extends the CSV-only budget import
 * (server/src/lib/csv-parser.ts) to also accept true spreadsheet files -
 * the npm `xlsx` (SheetJS) package was deliberately NOT used here: its
 * published npm version carries an unpatched high-severity prototype-
 * pollution/ReDoS advisory
 * (https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), unacceptable for a
 * parser that runs directly on untrusted user-uploaded files. `exceljs` is
 * actively maintained with no comparable open advisory against its file
 * parser at the time this was written.
 *
 * Reads only the FIRST worksheet, same header-name matching as the CSV
 * path (category/cost code/division/trade, description/item/line item/
 * scope, amount/budget/cost/total/price), so both paths produce the exact
 * same `BudgetCsvRow` shape and can share one downstream pipeline
 * (server/src/routes/blueprint-phase2.ts dispatches by file extension).
 *
 * Zero em dashes by convention.
 */
// A destructured named import (`import { Workbook } from "exceljs"`) breaks
// when this file runs uncompiled (node --experimental-strip-types, used
// by this project's test runner): strip-types removes type annotations only
// and does not rewrite import specifiers, so Node's own static CJS-export
// scan cannot find a "Workbook" binding on this module. The compiled
// production build (tsc, with esModuleInterop) would tolerate either form,
// but the default-import + destructure below is the one shape that works
// identically in both, and is Node's own documented fix for this exact
// warning.
import ExcelJSPkg, { type CellValue, type Workbook as WorkbookType, type Row } from "exceljs";
const { Workbook } = ExcelJSPkg;
import type { BudgetCsvRow } from "./csv-parser.js";

const HEADER_CATEGORY = ["category", "cost code", "cost_code", "division", "trade"];
const HEADER_DESCRIPTION = ["description", "item", "line item", "scope"];
const HEADER_AMOUNT = ["amount", "budget", "cost", "total", "price"];

function cellToString(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const anyV = v as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (typeof anyV.text === "string") return anyV.text;
    if (Array.isArray(anyV.richText)) return anyV.richText.map((r) => r.text ?? "").join("");
    if (anyV.result !== undefined && anyV.result !== null) return String(anyV.result);
    return "";
  }
  return String(v);
}

/** `row.values` in exceljs is a sparse array (index 0 unused) - both header and data rows go through this same conversion, so the resulting indices stay consistent with each other regardless of the leading gap. */
function rowToStrings(values: CellValue[] | { [key: string]: CellValue }): string[] {
  const arr = Array.isArray(values) ? values : Object.values(values);
  return arr.map(cellToString);
}

export async function parseBudgetXlsx(buffer: Buffer): Promise<{ rows: BudgetCsvRow[]; skipped: number; error?: string }> {
  let workbook: WorkbookType;
  try {
    workbook = new Workbook();
    // exceljs bundles its own @types/node, whose Buffer type structurally
    // disagrees with this project's - a known ecosystem quirk, not a real
    // type mismatch (both are Node's actual Buffer at runtime).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    return { rows: [], skipped: 0, error: "could not read this file as an XLSX workbook" };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], skipped: 0, error: "the workbook has no worksheets" };

  const header = rowToStrings(sheet.getRow(1).values).map((h) => h.trim().toLowerCase());
  const categoryIdx = header.findIndex((h) => HEADER_CATEGORY.includes(h));
  const descriptionIdx = header.findIndex((h) => HEADER_DESCRIPTION.includes(h));
  const amountIdx = header.findIndex((h) => HEADER_AMOUNT.includes(h));
  if (amountIdx === -1) {
    return { rows: [], skipped: 0, error: "could not find an amount/budget/cost column in the header row" };
  }

  const rows: BudgetCsvRow[] = [];
  let skipped = 0;
  sheet.eachRow((row: Row, rowNumber: number) => {
    if (rowNumber === 1) return;
    const cells = rowToStrings(row.values);
    const rawAmount = (cells[amountIdx] ?? "").trim();
    const cleaned = rawAmount.replace(/[$,\s]/g, "");
    const dollars = Number(cleaned);
    if (!cleaned || Number.isNaN(dollars)) {
      skipped++;
      return;
    }
    rows.push({
      category: categoryIdx >= 0 ? (cells[categoryIdx] ?? "").trim() : "",
      description: descriptionIdx >= 0 ? (cells[descriptionIdx] ?? "").trim() : "",
      amountCents: Math.round(dollars * 100),
      rawAmount,
    });
  });

  return { rows, skipped };
}

/**
 * Test-support only: builds a minimal in-memory XLSX workbook buffer for
 * round-tripping through parseBudgetXlsx() in tests/xlsx-extraction.test.ts.
 * Exported (rather than duplicating an exceljs import in the tests
 * directory) because `exceljs` is only installed under server/node_modules
 * - tests/*.test.ts files resolve bare specifiers from their own location
 * at the repo root and would not find it there, the same reason every test
 * in this suite imports library code via a relative ../server/src path
 * instead of importing packages directly.
 */
export async function buildTestWorkbookBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

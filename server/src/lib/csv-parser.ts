/**
 * Minimal, dependency-free CSV parser (pure, no IO). This codebase has no
 * spreadsheet library (no xlsx/exceljs/papaparse in package.json) - budget
 * import is therefore scoped to CSV only, which is plain text and needs no
 * such library. XLSX/XLS import is NOT supported; callers must say so
 * honestly rather than silently failing on a binary file.
 *
 * Handles RFC 4180 basics: quoted fields, escaped quotes ("" inside a
 * quoted field), commas and newlines inside quotes, and both CRLF and LF
 * line endings. Not a full RFC 4180 implementation (no support for
 * alternate delimiters or non-UTF8 encodings) - sufficient for a
 * spreadsheet-exported budget CSV.
 *
 * Zero em dashes by convention.
 */

/** Parse CSV text into rows of string cells. Every row (including a shorter trailing row) is returned as-is; callers decide how to handle ragged rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Trailing field/row (a file with no final newline).
  if (field.length > 0 || row.length > 0) endRow();

  // Drop wholly-empty trailing rows (a common trailing-blank-line artifact).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();

  return rows;
}

export type BudgetCsvRow = { category: string; description: string; amountCents: number; rawAmount: string };

/**
 * Interprets the first row as a header and looks for common budget-export
 * column names (case-insensitive): a category/cost-code column, a
 * description column, and an amount column. Money is parsed defensively -
 * strips $ and thousands separators, rejects anything that is not a clean
 * number by returning null for that row's parse rather than guessing.
 */
export function parseBudgetCsv(text: string): { rows: BudgetCsvRow[]; skipped: number; error?: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0, error: "the file is empty" };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const categoryIdx = header.findIndex((h) => ["category", "cost code", "cost_code", "division", "trade"].includes(h));
  const descriptionIdx = header.findIndex((h) => ["description", "item", "line item", "scope"].includes(h));
  const amountIdx = header.findIndex((h) => ["amount", "budget", "cost", "total", "price"].includes(h));

  if (amountIdx === -1) {
    return { rows: [], skipped: 0, error: "could not find an amount/budget/cost column in the header row" };
  }

  const rows: BudgetCsvRow[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    const rawAmount = (line[amountIdx] ?? "").trim();
    const cleaned = rawAmount.replace(/[$,\s]/g, "");
    const dollars = Number(cleaned);
    if (!cleaned || Number.isNaN(dollars)) {
      skipped++;
      continue;
    }
    rows.push({
      category: categoryIdx >= 0 ? (line[categoryIdx] ?? "").trim() : "",
      description: descriptionIdx >= 0 ? (line[descriptionIdx] ?? "").trim() : "",
      amountCents: Math.round(dollars * 100),
      rawAmount,
    });
  }
  return { rows, skipped };
}

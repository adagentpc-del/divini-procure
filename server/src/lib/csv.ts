/**
 * Tiny CSV serializer (no dependency). Produces an RFC-4180-ish CSV string with
 * a header row. Values containing quotes, commas, or newlines are wrapped in
 * double quotes with embedded quotes doubled. null/undefined render as empty.
 *
 * Zero em dashes by convention.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert an array of row objects to a CSV string.
 * @param rows    the data rows.
 * @param columns optional explicit column order; when omitted, the union of all
 *                keys (in first-seen order) is used.
 */
export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  let cols = columns;
  if (!cols || cols.length === 0) {
    const seen = new Set<string>();
    cols = [];
    for (const row of rows) {
      for (const k of Object.keys(row ?? {})) {
        if (!seen.has(k)) {
          seen.add(k);
          cols.push(k);
        }
      }
    }
  }
  const lines: string[] = [];
  lines.push(cols.map(escapeCell).join(","));
  for (const row of rows) {
    lines.push(cols.map((c) => escapeCell(row?.[c])).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Generic, tolerant CSV parser used by the admin CSV Import tool.
 *
 * parseCsv(text) -> { headers, rows } where:
 *   headers  the first non-blank line split into trimmed, lower-cased column
 *            names (so callers can map columns by header name).
 *   rows     every subsequent non-blank line, split into trimmed string cells.
 *
 * Honours simple RFC-4180 quoting: a field wrapped in double quotes may contain
 * commas, and an embedded double quote is written as "". Leading/trailing
 * whitespace around each cell is trimmed. Fully blank lines are skipped.
 *
 * Zero em dashes by convention.
 */

/** Split a single CSV line on commas, honouring simple double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse tolerant CSV text. The first non-blank line is treated as the header
 * row; its cells are lower-cased so callers can map columns by name. Remaining
 * non-blank lines become rows of trimmed string cells.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = String(text || "")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(splitCsvLine(lines[i]));
  }
  return { headers, rows };
}

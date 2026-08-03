/**
 * Divini Follow-Up Desk - SCHEDULING + TEMPLATE RENDERING (pure, no IO).
 *
 * Deterministic only: a delay is arithmetic (with optional business-day
 * skipping), and a template is a fixed string with {{merge_field}}
 * substitution - never generated text. This is what "must work without an
 * LLM" means for a follow-up workflow: the SEQUENCE and WORDING are fixed by
 * the workflow author (or Divini's seeded defaults); only the timing and the
 * merge-field values are computed per record.
 *
 * Zero em dashes by convention.
 */

export type DelayUnit = "minutes" | "hours" | "days" | "business_days";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Add a delay to a date. business_days skips Saturday/Sunday (UTC calendar
 * day), landing on the Nth weekday after `from` - it does not count `from`
 * itself as day zero if `from` is already a weekend, it starts counting from
 * the next occurring day.
 */
export function addDelay(from: Date, value: number, unit: DelayUnit): Date {
  const v = Math.max(0, Math.round(value || 0));
  if (unit === "minutes") return new Date(from.getTime() + v * MS_PER_MINUTE);
  if (unit === "hours") return new Date(from.getTime() + v * MS_PER_HOUR);
  if (unit === "days") return new Date(from.getTime() + v * MS_PER_DAY);

  // business_days: step one calendar day at a time, only counting weekdays.
  let d = new Date(from.getTime());
  let remaining = v;
  while (remaining > 0) {
    d = new Date(d.getTime() + MS_PER_DAY);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

/**
 * Render a template body by substituting {{key}} tokens with values from
 * `fields`. An unmatched token is left as-is (visibly broken, rather than
 * silently dropped) so a missing merge field is easy to spot in review.
 */
export function renderTemplate(body: string, fields: Record<string, string | number | null | undefined>): string {
  return (body || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const v = fields[key];
    return v == null ? match : String(v);
  });
}

/** True when `date` falls within `withinDays` days from now (and is not already past). */
export function isApproaching(date: Date | string | null | undefined, withinDays: number, now: Date = new Date()): boolean {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const diffDays = (d.getTime() - now.getTime()) / MS_PER_DAY;
  return diffDays >= 0 && diffDays <= withinDays;
}

/** True when `date` is at least `days` in the past (or null/never happened, per `treatNullAsStale`). */
export function isStale(date: Date | string | null | undefined, days: number, now: Date = new Date(), treatNullAsStale = true): boolean {
  if (!date) return treatNullAsStale;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return treatNullAsStale;
  const diffDays = (now.getTime() - d.getTime()) / MS_PER_DAY;
  return diffDays >= days;
}

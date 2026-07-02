/**
 * Local-model-first profile extraction (ported from Divini Partners).
 *
 * Given a public website or document link, this fetches the page server-side,
 * strips it to plain text, and asks a LOCAL LLM to structure the PUBLIC profile
 * fields it can see (description, services, tags, name). Every returned field is
 * a suggestion the owner must verify; we never invent pricing, availability,
 * capacity, insurance, or certifications.
 *
 * The LLM is never a hard dependency: any failure (fetch error, timeout, model
 * off, bad JSON) returns null and the caller falls back to deterministic intake.
 *
 * ZERO em dashes in this file (hard rule). Self-contained: only ./llm + ./safe-fetch.
 */
import { llmEnabled, llmJson } from "./llm.js";
import { safeFetch } from "./safe-fetch.js";

export type ExtractedProfile = {
  description?: string;
  services?: string[];
  tags?: string[];
  name?: string;
};

const FETCH_TIMEOUT_MS = 12000;
const MAX_BODY_BYTES = 600_000; // cap to keep memory + token use bounded
const MAX_TEXT_CHARS = 12_000; // text handed to the model

function normalizeUrl(url: string): string | null {
  const s = (url || "").trim();
  if (s.length < 3) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Fetch a URL with a timeout and a hard body-size cap. Returns text or null. */
async function fetchTextCapped(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // SSRF-guarded fetch (validates host + every redirect target).
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "DiviniProcureIntelBot/1.0 (+public profile import)",
      },
    });
    if (!res || !res.ok) return null;
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (ctype && !/text\/|html|xml|json/.test(ctype)) return null;

    const reader = res.body?.getReader();
    if (!reader) {
      const fallback = await res.text();
      return fallback.slice(0, MAX_BODY_BYTES);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= MAX_BODY_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // best effort
          }
          break;
        }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Strip HTML to readable text. Drops scripts, styles, and tags; collapses space. */
export function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = noScript
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_TEXT_CHARS);
}

/**
 * Fetch a public URL and use the local LLM to extract structured public-profile
 * fields. Returns null on any failure so the caller can fall back to the
 * deterministic intake. Returned fields are SUGGESTIONS pending owner
 * verification and contain no fabricated pricing/availability/capacity/insurance.
 */
export async function extractProfileFromUrl(url: string): Promise<ExtractedProfile | null> {
  if (!llmEnabled()) return null;
  const clean = normalizeUrl(url);
  if (!clean) return null;

  const raw = await fetchTextCapped(clean);
  if (!raw) return null;
  const text = htmlToText(raw);
  if (text.length < 40) return null;

  const system =
    "You extract a public business profile from website text. You only restate " +
    "information that is clearly present in the text. You NEVER invent or imply " +
    "pricing, availability, capacity, insurance, certifications, awards, or " +
    "ratings. If a field is not clearly stated, omit it. Reply with JSON only.";

  const prompt =
    "Source URL: " +
    clean +
    "\n\nPage text (truncated):\n" +
    text +
    "\n\nExtract ONLY public profile fields that are clearly stated." +
    ' Return JSON exactly as: {"name": string, "description": string,' +
    ' "services": string[], "tags": string[]}.' +
    " name is the business name. description is 2 to 4 neutral factual sentences" +
    " using only what the page states. services is a short list of named offerings" +
    " mentioned on the page. tags is 3 to 10 short lowercase labels. Omit any field" +
    " you cannot support from the text. Never output pricing, availability," +
    " capacity, insurance, or certification claims.";

  const out = await llmJson<{
    name?: unknown;
    description?: unknown;
    services?: unknown;
    tags?: unknown;
  }>(prompt, { system, timeoutMs: 20000 });
  if (!out) return null;

  const result: ExtractedProfile = {};

  if (typeof out.name === "string" && out.name.trim().length > 1) {
    result.name = out.name.trim().slice(0, 160);
  }
  if (typeof out.description === "string" && out.description.trim().length > 20) {
    result.description = out.description.trim().slice(0, 2000);
  }
  if (Array.isArray(out.services)) {
    const services = out.services
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 120)
      .slice(0, 20);
    if (services.length > 0) result.services = services;
  }
  if (Array.isArray(out.tags)) {
    const tags = Array.from(
      new Set(
        out.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    ).slice(0, 12);
    if (tags.length > 0) result.tags = tags;
  }

  if (
    result.name === undefined &&
    result.description === undefined &&
    result.services === undefined &&
    result.tags === undefined
  ) {
    return null;
  }
  return result;
}

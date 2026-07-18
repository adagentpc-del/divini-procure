/**
 * Local-first LLM client (ported from Divini Partners, made self-contained).
 *
 * Reads LLM_PROVIDER / OLLAMA_URL / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL
 * directly from process.env so this module has NO dependency on config.ts.
 *
 * Defaults to a local Ollama server (LLM_PROVIDER=ollama, OLLAMA_URL). An
 * OpenAI-compatible endpoint is used only when explicitly configured. Every
 * call is best-effort with a timeout: on any failure or when disabled, callers
 * MUST fall back to deterministic logic. The LLM is never a hard dependency of
 * any feature, and llmEnabled() returns false unless explicitly configured.
 *
 * Zero em dashes.
 */

export const LLM_PROVIDER = (process.env.LLM_PROVIDER || "").toLowerCase(); // "ollama" | "openai-compat"
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const LLM_MODEL = process.env.LLM_MODEL || "llama3.1";
// LLM_API_KEY is intentionally NOT exported: it is an API credential and must
// stay private to this module. Exporting it would allow other modules to log or
// leak it accidentally. All callers use llmComplete/llmText/llmJson instead.
const LLM_API_KEY = process.env.LLM_API_KEY || "";
export const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");

/**
 * True only when the optional AI layer is explicitly configured. The default
 * (no env vars set) is false, so every feature stays deterministic and
 * cost-safe out of the box.
 *   - ollama:        requires LLM_PROVIDER=ollama (+ a reachable OLLAMA_URL)
 *   - openai-compat: requires LLM_PROVIDER=openai-compat + LLM_BASE_URL
 */
export function llmEnabled(): boolean {
  if (LLM_PROVIDER === "ollama") return Boolean(OLLAMA_URL);
  if (LLM_PROVIDER === "openai-compat") return Boolean(LLM_BASE_URL);
  return false;
}

export interface LlmResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface LlmOptions {
  system?: string;
  json?: boolean;
  timeoutMs?: number;
  model?: string;
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await p(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Run a single completion. Returns ok:false on any error or when disabled. */
export async function llmComplete(prompt: string, opts: LlmOptions = {}): Promise<LlmResult> {
  if (!llmEnabled()) return { ok: false, text: "", error: "llm disabled" };
  const timeoutMs = opts.timeoutMs ?? 20000;
  const model = opts.model ?? LLM_MODEL;
  try {
    if (LLM_PROVIDER === "ollama") {
      return await withTimeout(async (signal) => {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            model,
            prompt,
            system: opts.system,
            stream: false,
            format: opts.json ? "json" : undefined,
            options: { temperature: 0.2 },
          }),
        });
        if (!res.ok) return { ok: false, text: "", error: `ollama ${res.status}` };
        const json = (await res.json()) as { response?: string };
        return { ok: true, text: String(json.response ?? "") };
      }, timeoutMs);
    }
    if (LLM_PROVIDER === "openai-compat") {
      if (!LLM_BASE_URL) return { ok: false, text: "", error: "LLM_BASE_URL unset" };
      return await withTimeout(async (signal) => {
        const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
          },
          signal,
          body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: opts.json ? { type: "json_object" } : undefined,
            messages: [
              ...(opts.system ? [{ role: "system", content: opts.system }] : []),
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) return { ok: false, text: "", error: `llm ${res.status}` };
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return { ok: true, text: String(json.choices?.[0]?.message?.content ?? "") };
      }, timeoutMs);
    }
    return { ok: false, text: "", error: `unknown LLM_PROVIDER: ${LLM_PROVIDER}` };
  } catch (e) {
    return { ok: false, text: "", error: (e as Error).message };
  }
}

/** Plain-text completion, or "" on any failure (caller falls back). */
export async function llmText(prompt: string, opts: LlmOptions = {}): Promise<string> {
  const r = await llmComplete(prompt, opts);
  return r.ok ? r.text : "";
}

/** Extract the first JSON object/array from a model response. */
function extractJson(text: string): string {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return t;
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const i = t.search(/[[{]/);
  if (i >= 0) return t.slice(i);
  return t;
}

/** Completion that returns parsed JSON, or null on any failure (caller falls back). */
export async function llmJson<T = unknown>(prompt: string, opts: LlmOptions = {}): Promise<T | null> {
  const r = await llmComplete(prompt, { ...opts, json: true });
  if (!r.ok || !r.text) return null;
  try {
    return JSON.parse(extractJson(r.text)) as T;
  } catch {
    return null;
  }
}

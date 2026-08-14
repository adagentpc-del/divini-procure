/**
 * Divini Blueprint - CAD CONVERSION PROVIDER ADAPTER (the pluggable seam,
 * not a working integration - see the honesty note at the bottom).
 *
 * DWG, RVT, and IFC are binary, proprietary formats this codebase cannot
 * read on its own - unlike DXF (dxf-extraction.ts) or PDF/images
 * (text-extraction.ts, ocr.ts), which need no external service at all.
 * This module is the same kind of pluggable seam server/src/lib/llm.ts is
 * for language models: env-var driven, cadConversionEnabled() is false
 * with no configuration, and every caller must already fall back
 * gracefully (Divini Blueprint's filename-only classification for these
 * files, unchanged from before this module existed).
 *
 * Configure ONE of the following:
 *
 *   CAD_CONVERSION_PROVIDER=autodesk_aps
 *     Autodesk Platform Services (formerly Forge), Model Derivative API.
 *     Commercial, NOT open source - but the only realistic option for
 *     full-fidelity RVT (Revit) conversion; there is no viable open-source
 *     RVT reader. Also handles DWG, IFC, and most other CAD/BIM formats.
 *     Requires: APS_CLIENT_ID, APS_CLIENT_SECRET
 *     https://aps.autodesk.com
 *
 *   CAD_CONVERSION_PROVIDER=oda_file_converter
 *     ODA File Converter (Open Design Alliance) - free to use but
 *     proprietary (NOT open source), self-hosted as a subprocess/sidecar
 *     service you run and put an HTTP wrapper in front of (this codebase
 *     does not ship one). Handles DWG<->DXF version conversion and
 *     DWG/DXF -> PDF. Does not handle RVT or IFC.
 *     Requires: CAD_CONVERTER_URL
 *     https://www.opendesign.com/guestfiles/oda_file_converter
 *
 *   CAD_CONVERSION_PROVIDER=libredwg_service
 *     LibreDWG (GNU project, genuinely open source, GPL-3.0) - reads DWG
 *     and converts to DXF, which dxf-extraction.ts can then read for real
 *     content. Weaker fidelity than the commercial options and does not
 *     handle RVT or IFC. Self-hosted as a subprocess/sidecar service, same
 *     as ODA above - this codebase does not ship that sidecar either.
 *     Requires: CAD_CONVERTER_URL
 *     https://www.gnu.org/software/libredwg/
 *
 * With none of these set (the default), cadConversionEnabled() is false and
 * every CAD file keeps falling back to filename-only classification -
 * exactly today's behavior.
 *
 * HONESTY NOTE: convertCadFile() below is the CONTRACT, not a working
 * client. None of the three providers has a real HTTP/OAuth implementation
 * yet - that needs real credentials to build against and test (Autodesk
 * APS's OAuth + Model Derivative job-polling flow in particular is
 * non-trivial to get right blind). Once the corresponding environment
 * variables are actually available, implementing the chosen provider here
 * is the next step; this module exists so every caller already has the
 * right shape to call into, and degrades safely regardless.
 *
 * Zero em dashes by convention.
 */

export type CadConversionProvider = "autodesk_aps" | "oda_file_converter" | "libredwg_service" | "";

export const CAD_CONVERSION_PROVIDER = (process.env.CAD_CONVERSION_PROVIDER || "").toLowerCase() as CadConversionProvider;
const APS_CLIENT_ID = process.env.APS_CLIENT_ID || "";
const APS_CLIENT_SECRET = process.env.APS_CLIENT_SECRET || "";
const CAD_CONVERTER_URL = (process.env.CAD_CONVERTER_URL || "").replace(/\/$/, "");

/** True only when the configured provider has its required variables set. Default (no configuration) is false. */
export function cadConversionEnabled(): boolean {
  if (CAD_CONVERSION_PROVIDER === "autodesk_aps") return Boolean(APS_CLIENT_ID && APS_CLIENT_SECRET);
  if (CAD_CONVERSION_PROVIDER === "oda_file_converter") return Boolean(CAD_CONVERTER_URL);
  if (CAD_CONVERSION_PROVIDER === "libredwg_service") return Boolean(CAD_CONVERTER_URL);
  return false;
}

export interface CadConversionResult {
  ok: boolean;
  /** A PDF or DXF buffer produced from the source CAD file, when the provider supports the target format. */
  outputBuffer?: Buffer;
  outputFormat?: "pdf" | "dxf";
  error?: string;
}

/**
 * Converts a CAD file buffer to a viewable/parseable format (PDF or DXF).
 * Returns ok:false when disabled or on any failure - callers MUST already
 * have a fallback (filename-only classification) and must never treat this
 * as a hard dependency, exactly like llmJson()/sendEmail() elsewhere in
 * this codebase.
 */
export async function convertCadFile(_buffer: Buffer, _sourceExtension: string): Promise<CadConversionResult> {
  if (!cadConversionEnabled()) {
    return { ok: false, error: "CAD conversion is not configured - set CAD_CONVERSION_PROVIDER and its required variables" };
  }
  return {
    ok: false,
    error: `CAD_CONVERSION_PROVIDER=${CAD_CONVERSION_PROVIDER} is configured but has no working client implemented yet in this codebase`,
  };
}

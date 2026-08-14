/**
 * Divini Blueprint - OCR via `tesseract.js` (Apache 2.0,
 * https://github.com/naptha/tesseract.js), which wraps the open-source
 * Tesseract OCR engine (Apache 2.0,
 * https://github.com/tesseract-ocr/tesseract) compiled to WASM. Runs
 * entirely in this Node process - no external OCR service, no API key.
 *
 * RUNTIME NOTE: on first use, tesseract.js needs to fetch its WASM core and
 * language training data. By default it pulls these from tesseract.js's
 * own CDN over the network; for an air-gapped or self-hosted deployment,
 * set TESSERACT_LANG_PATH / TESSERACT_CORE_PATH / TESSERACT_CACHE_PATH to
 * a local directory containing the same files (see
 * https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
 * and this module picks them up automatically - no code change required.
 * With none of those set, this still works out of the box as long as the
 * server can reach the internet the first time OCR runs.
 *
 * Zero em dashes by convention.
 */
import Tesseract from "tesseract.js";

export interface OcrResult {
  text: string;
  confidence: number;
}

function workerOptions(): Partial<Tesseract.WorkerOptions> {
  const opts: Partial<Tesseract.WorkerOptions> = {};
  if (process.env.TESSERACT_LANG_PATH) opts.langPath = process.env.TESSERACT_LANG_PATH;
  if (process.env.TESSERACT_CORE_PATH) opts.corePath = process.env.TESSERACT_CORE_PATH;
  if (process.env.TESSERACT_CACHE_PATH) opts.cachePath = process.env.TESSERACT_CACHE_PATH;
  return opts;
}

const MAX_OCR_CHARS = 20000;
// Tesseract's own per-word confidence average, 0-100. Below this, the
// result is unreliable enough that callers should treat it as "could not
// read" rather than present low-quality noise as a classification signal.
const MIN_USABLE_CONFIDENCE = 40;

/** OCRs an image buffer (PNG/JPEG/etc). Null on failure or when Tesseract's own confidence is too low to trust. */
export async function ocrImage(buffer: Buffer, lang = "eng"): Promise<OcrResult | null> {
  try {
    const result = await Tesseract.recognize(buffer, lang, workerOptions());
    const text = (result.data.text || "").trim();
    const confidence = result.data.confidence ?? 0;
    if (!text || confidence < MIN_USABLE_CONFIDENCE) return null;
    return { text: text.slice(0, MAX_OCR_CHARS), confidence };
  } catch {
    return null;
  }
}

/**
 * Divini Blueprint - REAL PDF content extraction, using `pdf-parse` (Apache
 * 2.0, https://github.com/mehmet-kozan/pdf-parse). This is a genuine
 * upgrade over the rest of Divini Blueprint: everywhere else in this
 * module, classification is filename/extension only because no
 * content-reading library existed. For PDFs, that is no longer true - this
 * module actually opens the file and reads its text layer.
 *
 * A PDF's text layer only exists if it was authored digitally (exported
 * from CAD/drawing software, Word, etc). A SCANNED PDF (a photograph or
 * scan of paper) has no text layer at all - extractPdfText() correctly
 * returns null for those, and the caller falls back to OCR
 * (server/src/lib/ocr.ts) on a rendered page image instead of reporting a
 * false success with empty/garbage text.
 *
 * No network calls for buffer-based parsing - this runs entirely on the
 * bytes already in hand. No environment variable required.
 *
 * Zero em dashes by convention.
 */
import { PDFParse } from "pdf-parse";

const MAX_EXTRACTED_CHARS = 20000;
// Below this many non-whitespace characters, treat a PDF as having no real
// text layer (a title block's stray text, embedded metadata, etc, is not
// "the document was digitally authored with real content").
const MIN_TEXT_LAYER_CHARS = 20;

export interface PdfTextResult {
  text: string;
  pageCount: number;
  truncated: boolean;
}

/** Extracts a PDF's text layer. Null if there is effectively no text layer (a scanned PDF) or the file fails to parse - callers must fall back to OCR rather than treat null as an error to surface. */
export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = (result.text || "").replace(/\s+/g, " ").trim();
    if (text.length < MIN_TEXT_LAYER_CHARS) return null;
    return {
      text: text.slice(0, MAX_EXTRACTED_CHARS),
      pageCount: result.total ?? result.pages?.length ?? 0,
      truncated: text.length > MAX_EXTRACTED_CHARS,
    };
  } catch {
    return null;
  } finally {
    await parser?.destroy().catch(() => {});
  }
}

/** Renders one PDF page to a PNG buffer, for OCR fallback on a scanned/image-only PDF. Null on any failure or an out-of-range page number. */
export async function renderPdfPageToPng(buffer: Buffer, pageNumber: number): Promise<Buffer | null> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getScreenshot({ partial: [pageNumber], scale: 2 });
    const page = result.pages?.[0];
    return page ? Buffer.from(page.data) : null;
  } catch {
    return null;
  } finally {
    await parser?.destroy().catch(() => {});
  }
}

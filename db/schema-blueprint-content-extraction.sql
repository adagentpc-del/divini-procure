-- ============================================================================
-- Divini Procure - DIVINI BLUEPRINT: real content extraction
-- ----------------------------------------------------------------------------
-- Adds storage for text actually read from a document - a PDF's real text
-- layer (server/src/lib/text-extraction.ts, pdf-parse), an OCR result on a
-- scanned page or image (server/src/lib/ocr.ts, tesseract.js), or a DXF's
-- real TEXT/MTEXT entities and layer names (server/src/lib/dxf-extraction.ts,
-- dxf-parser). This is a genuine capability upgrade over the rest of this
-- codebase's filename-only classification, for the file types that can
-- actually be parsed with no external service or API key.
--
-- extraction_method distinguishes HOW the text was obtained, since a PDF
-- text layer is much more reliable than OCR on a scan, which is more
-- reliable than nothing at all. Binary CAD formats (DWG, RVT, IFC) have no
-- extraction path yet and stay 'none' until a real conversion service is
-- configured (see server/src/lib/cad-conversion.ts).
--
-- Idempotent: safe to re-run. Zero em dashes by convention.
-- ============================================================================

alter table if exists documents add column if not exists extracted_text text;
alter table if exists documents add column if not exists extraction_method text not null default 'none'
  check (extraction_method in ('pdf_text_layer', 'ocr', 'dxf_entities', 'none', 'failed'));
alter table if exists documents add column if not exists extraction_error text;
alter table if exists documents add column if not exists extracted_at timestamptz;

create index if not exists idx_documents_extraction_method on documents (extraction_method);

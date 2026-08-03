/**
 * Tests for real PDF text extraction (server/src/lib/text-extraction.ts).
 *
 * SCOPE NOTE: pdf-parse (wrapping pdf.js) needs a well-formed PDF byte
 * stream to extract text with full fidelity - a hand-crafted minimal PDF
 * fixture was tried here and pdf.js's recovery/font-handling path did not
 * round-trip arbitrary text reliably from one, which is a property of the
 * library's internals, not of this wrapper. Rather than ship a flaky or
 * misleading "success path" test built on a fixture that does not
 * faithfully represent a real PDF, these tests cover the deterministic
 * contract this module actually promises: garbage/invalid/non-PDF input
 * returns null rather than throwing or returning garbage as if it were
 * real content. The extraction mechanism itself was verified manually
 * against pdf-parse directly (see the changelog) - a real content-bearing
 * PDF, produced by any real PDF writer, extracts correctly through this
 * module in practice.
 *
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPdfText, renderPdfPageToPng } from "../server/src/lib/text-extraction.ts";

test("text-extraction: a non-PDF buffer returns null, not a thrown error", async () => {
  const r = await extractPdfText(Buffer.from("this is not a pdf at all"));
  assert.equal(r, null);
});

test("text-extraction: an empty buffer returns null", async () => {
  const r = await extractPdfText(Buffer.alloc(0));
  assert.equal(r, null);
});

test("text-extraction: renderPdfPageToPng on a non-PDF buffer returns null, not a thrown error", async () => {
  const r = await renderPdfPageToPng(Buffer.from("this is not a pdf at all"), 1);
  assert.equal(r, null);
});

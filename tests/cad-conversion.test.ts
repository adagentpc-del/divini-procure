/**
 * Tests for the CAD conversion provider adapter
 * (server/src/lib/cad-conversion.ts). This is a contract/seam, not a
 * working integration yet - these tests only verify the graceful-
 * degradation contract, not any real conversion.
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cadConversionEnabled, convertCadFile } from "../server/src/lib/cad-conversion.ts";

test("cad-conversion: disabled by default with no environment configuration", () => {
  assert.equal(cadConversionEnabled(), false);
});

test("cad-conversion: convertCadFile never throws, and reports ok:false when disabled", async () => {
  const r = await convertCadFile(Buffer.from("fake dwg bytes"), "dwg");
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

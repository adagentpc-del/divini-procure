/**
 * Tests for real DXF content extraction (server/src/lib/dxf-extraction.ts).
 * Uses minimal hand-built DXF fixtures (no network, no binary test files).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDxfInfo } from "../server/src/lib/dxf-extraction.ts";

function dxf(lines: string[]): string {
  return lines.join("\n") + "\n";
}

test("dxf: extracts a TEXT entity's string and layer", () => {
  const r = extractDxfInfo(
    dxf(["0", "SECTION", "2", "ENTITIES", "0", "TEXT", "8", "TITLES", "1", "A1.01 FLOOR PLAN", "0", "ENDSEC", "0", "EOF"]),
  );
  assert.ok(r);
  assert.deepEqual(r!.layers, ["TITLES"]);
  assert.deepEqual(r!.textEntities, ["A1.01 FLOOR PLAN"]);
  assert.equal(r!.entityCount, 1);
});

test("dxf: extracts an MTEXT entity's string too", () => {
  const r = extractDxfInfo(
    dxf(["0", "SECTION", "2", "ENTITIES", "0", "MTEXT", "8", "NOTES", "1", "SEE SHEET S1.01", "0", "ENDSEC", "0", "EOF"]),
  );
  assert.ok(r);
  assert.deepEqual(r!.textEntities, ["SEE SHEET S1.01"]);
});

test("dxf: collects distinct layer names, sorted, across multiple entities", () => {
  const r = extractDxfInfo(
    dxf([
      "0", "SECTION", "2", "ENTITIES",
      "0", "LINE", "8", "WALLS",
      "0", "LINE", "8", "DOORS",
      "0", "LINE", "8", "WALLS",
      "0", "ENDSEC", "0", "EOF",
    ]),
  );
  assert.ok(r);
  assert.deepEqual(r!.layers, ["DOORS", "WALLS"]);
});

test("dxf: non-text entities do not contribute to textEntities", () => {
  const r = extractDxfInfo(dxf(["0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "WALLS", "0", "ENDSEC", "0", "EOF"]));
  assert.ok(r);
  assert.deepEqual(r!.textEntities, []);
});

test("dxf: garbage input returns null instead of throwing", () => {
  assert.equal(extractDxfInfo("this is not a dxf file at all"), null);
});

test("dxf: an empty string returns null", () => {
  assert.equal(extractDxfInfo(""), null);
});

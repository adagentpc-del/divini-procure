/**
 * Divini Blueprint - REAL DXF content extraction, using `dxf-parser` (MIT,
 * https://github.com/gdsestimating/dxf-parser). DXF is CAD's plain-text
 * exchange format, so unlike DWG/RVT/IFC (binary, proprietary, needing a
 * real conversion service - see the CAD conversion adapter) it can
 * genuinely be read without any external service or API key.
 *
 * Extracts layer names and TEXT/MTEXT entity strings - drawing title
 * blocks, sheet numbers, and notes are frequently authored as literal TEXT
 * entities, so this can surface real drawing-index signal (a sheet title
 * like "A1.01 FLOOR PLAN") that the filename-only classifier never could.
 * Still never claims to understand geometry, dimensions, or quantities -
 * only the text and layer names actually present in the file.
 *
 * Local minimal typing instead of the package's own .d.ts: dxf-parser
 * ships a `types` field pointing at an ESM-shaped index.d.ts but a `main`
 * field pointing at a UMD bundle with a plain default export, and under
 * this project's `moduleResolution: NodeNext` the two disagree enough that
 * TypeScript cannot see the default import as constructable even though it
 * is at runtime (verified directly with node). Rather than fight that
 * mismatch with a suppression comment, this declares only the small shape
 * actually used here.
 *
 * Zero em dashes by convention.
 */
import DxfParserImport from "dxf-parser";

interface RawEntity {
  type: string;
  layer?: string;
  text?: string;
}
interface RawParsed {
  entities?: RawEntity[];
  blocks?: Record<string, unknown>;
}
interface DxfParserLike {
  parseSync(source: string): RawParsed | null;
}
const DxfParserCtor = DxfParserImport as unknown as new () => DxfParserLike;

export interface DxfExtractionResult {
  layers: string[];
  textEntities: string[];
  entityCount: number;
  blockCount: number;
}

const MAX_TEXT_ENTITIES = 200;

/** Parses DXF source text (already decoded to a string). Null on any parse failure or malformed input. */
export function extractDxfInfo(source: string): DxfExtractionResult | null {
  try {
    const parsed = new DxfParserCtor().parseSync(source);
    if (!parsed) return null;

    const layers = new Set<string>();
    const textEntities: string[] = [];
    for (const entity of parsed.entities ?? []) {
      if (entity.layer) layers.add(entity.layer);
      if ((entity.type === "TEXT" || entity.type === "MTEXT") && textEntities.length < MAX_TEXT_ENTITIES) {
        const text = entity.text?.trim();
        if (text) textEntities.push(text);
      }
    }
    return {
      layers: [...layers].sort(),
      textEntities,
      entityCount: parsed.entities?.length ?? 0,
      blockCount: Object.keys(parsed.blocks ?? {}).length,
    };
  } catch {
    return null;
  }
}

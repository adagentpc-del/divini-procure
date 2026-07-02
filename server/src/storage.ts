/**
 * File storage for Divini Procure.
 *
 * Read / write now flow through a pluggable object storage provider abstraction
 * (lib/objectStorage.ts): provider "local" (default) keeps the original local-
 * disk behavior exactly; provider "s3" targets any S3-compatible store (AWS S3,
 * Cloudflare R2, Backblaze B2, MinIO) via AWS Signature V4. Envelope encryption
 * (lib/storageCrypto.ts) is applied transparently in that layer for BOTH
 * providers when STORAGE_ENCRYPTION_KEY is set; with no key, bytes are stored
 * as plaintext, identical to today.
 *
 * Layout mirrors the old Supabase path convention exactly:
 *   <FILE_STORAGE_DIR>/<companyId>/<packageId|buildingId|misc>/<ts>-<name>
 *
 * Uploads (multer memory) are stored via the provider; metadata goes in the
 * `documents` table (db.insertDocument). Downloads use a short-lived HMAC-signed
 * token so the SPA's old `createSignedUrl(path, 3600)` call has a direct
 * equivalent: `signDownloadUrl(path)` returns
 * `/api/documents/download?path=..&exp=..&sig=..`.
 *
 * The public function surface and the signed-URL behavior are unchanged. The
 * synchronous helpers (writeFile / readPath / fileExists) preserve the local-
 * disk contract their existing call sites depend on; the async putObject /
 * getObject / deleteObject helpers expose the full pluggable + encrypted path
 * (and work with both providers).
 *
 * Zero em dashes by convention.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  FILE_STORAGE_DIR,
  getDownloadUrlSecret,
  BASE_PATH,
} from "./config.js";
import {
  safeRelKey,
  putObject as providerPut,
  getObject as providerGet,
  deleteObject as providerDelete,
} from "./lib/objectStorage.js";
import { encryptBytes, decryptBytes } from "./lib/storageCrypto.js";

const SIGNED_TTL_SECONDS = 3600;

function absFor(relKey: string): string {
  return path.join(FILE_STORAGE_DIR, safeRelKey(relKey));
}

/** Build the storage key for a new upload (same shape as the old Supabase path). */
export function buildStorageKey(opts: {
  companyId: string;
  packageId?: string | null;
  buildingId?: string | null;
  fileName: string;
}): string {
  const bucket = opts.packageId ?? opts.buildingId ?? "misc";
  const safeName = opts.fileName.replace(/[^\w.\- ]+/g, "_");
  return `${opts.companyId}/${bucket}/${Date.now()}-${safeName}`;
}

// --- synchronous local-disk helpers (existing call sites) -------------------
// These preserve the local-disk contract: writeFile persists bytes to disk and
// readPath returns an absolute path callers stream/read directly. They honor
// encryption-at-rest by writing/reading via the crypto envelope so the on-disk
// bytes match what the provider layer produces.

/** Write file bytes to disk under the given storage key (local provider). */
export function writeFile(relKey: string, data: Buffer): void {
  const abs = absFor(relKey);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, encryptBytes(data));
}

export function fileExists(relKey: string): boolean {
  try {
    return fs.statSync(absFor(relKey)).isFile();
  } catch {
    return false;
  }
}

/** Absolute path for a stored object (local provider). */
export function readPath(relKey: string): string {
  return absFor(relKey);
}

/**
 * Read and decrypt the bytes for a stored object from local disk. Prefer this
 * over readPath + fs.readFileSync when encryption may be enabled, since it
 * applies the crypto envelope; with no key set it returns the raw bytes.
 */
export function readFileBytes(relKey: string): Buffer {
  return decryptBytes(fs.readFileSync(absFor(relKey)));
}

// --- async provider helpers (pluggable: local or s3) ------------------------
// These route through lib/objectStorage.ts so they work with whichever provider
// STORAGE_PROVIDER selects, with encryption applied transparently.

/** Store bytes for a key through the active provider (encrypts when enabled). */
export async function putObject(
  relKey: string,
  data: Buffer,
  contentType?: string,
): Promise<void> {
  return providerPut(relKey, data, contentType);
}

/** Fetch and decrypt bytes for a key through the active provider. */
export async function getObject(relKey: string): Promise<Buffer> {
  return providerGet(relKey);
}

/** Delete an object for a key through the active provider. */
export async function deleteObject(relKey: string): Promise<void> {
  return providerDelete(relKey);
}

// --- short-lived signed download URLs ---------------------------------------

function sign(key: string, exp: number): string {
  return crypto
    .createHmac("sha256", getDownloadUrlSecret())
    .update(`${key}|${exp}`)
    .digest("hex");
}

/** Equivalent of Supabase createSignedUrl(path, 3600). Returns a relative URL. */
export function signDownloadUrl(relKey: string, ttlSeconds = SIGNED_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(relKey, exp);
  const qs = new URLSearchParams({ path: relKey, exp: String(exp), sig });
  return `${BASE_PATH}/api/documents/download?${qs.toString()}`;
}

/** Verify a signed download request. Returns the path when valid, else null. */
export function verifyDownloadUrl(relKey: string, exp: string, sig: string): string | null {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return null;
  const expected = sign(relKey, expNum);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return safeRelKey(relKey);
}

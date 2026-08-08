/**
 * Always-on AES-256-GCM encryption for individual sensitive text columns
 * (bank account/routing numbers, IBANs) - distinct from storageCrypto.ts,
 * which is opt-in and encrypts whole uploaded files under
 * STORAGE_ENCRYPTION_KEY. Banking PII is sensitive enough, and the blast
 * radius of a Postgres dump/backup leak severe enough (ACH/wire fraud), that
 * this is not made opt-in behind a separate env var a deploy could forget to
 * set - it is unconditional.
 *
 * No new required secret either: the key is derived via HKDF-SHA256 from the
 * existing mandatory-in-production SESSION_SECRET, the same pattern already
 * used for DOWNLOAD_URL_SECRET (config.ts getDownloadUrlSecret) - a fixed
 * "info" string gives this derived key domain separation from the session-
 * signing use of the same root secret, so this is not "reusing a signing key
 * as an encryption key," it is a standard HKDF subkey.
 *
 * Stored format (base64 of): magic(4) "DPF1" | iv(12) | tag(16) | ciphertext.
 * A value without the magic header is treated as legacy plaintext and
 * returned as-is by decryptField, so existing unencrypted rows keep reading
 * correctly after this is introduced (no backfill migration required to
 * deploy safely; run one when convenient to finish protecting old rows).
 *
 * Deliberately dependency-free (no import from config.ts): every other pure
 * lib module in this repo (bidCredits.ts, feeMath.ts, marketplace-
 * validation.ts) keeps this same no-DB/no-config boundary so it can run
 * under the test runner's `node --experimental-strip-types` mode, which
 * cannot resolve config.ts's own further imports. The one-line duplication
 * of the dev-fallback string is the tradeoff for that; production's fail-
 * closed enforcement of a real SESSION_SECRET already happens in config.ts's
 * getSessionSecret() and applies here too, since it is the same env var.
 *
 * node:crypto only. Zero em dashes by convention.
 */
import crypto from "node:crypto";

const SESSION_SECRET_DEV_FALLBACK = "dev-only-session-secret-change-me";
const MAGIC = Buffer.from("DPF1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;
const HKDF_INFO = "divini-procure:field-encryption:v1";

let cachedKey: Buffer | null = null;

function fieldKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET || SESSION_SECRET_DEV_FALLBACK;
  const derived = crypto.hkdfSync("sha256", secret, "", HKDF_INFO, 32);
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

/** Encrypt a plaintext string for storage. Returns base64. Empty/null pass through unchanged. */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return plaintext ?? null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", fieldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a value written by encryptField. Legacy plaintext (no header) is returned unchanged. */
export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  let buf: Buffer;
  try {
    buf = Buffer.from(stored, "base64");
  } catch {
    return stored;
  }
  if (buf.length < MAGIC.length + IV_LEN + TAG_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    return stored; // legacy plaintext row, not our format
  }
  let off = MAGIC.length;
  const iv = buf.subarray(off, off + IV_LEN);
  off += IV_LEN;
  const tag = buf.subarray(off, off + TAG_LEN);
  off += TAG_LEN;
  const ciphertext = buf.subarray(off);
  const decipher = crypto.createDecipheriv("aes-256-gcm", fieldKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

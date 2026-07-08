/**
 * Optional AES-256-GCM envelope encryption for the object storage layer.
 *
 * When STORAGE_ENCRYPTION_KEY is set (base64 of exactly 32 bytes), bytes are
 * encrypted before they are stored and decrypted on read. The on-disk / in-
 * bucket format is:
 *
 *   magic(4) | version(1) | iv(12) | tag(16) | ciphertext(...)
 *
 *   magic   = ASCII "DPE1" (Divini Procure Encryption, format 1) so a stored
 *             blob can be recognized as encrypted without external metadata.
 *   version = 1
 *   iv      = 12 random bytes (GCM nonce)
 *   tag     = 16 byte GCM auth tag
 *
 * When the key is unset, encryptBytes / decryptBytes are pass-through: stored
 * bytes are plaintext, identical to today. Applies to BOTH storage providers.
 *
 * node:crypto only. Zero em dashes by convention.
 *
 * WARNING: losing STORAGE_ENCRYPTION_KEY makes every encrypted object
 * permanently unrecoverable. Treat it like a database master credential.
 */
import crypto from "node:crypto";
import { getStorageEncryptionKey, storageEncryptionEnabled } from "../config.js";

const MAGIC = Buffer.from("DPE1", "ascii"); // 4 bytes
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + IV_LEN + TAG_LEN;

/** Returns true when the blob carries the encryption magic header. */
export function isEncrypted(data: Buffer): boolean {
  return data.length >= HEADER_LEN && data.subarray(0, MAGIC.length).equals(MAGIC);
}

/**
 * Encrypt bytes when a key is configured, else return them unchanged. The
 * returned buffer is self-describing (magic header) so reads can detect format.
 */
export function encryptBytes(plaintext: Buffer): Buffer {
  if (!storageEncryptionEnabled()) return plaintext;
  const key = getStorageEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext]);
}

/**
 * Decrypt bytes that carry the encryption header. Plaintext (no header) is
 * returned unchanged so the system keeps reading legacy unencrypted objects
 * even after a key is introduced. If a blob IS encrypted but no key is set, we
 * throw rather than return ciphertext.
 */
export function decryptBytes(stored: Buffer): Buffer {
  if (!isEncrypted(stored)) return stored;
  if (!storageEncryptionEnabled()) {
    throw new Error(
      "[storageCrypto] object is encrypted but STORAGE_ENCRYPTION_KEY is not set",
    );
  }
  const key = getStorageEncryptionKey();
  let off = MAGIC.length;
  const version = stored[off];
  off += 1;
  if (version !== VERSION) {
    throw new Error(`[storageCrypto] unsupported encryption version ${version}`);
  }
  const iv = stored.subarray(off, off + IV_LEN);
  off += IV_LEN;
  const tag = stored.subarray(off, off + TAG_LEN);
  off += TAG_LEN;
  const ciphertext = stored.subarray(off);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

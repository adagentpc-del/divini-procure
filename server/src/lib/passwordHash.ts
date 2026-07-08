/**
 * Divini Procure - PURE PASSWORD HASHING (node:crypto only).
 *
 * scrypt-based password hashing and verification, extracted so it can be unit
 * tested in isolation without pulling in jose or app config. The only import is
 * Node's built-in crypto. native-auth.ts re-exports these so its public API is
 * unchanged.
 *
 * Format: `scrypt$<saltHex>$<hashHex>` (16-byte random salt, 64-byte key).
 * Verification uses timingSafeEqual. Plaintext is never stored or logged.
 *
 * Zero em dashes by convention.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a plaintext password into `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(plain, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verify a plaintext password against a stored `scrypt$salt$hash` string. */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  const derived = (await scrypt(plain, salt, KEYLEN)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

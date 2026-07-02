/**
 * Tests for the pure password hashing helpers (server/src/lib/passwordHash.ts).
 *
 * node:crypto scrypt only, no DB or config. Verifies that the right password
 * matches, a wrong one does not, two hashes of the same password differ (random
 * salt), and malformed/absent stored hashes are rejected rather than thrown.
 *
 * Run via the package "test" script (Node built-in test runner, strip-types).
 * Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/src/lib/passwordHash.ts";

test("hashPassword produces the scrypt$salt$hash format", async () => {
  const hash = await hashPassword("correct horse battery staple");
  const parts = hash.split("$");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "scrypt");
  // 16-byte salt = 32 hex chars, 64-byte key = 128 hex chars.
  assert.equal(parts[1].length, 32);
  assert.equal(parts[2].length, 128);
});

test("verifyPassword returns true for the correct password", async () => {
  const hash = await hashPassword("s3cr3t-pass");
  assert.equal(await verifyPassword("s3cr3t-pass", hash), true);
});

test("verifyPassword returns false for a wrong password", async () => {
  const hash = await hashPassword("s3cr3t-pass");
  assert.equal(await verifyPassword("wrong-pass", hash), false);
});

test("two hashes of the same password differ (random salt)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  // ...yet both verify against the original password.
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});

test("verifyPassword rejects null/undefined/empty stored hash without throwing", async () => {
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("anything", undefined), false);
  assert.equal(await verifyPassword("anything", ""), false);
});

test("verifyPassword rejects malformed stored hashes", async () => {
  assert.equal(await verifyPassword("x", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$onlytwo"), false);
  assert.equal(await verifyPassword("x", "bcrypt$abcd$ef01"), false);
  // Wrong-length hash segment (valid hex but not 64 bytes).
  assert.equal(await verifyPassword("x", "scrypt$00$00"), false);
});

test("verifyPassword is case-sensitive on the password", async () => {
  const hash = await hashPassword("CaseSensitive");
  assert.equal(await verifyPassword("casesensitive", hash), false);
  assert.equal(await verifyPassword("CaseSensitive", hash), true);
});

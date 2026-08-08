/**
 * Tests for always-on field-level encryption (server/src/lib/fieldCrypto.ts).
 * No DB, no config.ts import (module is deliberately dependency-free - see
 * its own header comment). Zero em dashes by convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptField, decryptField } from "../server/src/lib/fieldCrypto.ts";

test("fieldCrypto: round-trips a plaintext value", () => {
  const enc = encryptField("000123456789");
  assert.notEqual(enc, "000123456789");
  assert.equal(decryptField(enc), "000123456789");
});

test("fieldCrypto: null and empty string pass through both directions unchanged", () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(undefined), null);
  assert.equal(encryptField(""), "");
  assert.equal(decryptField(null), null);
  assert.equal(decryptField(""), "");
});

test("fieldCrypto: two encryptions of the same value produce different ciphertext (random IV)", () => {
  const a = encryptField("routing-9999999999");
  const b = encryptField("routing-9999999999");
  assert.notEqual(a, b);
  assert.equal(decryptField(a), "routing-9999999999");
  assert.equal(decryptField(b), "routing-9999999999");
});

test("fieldCrypto: legacy plaintext (no magic header, no prior encryption) reads back unchanged", () => {
  // Simulates a row written before this feature existed.
  assert.equal(decryptField("123456789"), "123456789");
  assert.equal(decryptField("GB29NWBK60161331926819"), "GB29NWBK60161331926819");
});

test("fieldCrypto: tampered ciphertext fails to decrypt rather than returning wrong data", () => {
  const enc = encryptField("do-not-leak-me")!;
  const bytes = Buffer.from(enc, "base64");
  bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext/tag
  const tampered = bytes.toString("base64");
  assert.throws(() => decryptField(tampered));
});

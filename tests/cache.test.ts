import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache, hashInput } from "../server/src/lib/cache.ts";

test("TtlCache: a miss returns undefined", () => {
  const c = new TtlCache<string>();
  assert.equal(c.get("nope"), undefined);
});

test("TtlCache: set then get returns the value before expiry", () => {
  const c = new TtlCache<string>();
  c.set("k", "v", 10_000);
  assert.equal(c.get("k"), "v");
});

test("TtlCache: an expired entry is treated as a miss and removed", async () => {
  const c = new TtlCache<string>();
  c.set("k", "v", 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(c.get("k"), undefined);
});

test("TtlCache: delete removes an entry immediately", () => {
  const c = new TtlCache<string>();
  c.set("k", "v", 10_000);
  c.delete("k");
  assert.equal(c.get("k"), undefined);
});

test("TtlCache: getOrCompute only calls compute() once for a hit, not on every call", async () => {
  const c = new TtlCache<number>();
  let calls = 0;
  const compute = async () => { calls++; return 42; };
  const a = await c.getOrCompute("k", 10_000, compute);
  const b = await c.getOrCompute("k", 10_000, compute);
  assert.equal(a, 42);
  assert.equal(b, 42);
  assert.equal(calls, 1, "compute() must not run again on a cache hit");
});

test("TtlCache: getOrCompute recomputes after expiry", async () => {
  const c = new TtlCache<number>();
  let calls = 0;
  const compute = async () => { calls++; return calls; };
  const a = await c.getOrCompute("k", 1, compute);
  await new Promise((r) => setTimeout(r, 15));
  const b = await c.getOrCompute("k", 1, compute);
  assert.equal(a, 1);
  assert.equal(b, 2);
  assert.equal(calls, 2);
});

test("TtlCache: a rejected compute() is never cached, so the next call retries for real", async () => {
  const c = new TtlCache<number>();
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error("transient failure");
    return 99;
  };
  await assert.rejects(() => c.getOrCompute("k", 10_000, flaky));
  const result = await c.getOrCompute("k", 10_000, flaky);
  assert.equal(result, 99);
  assert.equal(calls, 2, "a failed compute() must not poison the cache for the TTL window");
});

test("TtlCache: distinct keys never collide", () => {
  const c = new TtlCache<string>();
  c.set("a", "1", 10_000);
  c.set("b", "2", 10_000);
  assert.equal(c.get("a"), "1");
  assert.equal(c.get("b"), "2");
});

test("hashInput: identical input produces the identical hash", () => {
  const input = { a: 1, b: [1, 2, 3], c: "text" };
  assert.equal(hashInput(input), hashInput({ a: 1, b: [1, 2, 3], c: "text" }));
});

test("hashInput: any change to the input changes the hash", () => {
  const base = { price: 1000, days: 10 };
  const changed = { price: 1001, days: 10 };
  assert.notEqual(hashInput(base), hashInput(changed));
});

test("hashInput: is a short, stable string safe to use as part of a cache key", () => {
  const h = hashInput({ x: 1 });
  assert.equal(typeof h, "string");
  assert.ok(h.length > 0 && h.length <= 24);
  assert.equal(h, hashInput({ x: 1 }));
});

/**
 * Regression coverage for the P0 fix to POST /agreements/:id/sign (Phase 0,
 * item 2 of the implementation spec): the endpoint used to accept a sign
 * request from ANY authenticated user with no check that they were actually
 * a party to (or the counterparty on) the agreement, and trusted a
 * client-supplied signerEmail/signerCompanyId for the persisted signature.
 *
 * Exercises the real route/authorization/database boundary, not a mocked
 * handler - see tests/integration/helpers for the harness.
 *
 * Users are registered ONCE in before() and reused across test cases (each
 * test creates its own fresh agreement) rather than one register+login per
 * test, so this suite stays comfortably under the real, unmodified login
 * rate limiter (5 attempts/IP/15min) that all these requests share since
 * they come from the same loopback client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let owner: { client: TestClient; email: string };
let ownerCompanyId: string;
let attacker: { client: TestClient; email: string };
let counterparty: { client: TestClient; email: string };

test.before(async () => {
  server = await startTestServer();
  owner = await registerVerifiedUser(server.baseUrl, "sign-owner");
  const company = await createCompany(owner.client, "buyer", "Owner Co");
  ownerCompanyId = company.id;
  attacker = await registerVerifiedUser(server.baseUrl, "sign-attacker");
  counterparty = await registerVerifiedUser(server.baseUrl, "sign-counterparty");
});

test.after(async () => {
  await server.close();
});

async function makeSentAgreement(counterpartyEmail: string) {
  const create = await owner.client.post("/api/agreements", {
    partyCompanyId: ownerCompanyId,
    title: "Integration Test Agreement",
    body: "Terms of the test agreement.",
    counterpartyEmail,
  });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const agreementId = create.body.agreement.id as string;

  const send = await owner.client.post(`/api/agreements/${agreementId}/send`, {});
  assert.equal(send.status, 200, JSON.stringify(send.body));
  assert.equal(send.body.agreement.status, "sent");

  return agreementId;
}

test("agreement sign: an unrelated authenticated user cannot sign someone else's agreement", async () => {
  const agreementId = await makeSentAgreement("nobody-in-particular@example.test");

  const attempt = await attacker.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Attacker",
    signatureText: "Attacker",
    affirm: true,
  });

  assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
});

test("agreement sign: a party-company member can sign, and identity is derived server-side (not from the request body)", async () => {
  const agreementId = await makeSentAgreement("nobody-in-particular@example.test");

  const sign = await owner.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Owner",
    signatureText: "Owner",
    affirm: true,
    // Attempt to spoof identity - must be ignored, not trusted.
    signerEmail: "spoofed@evil.example",
    signerCompanyId: "00000000-0000-0000-0000-000000000000",
  });

  assert.equal(sign.status, 200, JSON.stringify(sign.body));
  assert.equal(sign.body.agreement.status, "signed");
  assert.equal(sign.body.signature.signer_email, owner.email);
  assert.equal(sign.body.signature.signer_company_id, ownerCompanyId);
});

test("agreement sign: the matched counterparty (by verified session email) can view and sign, even without company membership", async () => {
  const agreementId = await makeSentAgreement(counterparty.email);

  const view = await counterparty.client.get(`/api/agreements/${agreementId}`);
  assert.equal(view.status, 200, JSON.stringify(view.body));

  const sign = await counterparty.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Counterparty",
    signatureText: "Counterparty",
    affirm: true,
  });
  assert.equal(sign.status, 200, JSON.stringify(sign.body));
  assert.equal(sign.body.signature.signer_email, counterparty.email);
  // The counterparty is not a member of party_company_id, so no company should
  // be attributed to their signature.
  assert.equal(sign.body.signature.signer_company_id, null);
});

test("agreement sign: cannot be replayed once already signed, and does not create a second signature row", async () => {
  const agreementId = await makeSentAgreement("nobody-in-particular@example.test");

  const first = await owner.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Owner",
    signatureText: "Owner",
    affirm: true,
  });
  assert.equal(first.status, 200);

  const replay = await owner.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Owner",
    signatureText: "Owner again",
    affirm: true,
  });
  assert.equal(replay.status, 409, JSON.stringify(replay.body));

  const detail = await owner.client.get(`/api/agreements/${agreementId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.signatures.length, 1);
});

test("agreement sign: a draft agreement (never sent) cannot be signed", async () => {
  const create = await owner.client.post("/api/agreements", {
    partyCompanyId: ownerCompanyId,
    title: "Never Sent",
    body: "Terms.",
    counterpartyEmail: "nobody-in-particular@example.test",
  });
  assert.equal(create.status, 200);
  const agreementId = create.body.agreement.id as string;

  const attempt = await owner.client.post(`/api/agreements/${agreementId}/sign`, {
    signerName: "Owner",
    signatureText: "Owner",
    affirm: true,
  });
  assert.equal(attempt.status, 409, JSON.stringify(attempt.body));
});

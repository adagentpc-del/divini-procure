/**
 * Integration-test harness: boots the REAL Express app (server/src/app.ts,
 * same module used in production) in-process against a real Postgres
 * database, on an ephemeral port. Used by tests/integration/**\/*.test.ts to
 * exercise actual route -> authorization -> database boundaries, rather than
 * unit-testing pure functions in isolation.
 *
 * Requires DATABASE_URL to point at a database with the schema already
 * applied (see package.json's "test:integration" script, or run
 * `db/apply-all.sql` twice against a scratch database yourself). Never runs
 * against a database you care about - every test in this directory creates
 * and tears down its own throwaway rows.
 *
 * Imports the COMPILED server (server/dist/app.js), not the raw TypeScript
 * source: server/src's own internal imports use NodeNext ".js" specifiers
 * (e.g. "./auth.js") that only resolve against the compiled output, and
 * testing the actual build is also a closer match to what ships to
 * production than testing source directly. Run `npm run build:server`
 * before this suite (package.json's test:integration script does this).
 *
 * Deliberately does not import server/src/index.ts, so none of the
 * production setInterval background jobs (follow-up processing, marketplace
 * publish sweep, session purge) start during tests.
 */
import type { Server } from "node:http";

export type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set before importing the app in integration tests " +
        "(see package.json's test:integration script).",
    );
  }
  const { default: app } = await import("../../../server/dist/app.js");
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to determine test server port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Minimal fetch-based HTTP client for integration tests: tracks the session
 * cookie across requests (Node's fetch does not implement a cookie jar), and
 * provides small convenience wrappers for the auth/company setup every
 * integration test needs (register, bypass email verification via the same
 * db.ts helper the real verify-link route uses, log in, create a company).
 */

export type ApiResponse<T = any> = {
  status: number;
  body: T;
  headers: Headers;
};

export class TestClient {
  private cookie: string | null = null;
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private captureCookie(res: Response): void {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // Only the name=value pair is needed on the way back out.
      this.cookie = setCookie.split(";")[0];
    }
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.captureCookie(res);
    const text = await res.text();
    let parsed: any = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  delete<T = any>(path: string, body?: unknown) {
    return this.request<T>("DELETE", path, body);
  }

  /** Drop the session cookie, simulating logout / a never-authenticated client. */
  clearSession(): void {
    this.cookie = null;
  }
}

let counter = 0;
/** A fresh, guaranteed-unique test email for this process. */
export function testEmail(label: string): string {
  counter += 1;
  return `it-${label}-${Date.now()}-${counter}@example.test`;
}

const TEST_PASSWORD = "TestPass123!";

/**
 * Registers a new user, bypasses the email-verification-link step via the
 * same db.ts function the real /auth/verify route calls (not a raw SQL
 * shortcut - exercises the real "verified" state transition), then logs in.
 * Returns the authenticated client and the user's id/email.
 */
export async function registerVerifiedUser(
  baseUrl: string,
  label: string,
): Promise<{ client: TestClient; email: string; userId: string }> {
  const db = await import("../../../server/dist/db.js");
  const email = testEmail(label);
  const client = new TestClient(baseUrl);

  const reg = await client.post("/api/auth/register", {
    email,
    password: TEST_PASSWORD,
    passwordConfirm: TEST_PASSWORD,
    agreed: true,
  });
  if (reg.status !== 200) {
    throw new Error(`registration failed for ${email}: ${JSON.stringify(reg.body)}`);
  }

  const user = await db.getUserByEmail(email);
  if (!user) throw new Error(`registered user ${email} not found`);
  await db.markEmailVerified(user.id);

  const login = await client.post("/api/auth/login", { email, password: TEST_PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(login.body)}`);
  }

  return { client, email, userId: user.id };
}

/** Creates a company for the already-authenticated client and returns it. */
export async function createCompany(
  client: TestClient,
  kind: "buyer" | "vendor" | "investor",
  namePrefix: string,
): Promise<{ id: string; kind: string; name: string }> {
  const res = await client.post("/api/companies", {
    name: `${namePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    vendorAgreementAccepted: kind === "vendor" ? true : undefined,
  });
  if ((res.status !== 200 && res.status !== 201) || !res.body) {
    throw new Error(`company creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const company = res.body.company ?? res.body;
  return company;
}

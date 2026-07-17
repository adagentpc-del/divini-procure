/**
 * Central env/config for the Divini Procure backend. Mirrors divinipartner's
 * securityConfig admin-allowlist + OIDC contract, trimmed to what this app uses.
 */

export const PORT = Number(process.env.PORT || 8080);

// FAIL CLOSED in production: the server cannot connect to the database without
// this variable. An empty string would produce confusing connection errors at
// runtime; throwing at startup makes the misconfiguration obvious immediately.
export const DATABASE_URL = (() => {
  const url = process.env.DATABASE_URL || "";
  if (!url && process.env.NODE_ENV === "production") {
    throw new Error(
      "[config] DATABASE_URL must be set in production. Refusing to start.",
    );
  }
  return url;
})();

export const IS_PROD = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// NATIVE auth (replaces Authentik OIDC). The SPA signs in with email/password;
// the backend issues an HS256 session JWT signed with SESSION_SECRET, delivered
// both as an httpOnly cookie and (for convenience) as a Bearer token.
// ---------------------------------------------------------------------------

// Session signing secret. MUST be set in production. In dev we fall back to a
// fixed value (and warn once) so the app still boots, but sessions signed with
// the fallback are obviously not secure: the lead sets SESSION_SECRET in prod.
const SESSION_SECRET_FALLBACK = "dev-only-session-secret-change-me";
let _warnedSessionSecret = false;
export function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET || "";
  // FAIL CLOSED in production: an unset/empty secret, or one left at the known
  // dev fallback, would let anyone forge sessions. Refuse to boot. This guard is
  // prod-only so dev/sandbox still start and typecheck with the fallback.
  if (IS_PROD && (!s || s === SESSION_SECRET_FALLBACK)) {
    throw new Error(
      "[config] SESSION_SECRET must be set to a strong, unique value in production " +
        "(it is unset, empty, or still the dev fallback). Refusing to start.",
    );
  }
  if (s) return s;
  if (!_warnedSessionSecret) {
    _warnedSessionSecret = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[config] SESSION_SECRET is not set. Falling back to a dev-only secret. " +
        "Set SESSION_SECRET in production or all sessions are insecure.",
    );
  }
  return SESSION_SECRET_FALLBACK;
}

// Session cookie name + lifetime (30 days).
export const SESSION_COOKIE = "divini_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Email-verification + password-reset token lifetimes.
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RESET_TTL_MS = 60 * 60 * 1000; // 1h

// Local-disk file storage root (replaces Supabase Storage).
export const FILE_STORAGE_DIR =
  process.env.FILE_STORAGE_DIR || "/data/procure-files";

// Signing secret for short-lived download URLs (HMAC). In dev it falls back to
// SESSION_SECRET or a fixed dev value so the app still boots. In production the
// getter FAILS CLOSED: a missing/empty/dev-fallback secret would let anyone
// forge signed download URLs, so we refuse to start. Lazily evaluated (function,
// not a module-load const) so the throw only fires when actually needed in prod.
const DOWNLOAD_URL_SECRET_FALLBACK = "dev-only-download-secret-change-me";
let _warnedDownloadSecret = false;
export function getDownloadUrlSecret(): string {
  const explicit = process.env.DOWNLOAD_URL_SECRET || "";
  const session = process.env.SESSION_SECRET || "";
  const resolved =
    explicit ||
    (session && session !== SESSION_SECRET_FALLBACK ? session : "");
  if (IS_PROD && (!resolved || resolved === DOWNLOAD_URL_SECRET_FALLBACK)) {
    throw new Error(
      "[config] DOWNLOAD_URL_SECRET must be set to a strong, unique value in " +
        "production (it is unset, empty, or still the dev fallback). " +
        "Refusing to start.",
    );
  }
  if (resolved) return resolved;
  if (!_warnedDownloadSecret) {
    _warnedDownloadSecret = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[config] DOWNLOAD_URL_SECRET is not set. Falling back to a dev-only " +
        "secret. Set DOWNLOAD_URL_SECRET in production or download URLs are " +
        "forgeable.",
    );
  }
  return DOWNLOAD_URL_SECRET_FALLBACK;
}

// ---------------------------------------------------------------------------
// Object storage provider + encryption at rest. Feature-flagged so the DEFAULT
// is identical to today: local disk under FILE_STORAGE_DIR, no encryption.
//
//   STORAGE_PROVIDER=local|s3   (default "local")
//   S3_ENDPOINT      e.g. https://s3.us-east-1.amazonaws.com or an R2/B2/MinIO URL
//   S3_REGION        e.g. us-east-1 (use "auto" for Cloudflare R2)
//   S3_BUCKET        bucket name
//   S3_ACCESS_KEY_ID
//   S3_SECRET_ACCESS_KEY
//   STORAGE_ENCRYPTION_KEY  base64 of exactly 32 bytes; when set, objects are
//                           AES-256-GCM encrypted at rest. Losing it loses files.
// ---------------------------------------------------------------------------

export const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || "local")
  .trim()
  .toLowerCase(); // "local" | "s3"

export const S3_ENDPOINT = (process.env.S3_ENDPOINT || "").trim();
export const S3_REGION = (process.env.S3_REGION || "us-east-1").trim();
export const S3_BUCKET = (process.env.S3_BUCKET || "").trim();
export const S3_ACCESS_KEY_ID = (process.env.S3_ACCESS_KEY_ID || "").trim();
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";

/** True when STORAGE_PROVIDER=s3 and all required S3 settings are present. */
export const s3Configured = (): boolean =>
  STORAGE_PROVIDER === "s3" &&
  !!S3_ENDPOINT &&
  !!S3_BUCKET &&
  !!S3_ACCESS_KEY_ID &&
  !!S3_SECRET_ACCESS_KEY;

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Return the resolved S3 config, throwing if STORAGE_PROVIDER=s3 but a required
 * setting is missing. Only called by the s3 provider, so local-only deploys
 * never hit this guard.
 */
export function getS3Config(): S3Config {
  const missing: string[] = [];
  if (!S3_ENDPOINT) missing.push("S3_ENDPOINT");
  if (!S3_BUCKET) missing.push("S3_BUCKET");
  if (!S3_ACCESS_KEY_ID) missing.push("S3_ACCESS_KEY_ID");
  if (!S3_SECRET_ACCESS_KEY) missing.push("S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(
      `[config] STORAGE_PROVIDER=s3 but missing required env: ${missing.join(", ")}`,
    );
  }
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

// Base64 of exactly 32 bytes. When set, the storage layer encrypts objects at
// rest with AES-256-GCM. Validated lazily (only when actually used) so an
// unset key keeps the app booting with plaintext storage, identical to today.
export const STORAGE_ENCRYPTION_KEY = process.env.STORAGE_ENCRYPTION_KEY || "";

/** True when a storage encryption key is configured. */
export const storageEncryptionEnabled = (): boolean => !!STORAGE_ENCRYPTION_KEY;

/**
 * Decode and validate STORAGE_ENCRYPTION_KEY into a 32 byte Buffer. Throws a
 * clear error if the key is absent or not 32 bytes once decoded. Callers gate
 * on storageEncryptionEnabled() first, so this only throws on a misconfigured
 * (set-but-invalid) key.
 */
export function getStorageEncryptionKey(): Buffer {
  if (!STORAGE_ENCRYPTION_KEY) {
    throw new Error("[config] STORAGE_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(STORAGE_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `[config] STORAGE_ENCRYPTION_KEY must be base64 of exactly 32 bytes ` +
        `(got ${key.length} bytes after decode)`,
    );
  }
  return key;
}

export const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
export const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/$/, "") || "";
// IS_PROD is declared near the top of this file (before the secret getters that
// depend on it). It is intentionally not re-declared here.

export function getAdminAllowedEmails(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedOrigins(): string[] {
  const out = new Set<string>(
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (PUBLIC_APP_URL) out.add(PUBLIC_APP_URL);
  return [...out];
}

/**
 * Email transport. Feature-flagged: with no provider/key set, email calls log
 * and nothing is sent (sendEmail returns { ok:false, skipped:true }). Uses the
 * Resend HTTP API, so no SMTP dependency. diviniprocure.com is verified in the
 * same Resend account as Divini Partners, so the same EMAIL_API_KEY can send
 * from either domain; EMAIL_FROM controls which one.
 *
 *   EMAIL_PROVIDER=resend
 *   EMAIL_API_KEY=<resend api key>
 *   EMAIL_FROM="Divini Procure <noreply@diviniprocure.com>"
 *
 * Never commit real secrets; these are read from the environment only.
 */
export const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "").toLowerCase(); // resend
export const EMAIL_API_KEY = process.env.EMAIL_API_KEY || "";
export const EMAIL_FROM =
  process.env.EMAIL_FROM || "Divini Procure <noreply@diviniprocure.com>";
export const emailEnabled = (): boolean =>
  EMAIL_PROVIDER === "resend" && !!EMAIL_API_KEY;

/**
 * Monetization V2 (transaction-marketplace model) master flag. When true:
 *   - developers free; vendors free to join + 5 bids per quarter (no rollover,
 *     20/year terminating annually); Vendor Pro = unlimited.
 *   - SUCCESS FEE on platform-sourced awards: 2% of the award capped at $2,500,
 *     billed to the winning vendor (grandfathered pairs: 1% capped $1,000).
 *   - verification is a mandatory free GATE before a vendor can bid / be matched
 *     / message / be recommended to a developer.
 *   - Vendor Pro $149/mo, Verified+ and Featured upsells.
 * Build everything behind this flag so nothing changes until flip.
 */
export const PROCURE_MONETIZATION_V2 = process.env.PROCURE_MONETIZATION_V2 === "true";

/** Standard success fee: percent of the award and the cap (cents). */
export const PROCURE_SUCCESS_FEE_PCT = Number(process.env.PROCURE_SUCCESS_FEE_PCT || 2);
export const PROCURE_SUCCESS_FEE_CAP_CENTS = Number(process.env.PROCURE_SUCCESS_FEE_CAP_CENTS || 250000);

/** Grandfathered existing-relationship success fee: percent + cap (cents). */
export const PROCURE_GRANDFATHERED_PCT = Number(process.env.PROCURE_GRANDFATHERED_PCT || 1);
export const PROCURE_GRANDFATHERED_CAP_CENTS = Number(process.env.PROCURE_GRANDFATHERED_CAP_CENTS || 100000);

/** Free-tier bid allowance per quarter (no rollover; 4x = annual allotment). */
export const PROCURE_FREE_BIDS_PER_QUARTER = Number(process.env.PROCURE_FREE_BIDS_PER_QUARTER || 5);

/** Vendor Pro recurring price (cents). */
export const VENDOR_PRO_PRICE_CENTS = Number(process.env.VENDOR_PRO_PRICE_CENTS || 14900);

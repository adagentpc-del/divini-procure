/**
 * Self-contained AWS Signature Version 4 signer for S3-compatible object stores
 * (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Uses only node:crypto and the
 * global fetch. No AWS SDK, no third-party dependency.
 *
 * This implements the "Authorization header" variant of SigV4 for the S3
 * service. It signs PUT / GET / DELETE object requests against a virtual host
 * style or path style endpoint. The caller passes a fully formed URL plus the
 * raw body bytes; the signer computes the canonical request, the string to
 * sign, the signing key, and returns the headers to attach to fetch().
 *
 * References: AWS "Signing AWS requests with Signature Version 4". The payload
 * hash uses the lowercase hex SHA-256 of the body (UNSIGNED-PAYLOAD is not used
 * so the request is fully integrity protected).
 *
 * Zero em dashes by convention.
 */
import crypto from "node:crypto";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string; // defaults to "s3"
}

export interface SignedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/** YYYYMMDD and YYYYMMDDTHHMMSSZ stamps, both in UTC. */
function amzDates(now: Date): { dateStamp: string; amzDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20240101T010203Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Percent-encode a URI path segment per RFC 3986, preserving "/" between
 * segments. S3 expects each path component encoded but slashes kept literal.
 */
function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");
}

/** Build a canonical query string with sorted, encoded keys and values. */
function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of searchParams.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return pairs
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}=` +
        `${encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    )
    .join("&");
}

/**
 * Sign an S3 object request with SigV4 and return the headers to send. The
 * returned object includes the original headers plus Authorization,
 * x-amz-date, x-amz-content-sha256, and (if not present) host.
 */
export function signS3Request(
  req: SignedRequest,
  creds: SigV4Credentials,
  now: Date = new Date(),
): Record<string, string> {
  const service = creds.service ?? "s3";
  const url = new URL(req.url);
  const body = req.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { amzDate, dateStamp } = amzDates(now);

  const host = url.host;
  const headers: Record<string, string> = {
    ...req.headers,
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  // Canonical headers: lowercase name, trimmed value, sorted by name.
  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  }
  const canonicalHeaders =
    signedHeaderNames.map((h) => `${h}:${lowerHeaders[h]}`).join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    req.method.toUpperCase(),
    encodePath(url.pathname || "/"),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, creds.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, Authorization: authorization };
}

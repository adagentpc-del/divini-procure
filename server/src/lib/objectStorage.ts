/**
 * Pluggable object storage abstraction for Divini Procure.
 *
 * Two providers, selected by STORAGE_PROVIDER:
 *   - "local" (default): bytes live on local disk under FILE_STORAGE_DIR. This
 *     preserves the original local-disk behavior exactly.
 *   - "s3": any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2,
 *     MinIO) reached over HTTPS with AWS Signature V4 (see lib/s3sigv4.ts). No
 *     AWS SDK; uses the global fetch.
 *
 * Envelope encryption (lib/storageCrypto.ts) is applied transparently in this
 * layer for BOTH providers: putObject encrypts before storing, getObject
 * decrypts after fetching. With no STORAGE_ENCRYPTION_KEY set, bytes are stored
 * as plaintext, identical to today.
 *
 * The provider contract is intentionally tiny:
 *   putObject(key, bytes, contentType): Promise<void>
 *   getObject(key): Promise<Buffer>
 *   deleteObject(key): Promise<void>
 *
 * `key` is the same relative storage key used by storage.ts (for example
 * "<companyId>/<bucket>/<ts>-<name>"). storage.ts owns key construction and the
 * signed-URL flow; this module owns the bytes.
 *
 * Zero em dashes by convention. ESM .js imports.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FILE_STORAGE_DIR,
  STORAGE_PROVIDER,
  getS3Config,
} from "../config.js";
import { signS3Request } from "./s3sigv4.js";
import { encryptBytes, decryptBytes } from "./storageCrypto.js";

export interface ObjectStorageProvider {
  putObject(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
}

// --- shared key safety ------------------------------------------------------

/** Reject path traversal; keep the relative key inside the storage root. */
export function safeRelKey(relKey: string): string {
  const normalized = path.normalize(relKey).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("invalid storage path");
  }
  return normalized;
}

// --- local provider ---------------------------------------------------------

function absFor(relKey: string): string {
  return path.join(FILE_STORAGE_DIR, safeRelKey(relKey));
}

export const localProvider: ObjectStorageProvider = {
  async putObject(key, bytes) {
    const abs = absFor(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, encryptBytes(bytes));
  },
  async getObject(key) {
    const stored = fs.readFileSync(absFor(key));
    return decryptBytes(stored);
  },
  async deleteObject(key) {
    try {
      fs.unlinkSync(absFor(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  },
};

// --- s3 provider ------------------------------------------------------------

/** Build the object URL for a path-style S3 endpoint: <endpoint>/<bucket>/<key>. */
function s3Url(endpoint: string, bucket: string, key: string): string {
  const base = endpoint.replace(/\/+$/, "");
  const encodedKey = safeRelKey(key)
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${base}/${encodeURIComponent(bucket)}/${encodedKey}`;
}

export const s3Provider: ObjectStorageProvider = {
  async putObject(key, bytes, contentType) {
    const cfg = getS3Config();
    const body = encryptBytes(bytes);
    const url = s3Url(cfg.endpoint, cfg.bucket, key);
    const headers = signS3Request(
      {
        method: "PUT",
        url,
        headers: {
          "content-type": contentType || "application/octet-stream",
          "content-length": String(body.length),
        },
        body,
      },
      {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        region: cfg.region,
      },
    );
    const res = await fetch(url, { method: "PUT", headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[s3] putObject ${res.status}: ${text.slice(0, 300)}`);
    }
  },
  async getObject(key) {
    const cfg = getS3Config();
    const url = s3Url(cfg.endpoint, cfg.bucket, key);
    const headers = signS3Request(
      { method: "GET", url, headers: {} },
      {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        region: cfg.region,
      },
    );
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[s3] getObject ${res.status}: ${text.slice(0, 300)}`);
    }
    const stored = Buffer.from(await res.arrayBuffer());
    return decryptBytes(stored);
  },
  async deleteObject(key) {
    const cfg = getS3Config();
    const url = s3Url(cfg.endpoint, cfg.bucket, key);
    const headers = signS3Request(
      { method: "DELETE", url, headers: {} },
      {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        region: cfg.region,
      },
    );
    const res = await fetch(url, { method: "DELETE", headers });
    // S3 returns 204 on delete; 404 is treated as already-absent (idempotent).
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`[s3] deleteObject ${res.status}: ${text.slice(0, 300)}`);
    }
  },
};

// --- selection --------------------------------------------------------------

/** Resolve the active provider from STORAGE_PROVIDER (default "local"). */
export function getProvider(): ObjectStorageProvider {
  return STORAGE_PROVIDER === "s3" ? s3Provider : localProvider;
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType?: string,
): Promise<void> {
  return getProvider().putObject(key, bytes, contentType);
}

export async function getObject(key: string): Promise<Buffer> {
  return getProvider().getObject(key);
}

export async function deleteObject(key: string): Promise<void> {
  return getProvider().deleteObject(key);
}

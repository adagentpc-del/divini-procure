/**
 * SSRF guard for server-side fetches of user-supplied URLs (ported from Partners).
 *
 * Any time the server fetches a URL a user or a search result handed it, route
 * the fetch through here. The guard:
 *   - allows only http/https,
 *   - rejects localhost, *.local, and bare IPs in private/loopback/link-local/
 *     reserved ranges (incl. the 169.254.169.254 cloud metadata address),
 *   - performs the request with redirect:"manual" and re-validates every 3xx
 *     Location against the same rules before following it manually (max 2 hops).
 *
 * On ANY rejection or error it returns null; callers already fall back.
 *
 * ZERO em dashes in this file (hard rule). Self-contained: no config import.
 */

const MAX_REDIRECTS = 2;

/** Expand an IPv4 to its 32-bit integer, or null if not a dotted-quad. */
function ipv4ToInt(host: string): number | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIpv4(host: string): boolean {
  const n = ipv4ToInt(host);
  if (n === null) return false;
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // current network / unspecified
    inRange("10.0.0.0", 8) || // private
    inRange("100.64.0.0", 10) || // carrier-grade NAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local (covers 169.254.169.254 metadata)
    inRange("172.16.0.0", 12) || // private
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.168.0.0", 16) || // private
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved
  );
}

/** Normalize an IPv6 literal (strip brackets, lowercase, drop a zone id). */
function normalizeIpv6(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const pct = h.indexOf("%");
  if (pct >= 0) h = h.slice(0, pct);
  return h;
}

function isPrivateIpv6(host: string): boolean {
  const h = normalizeIpv6(host);
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d): validate the embedded v4.
  const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/** True when a hostname must not be fetched (private, loopback, metadata, etc.). */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host === "169.254.169.254") return true; // cloud metadata, belt and suspenders
  if (host.includes(":") || (host.startsWith("[") && host.endsWith("]"))) {
    return isPrivateIpv6(host);
  }
  if (isPrivateIpv4(host)) return true;
  return false;
}

/** Validate a URL string: only http/https and a non-blocked host. Returns the
 *  parsed URL when allowed, otherwise null. */
function validateUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Fetch a user-supplied URL with SSRF protection. Validates the URL and every
 * redirect target against the private-network rules, following at most 2 hops
 * manually (redirect:"manual"). Returns the final Response, or null on any
 * rejection or error. Timeouts and body-size caps remain the caller's job
 * (pass an AbortSignal; this preserves it across hops).
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response | null> {
  let current = validateUrl(rawUrl);
  if (!current) return null;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: opts.signal,
        headers: opts.headers,
      });
      const status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res; // a 3xx with no Location: hand it back as-is
        if (hop >= MAX_REDIRECTS) return null; // too many redirects
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return null;
        }
        const validated = validateUrl(next.toString());
        if (!validated) return null; // redirect target failed the SSRF rules
        current = validated;
        // cancel the body of the redirect response before the next hop
        try {
          await res.body?.cancel();
        } catch {
          // best effort
        }
        continue;
      }
      return res;
    }
    return null;
  } catch {
    return null;
  }
}

export const __test = { isBlockedHost, validateUrl, isPrivateIpv4, isPrivateIpv6 };

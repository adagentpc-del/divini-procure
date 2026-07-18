# Divini Procure — Cloudflare / WAF Setup Runbook

## Why This Matters

The Express server has per-IP rate limiting for burst protection, but a single Node.js process cannot defend against distributed attacks (credential stuffing across thousands of IPs, volumetric DDoS, bot scraping). Cloudflare sits in front of the server and handles these at the network edge before traffic ever reaches the app.

---

## 1. DNS Setup (Cloudflare Proxy)

1. Sign up for a Cloudflare account at [cloudflare.com](https://cloudflare.com) (the free plan covers everything below).
2. Add your domain and point its nameservers to Cloudflare (provided during setup).
3. In **DNS** → add an A record pointing your domain to the server's IP.
4. **Enable the orange cloud** (Proxied) — this routes all traffic through Cloudflare. Do NOT use DNS-only (grey cloud).
5. In **SSL/TLS** → set mode to **Full (strict)** — Cloudflare → origin uses HTTPS with a valid certificate.

---

## 2. SSL / HTTPS

- Set **Always Use HTTPS** to ON (SSL/TLS → Edge Certificates).
- Set **Minimum TLS Version** to TLS 1.2.
- Set **Automatic HTTPS Rewrites** to ON.
- The origin server (your Express app) must also serve HTTPS (or be behind a load balancer with HTTPS termination). Cloudflare verifies the origin cert when using Full (strict).

---

## 3. Rate Limiting Rules (WAF → Rate Limiting)

These protect against credential stuffing and brute-force attacks that bypass the in-process per-IP limiter by spreading across many IPs.

### Rule 1 — Auth endpoints (login / register / forgot-password)

| Field | Value |
|---|---|
| Rule name | `Rate limit auth endpoints` |
| If incoming requests match | URI Path contains `/api/auth` OR URI Path contains `/api/reset` |
| Requests | More than **20** |
| Period | **1 minute** |
| Action | **Block** (or **Managed Challenge** for softer handling) |
| Response | 429 |

### Rule 2 — API overall rate limit

| Field | Value |
|---|---|
| Rule name | `API rate limit` |
| If incoming requests match | URI Path starts with `/api/` |
| Requests | More than **300** |
| Period | **1 minute** |
| Action | **Block** |

### Rule 3 — LLM / AI endpoints

| Field | Value |
|---|---|
| Rule name | `LLM endpoint rate limit` |
| If incoming requests match | URI Path contains `/api/intel` OR URI Path contains `/api/suggest` |
| Requests | More than **30** |
| Period | **1 hour** |
| Action | **Block** |

---

## 4. WAF Custom Rules (Security → WAF → Custom Rules)

### Rule 1 — Block bad bots and scrapers

```
(cf.client.bot) or 
(http.user_agent contains "sqlmap") or
(http.user_agent contains "nikto") or
(http.user_agent contains "masscan") or
(http.user_agent contains "zgrab") or
(http.user_agent eq "")
```

Action: **Block**

### Rule 2 — Challenge known VPN / datacenter IPs on auth routes

```
(ip.geoip.asnum in {AS14061 AS16509 AS15169}) and 
(http.request.uri.path contains "/api/auth")
```

(AS14061 = DigitalOcean, AS16509 = Amazon AWS, AS15169 = Google Cloud — these are datacenter ranges used by credential-stuffing bots.)

Action: **Managed Challenge** (presents CAPTCHA only if suspicious)

### Rule 3 — Block path traversal attempts

```
(http.request.uri.path contains "..%2F") or
(http.request.uri.path contains "%2e%2e") or
(http.request.uri.path contains "..\\")
```

Action: **Block**

---

## 5. Bot Management (Security → Bots)

- Enable **Bot Fight Mode** (free tier) — blocks known bad bots automatically.
- If on Pro plan or above, enable **Super Bot Fight Mode** for verified bots distinction.

---

## 6. DDoS Protection

Cloudflare's DDoS protection is on by default in proxy mode. Ensure:

- **HTTP DDoS Attack Protection** rule set is enabled (Security → DDoS).
- Sensitivity: set to **High** for API endpoints.

---

## 7. Firewall — IP Allowlist for Admin Routes (Optional, Recommended)

If your ops team accesses `/api/admin` from known IPs:

In WAF → Custom Rules:

```
(http.request.uri.path contains "/api/admin") and
(not ip.src in {YOUR_OFFICE_IP YOUR_VPN_EXIT_IP})
```

Action: **Block**

Replace `YOUR_OFFICE_IP` and `YOUR_VPN_EXIT_IP` with your team's IP addresses.

---

## 8. Caching (Performance → Caching)

- **Cache Level**: Standard
- **Browser Cache TTL**: 4 hours for static assets
- The API (`/api/*`) should NOT be cached — add a Cache Rule:
  - If URI Path starts with `/api/` → **Bypass Cache**

---

## 9. Origin IP Protection

Once Cloudflare is enabled, your server's real IP should be kept secret (so attackers can't bypass Cloudflare and hit the server directly).

- Do not publish the origin IP in DNS.
- Restrict inbound traffic at the server firewall to only [Cloudflare IP ranges](https://www.cloudflare.com/ips/).

Example for UFW (Ubuntu):
```bash
# Allow only Cloudflare IPs on port 443/80
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do ufw allow from $ip to any port 443; done
# Block all other inbound on 443
ufw deny 443
```

---

## 10. Verification Checklist

After setup:

- [ ] `curl -I https://your-domain.com` shows `CF-Ray` header (proves traffic is proxied)
- [ ] `curl -I https://your-domain.com/api/healthz` returns 200
- [ ] Auth endpoint returns 429 after 20+ rapid requests
- [ ] Direct connection to origin IP returns connection refused (firewall blocking non-CF traffic)
- [ ] SSL/TLS set to Full (strict) — no mixed content warnings
- [ ] Bot Fight Mode enabled

---

## Free vs. Pro Tier

| Feature | Free | Pro ($20/mo) |
|---|---|---|
| DDoS protection | ✅ | ✅ Enhanced |
| WAF custom rules | ✅ 5 rules | ✅ Unlimited |
| Rate limiting | ✅ Basic | ✅ Advanced |
| Bot Fight Mode | ✅ | ✅ Super Bot Fight Mode |
| Analytics | Basic | Advanced |

The free tier covers everything in this runbook. Pro is recommended if you see significant bot traffic after launch.

---

*Last updated: 2026-07-18*

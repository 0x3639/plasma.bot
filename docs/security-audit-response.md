# Security Audit Response — 2026-03-21

Penetration test report: `docs/report_flow_1_website_penetration_test_20260321113501.md`

## Findings Assessment

### Dismissed as False Positives

| Finding | Severity | Reason |
|---------|----------|--------|
| SQL Injection on `/api/fusions` | High | App uses MongoDB (not SQL). All query params validated via Zod schemas with type coercion. Mongoose driver auto-escapes parameters. |
| Reflected XSS on `/api/debug` | Medium | The `/api/debug` endpoint does not exist in the codebase. No route is defined for this path. |
| CVE-2023-497 | High | Payloads filtered by Cloudflare WAF. Not exploitable in proxied environment. |
| CVE-2022-22965 (Spring4Shell) | High | App is Node.js/Express, not Spring/Java. This CVE is not applicable. |
| Weak password policy | Medium | No user authentication or registration exists. The app uses environment-based API keys for admin access. |
| X-Powered-By header exposed | Low | Helmet v8 removes this header by default. Caddy also strips the Server header. |

### Remediated

| Finding | Severity | Fix |
|---------|----------|-----|
| Missing HSTS header | Medium | Added `Strict-Transport-Security` to Caddyfile header block (was only set in Express/Helmet behind Caddy). |
| Missing CSP at edge | Medium | Added `Content-Security-Policy` to Caddyfile (was only set in Express/Helmet behind Caddy). |
| Missing Permissions-Policy | Low | Added `Permissions-Policy` to Caddyfile restricting camera, microphone, geolocation, and payment APIs. |

### Requires Manual Cloudflare Configuration

| Finding | Severity | Action |
|---------|----------|--------|
| TLS 1.0/1.1 enabled | Medium | Set Minimum TLS Version to 1.2 in Cloudflare dashboard: SSL/TLS > Edge Certificates > Minimum TLS Version. |
| OCSP Stapling not enabled | Low | Verify OCSP stapling is enabled in Cloudflare SSL/TLS settings. |

#### Cloudflare Changes Step-by-Step

1. **Disable TLS 1.0/1.1** — The audit found TLS 1.0 and 1.1 still accepted at the Cloudflare edge, which exposes visitors to BEAST and other downgrade attacks.
   - Go to **SSL/TLS > Edge Certificates > Minimum TLS Version**
   - Change from `TLS 1.0` to **`TLS 1.2`**

2. **Enable HSTS at Cloudflare** (belt-and-suspenders with Caddyfile) — Ensures HSTS is applied even if a request somehow bypasses Caddy.
   - Go to **SSL/TLS > Edge Certificates > HTTP Strict Transport Security (HSTS)**
   - Enable HSTS, set Max-Age to **12 months (31536000)**
   - Enable **Include subdomains**
   - Enable **Preload**
   - Enable **No-Sniff** header

3. **Verify OCSP Stapling** — Cloudflare enables this by default for proxied domains, but confirm it's active.
   - No dashboard toggle; this is automatic for orange-clouded (proxied) records
   - Verify with: `openssl s_client -connect plazma.bot:443 -status < /dev/null 2>&1 | grep -i "OCSP Response Status"`

4. **Set SSL/TLS encryption mode to Full (Strict)** — Ensures Cloudflare validates the origin certificate from Caddy.
   - Go to **SSL/TLS > Overview**
   - Set encryption mode to **Full (strict)**

5. **Enable Always Use HTTPS** — Redirects all HTTP requests to HTTPS at the Cloudflare edge.
   - Go to **SSL/TLS > Edge Certificates > Always Use HTTPS**
   - Toggle **On**

## Verification Checklist

After deployment, confirm with `curl -I https://plazma.bot`:

- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- [ ] `Content-Security-Policy` present with `default-src 'self'`
- [ ] `Permissions-Policy` present
- [ ] `X-Frame-Options: DENY`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] No `Server` or `X-Powered-By` headers
- [ ] SPA loads and functions correctly (CSP not blocking resources)
- [ ] After Cloudflare change: `testssl.sh plazma.bot` shows TLS 1.0/1.1 disabled

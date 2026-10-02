# Security

LIFE ERP holds private financial and personal data, so it is built to be secure by default.

## Threat model
| Threat | Protection |
|---|---|
| Someone on the internet | Not reachable: no ports are opened publicly. Remote access only goes through Tailscale (your devices, WireGuard encryption). |
| Someone on the same Wi-Fi | Must sign in. Login is rate-limited and locks out after repeated failures. `LIFE_ERP_LAN=0` removes LAN exposure completely. |
| Stolen phone | Sessions can be revoked from Settings → Security → Signed-in devices. 2FA protects new sign-ins. |
| Stolen laptop | Turn on **BitLocker** (included in Windows 11 Pro): Settings → Privacy & security → Device encryption / BitLocker. This encrypts the database, documents and backups at rest. |
| Malicious web page in another tab (CSRF) | Strict SameSite cookie, plus every state-changing request must carry the `X-Life-ERP` header, which other sites can't add. |
| Malicious uploaded file | The file type is detected from the content, not the name. Only images, PDFs and plain text are shown inline; everything else (HTML, SVG, scripts) is download-only with a sandboxing CSP and `nosniff`. |
| Malicious backup archive | Paths that try to escape the folder are rejected, every file is checksum-verified, and the database is integrity-checked before use. |
| Data sent to AI providers | AI is **off by default**. When enabled (Phase 8) it gets narrow query results, never the database, and every AI call is logged. |

## Authentication
- **Passwords**: Argon2id (19 MiB memory, 2 iterations; the OWASP baseline). Never stored or logged in plain text. Minimum 10 characters, and the password must not contain the username.
- **First-run setup** is only accepted from the laptop itself: a direct loopback connection with no proxy headers, so it can't be done through Tailscale or the LAN.
- **Sessions**: random 256-bit tokens in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` over HTTPS). Only a SHA-256 hash of each token is stored. Sessions expire after 30 days without use (sliding).
- **Brute force**: 10 sign-in attempts per 5 minutes per IP, plus a per-account lockout after 5 failures (1 → 15 minutes, doubling). Usernames can't be discovered through timing.
- **Two-factor (TOTP)**: any authenticator app, plus 10 one-time recovery codes (stored hashed).
- **Password change** signs out every other device.
- **Recovery** works only on the laptop through the CLI (`reset-password`, `disable-2fa`).

## Application
- All input is validated with shared Zod schemas on the server (and mirrored in the UI).
- SQL injection: all queries go through the Drizzle query builder or prepared statements. Search input is turned into a safe FTS5 expression.
- XSS: React escapes all output. No `dangerouslySetInnerHTML` anywhere. Search highlights are built from text, not HTML.
- Security headers (Helmet): a strict Content-Security-Policy (`script-src 'self'`, no inline scripts), `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: no-referrer`, COOP and CORP. HSTS is off on purpose, because LAN access is plain HTTP; Tailscale supplies HTTPS.
- The database is never exposed: only the server process opens the file. There is no database port.
- No secrets in the frontend. `config/secrets.json` is created on first run and never committed (`.gitignore`).
- The **audit log** records sign-ins (including failures), setup, password and 2FA changes, settings changes, every create/update/delete, backups and restores. Secrets are redacted from audit snapshots.
- Error responses never include stack traces. Details go to the server log with a reference code.

## Recommendations
1. Turn on **2FA** before using LIFE ERP outside home.
2. Turn on **BitLocker**.
3. Keep a backup copy **off the laptop**.
4. Never enable **Tailscale Funnel** for LIFE ERP.
5. Keep Node.js and Tailscale updated.

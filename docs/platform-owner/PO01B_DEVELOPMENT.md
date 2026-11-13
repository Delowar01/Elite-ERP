# Platform Owner — PO-01B development notes

PO-01B adds the **Platform Owner console** on top of the PO-01A foundation: secure sign-in with
mandatory MFA, session handling, a separate `PlatformShell`, and the seven console sections. Security
settings work end to end. The other sections are visibly labelled, non-operational previews of the
layouts that PO-02 … PO-06 will fill.

Nothing here is deployed or applied to production. The console stays **off** unless
`PLATFORM_CONSOLE_ENABLED=true`. Specifications: PR #11 (draft, unmerged) at `357e93e`. Earlier
phases: [`PO00_BASELINE.md`](./PO00_BASELINE.md), [`PO01A_DEVELOPMENT.md`](./PO01A_DEVELOPMENT.md).

## Routes

| Path | Access | Notes |
|---|---|---|
| `/platform/login` | public while the flag is on | Email + password, then an authenticator code (or a recovery code). |
| `/platform/recover` | public while the flag is on | The same flow, starting with a recovery code instead of the authenticator. |
| `/platform/session-expired` | public while the flag is on | Route handler. Clears the platform cookie **only if** the session really is unusable, then goes to `/platform/login?ended=1`. A live session is sent back to the dashboard instead (no loop). |
| `/platform` | live platform session | Redirects to the dashboard. |
| `/platform/dashboard` | live platform session | Overview layout: KPI tiles read "—", panels are empty states. **Preview, PO-02.** |
| `/platform/companies` | live platform session | List, search and filter layout. **Preview, PO-02.** |
| `/platform/users` | live platform session | Directory layout. **Preview, PO-03.** |
| `/platform/subscribers` | live platform session | Subscriptions and manual payments layout. **Preview, PO-05.** |
| `/platform/packages` | live platform session | Catalog layout. No prices exist or are shown. **Preview, PO-04.** |
| `/platform/activity` | live platform session | Audit-history layout. Events are already recorded; the viewer itself is **Preview, PO-06.** |
| `/platform/settings` | live platform session | **Security is operational.** Onboarding and Billing are locked previews. |

While the flag is off, **every** `/platform` path (public ones included) is a bare 404 from the proxy,
with nothing rendered. The pages and handlers repeat the flag check on the server.

## Authorization layers

1. **Proxy** (`src/proxy.ts` → `src/lib/platform-edge/proxy-gate.ts`).
   - One import and one delegation line, placed before the customer branch, which is otherwise unchanged; the matcher is unchanged.
   - The gate is edge-safe: it imports only `next/server` and `jose`, with no database, `server-only` or Node built-ins.
   - It reads **only** the platform cookie.
   - It applies, in order: flag → exact public paths → cryptographic token check. The token check enforces HS256, the platform secret, header `typ: platform+jwt`, issuer, audience, payload `typ: platform`, a UUID `sub`, an opaque `jti`, a lifetime of 12 h or less, an `iat` no more than 60 s in the future, and no `userId`/`orgId` claims.
   - A failing request gets one redirect to `/platform/login`; a present-but-invalid platform cookie is also cleared.
2. **Pages and layouts.** They call `requirePlatformSession()` (PO-01A guard):
   - It checks the live database session: revocation, the idle and absolute limits, and that the administrator is active and enrolled.
   - Every page calls it itself, not only the layout, because Next.js renders a layout and its page concurrently.
   - An unusable session is redirected to `/platform/session-expired`. This was PO-01A's `/platform/login`; it is the only PO-01B change to the guard.
3. **Server actions.** These live in `src/app/(platform)/{auth,security}-actions.ts`.
   - They are thin wrappers around `src/lib/platform/console.ts`.
   - Every mutation re-checks: flag → same-origin (`Origin` must name the request host; `Sec-Fetch-Site`, when sent, must be `same-origin`) → live session → permission.
   - This runs on top of Next.js's own Server Actions origin check, so authorization never depends on what the UI rendered.
   - The browser suite replays a captured real action with a foreign `Origin`, and again without the cookie. Both are refused. The same request sent legitimately succeeds (the positive control).

The customer cookie never authenticates a platform request, and the platform cookie never authorizes
a customer route. Both directions are tested: at the proxy, at the server, and in the browser.

## Sign-in

- Step 1 sends email + password.
  - A correct password returns "second factor required" and stores nothing on the server.
  - The client keeps the password **in memory only** until step 2. It is cleared on success, on "Back", and when it is rejected.
  - Nothing is written to `localStorage` or `sessionStorage`, the URL, or analytics.
- Step 2 sends the authenticator code, or a single-use recovery code.
  - Only then is a session row created, and the HttpOnly cookie set.
  - The cookie is `__Host-elite_erp_platform` in production: `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, expiring with the session.
  - The token never reaches client JavaScript and is never returned in an action result.
- Failures are generic and come from a fixed set of codes, localized EN/AR (`PLATFORM_ERROR_MESSAGES`):
  - Wrong password and unknown account give the same message.
  - Wrong and replayed codes give the same message.
  - Internal failures give "temporarily unavailable", and the server log names only the error class.
- Both steps go through the durable per-account and per-IP throttle (PO-01A). Recovery-code regeneration failures count against the same buckets.
- Sign-out revokes the session row, then clears the cookie with the same attributes it was set with. The cookie is cleared even if the database is unreachable; the row then ends at its idle limit.

## Trusted client IP — `PLATFORM_TRUSTED_PROXY_HOPS`

Next.js fills in `X-Forwarded-For` only when it is **absent** and never appends to it. Without a
reverse proxy, that header is therefore entirely client-controlled. The console trusts it only through explicit
configuration:

| Value | Meaning |
|---|---|
| unset / `0` (default) | No trusted proxy. The IP is **unknown**: per-IP throttling is skipped, the per-account limits still apply, and no header the client sends can choose its own bucket. |
| `1` | One proxy (for example nginx with `proxy_add_x_forwarded_for`) appends the peer address. The client is the **rightmost** entry; anything to its left is ignored. |
| `2` … `9` | That many appending proxies (for example a CDN in front of nginx). |
| anything else | Configuration error. Sign-in fails closed. |

`X-Real-IP` is never trusted. **Owner decision before production:** set the hop count to match the
real infrastructure. Unset (0) is safe, but it disables the per-IP limit.

## Security settings (operational)

- **This session:** device (browser and OS only, from the stored User-Agent), trusted IP, sign-in time, last activity and expiry. All times are shown in **Riyadh time**.
- **Active sessions:** the operator's own sessions only.
  - "End session" revokes one. Another administrator's session id is indistinguishable from an unknown id (`NOT_FOUND`).
  - "Sign out of other sessions" asks for confirmation first.
  - "Sign out of this device" ends the current session.
- **Recovery codes:**
  - Shows how many remain.
  - Regenerating needs the password **and** a fresh authenticator code (step-up). The code is consumed and the codes are replaced in **one transaction**.
  - A failed password, a wrong code, a replayed code or a throttled attempt rotates nothing (tested).
  - The new codes are shown once, in a dialog that Escape or an outside click cannot dismiss. They are never stored by the browser.
  - It fails closed while the audit trail's protection is missing. Revoking sessions and signing out stay available, so an incident can be contained.
- **Provisional policy shown in the UI:** 12 h absolute and 30 min idle. Owner approval is needed before production; the policy itself is unchanged from PO-01A.

## UI

- **Shell:** `PlatformShell` (`src/components/platform/`) is separate from the customer `AppShell`.
  - It reuses the production shell's classes and tokens: the dark 56 px header, the 256/68 px sidebar, the mini rail at 768–1023 px, and the drawer below 768 px.
  - It imports `shell.css`, `lcp.css`, `mockup-parity.css` and `auth.css` without changing them.
  - `AppShell`, `Sidebar`, `NavList`, the shared UI components, the tokens and the shared stylesheets are **unchanged**.
- **Console stylesheet:** `src/app/(platform)/platform.css` styles platform classes only.
  - It uses existing tokens only, with no colour literal.
  - Wherever it paints an orange fill, the text is the white `--primary-foreground` / `--selected-item-text`.
  - These rules are checked statically, and in the browser on every page, in both themes.
- **Language:** English and native Saudi Arabic, from a platform-local dictionary (`src/components/platform/i18n.ts`, Arabic required for every key). RTL mirrors through logical properties.
  - Arabic dates follow the page direction.
  - Pure-Latin values (IP addresses, email) are isolated with `<bdi dir="ltr">`.
- **States:** a shared loading skeleton, a localized error boundary with retry, empty states with disabled later-phase actions, and a permission-denied state.
- **Preview rule:** later-phase actions, search and filters are disabled controls marked "Preview · Planned for PO-0x". The header search shows a notice and queries nothing. No figure, price or record is invented.
- **Shared dialog:** the shared `DialogContent` has a fixed English close label. The console therefore uses its own `PlatformDialog`, on the same Radix primitive, with a localized label.

## Local preview (owner inspection)

The console uses only fictional data and a loopback `*_test_only_*` database. The `next start` server
runs in production mode, so the cookie is `Secure`. Use Chrome, Edge or Firefox on
`http://localhost`, which these browsers treat as a secure context.

~~~bash
# 1. A loopback PostgreSQL ≥ 14 and an admin database — see PO01A_DEVELOPMENT.md, "Disposable PostgreSQL".
export PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55432/<admin db containing _test_only_>
npm run platform:preview-db            # prints the new database's NAME (never a URL)
export DATABASE_URL=postgres://postgres@127.0.0.1:55432/<printed name>

# 2. Test-only secrets for this shell (never commit them).
export AUTH_SECRET="$(openssl rand -base64 48)"
export PLATFORM_AUTH_SECRET="$(openssl rand -base64 48)"     # must differ from AUTH_SECRET
export FIELD_ENCRYPTION_KEYS="1:$(openssl rand -base64 32)"

# 3. A fictional Platform Owner. Interactive: add the TOTP to an authenticator app; keep the recovery codes.
npm run platform:bootstrap

# 4. Build and start with the console enabled, then open http://localhost:3000/platform/login
npm run build
PLATFORM_CONSOLE_ENABLED=true npm run start
~~~

Without step 4's flag, every `/platform` path is a 404. Drop the database afterwards with `dropdb`.

## Verification

| Command | What it covers |
|---|---|
| `npm run verify:platform-boundary` | Static rules: import allow-lists, every server action routed through a console core, every console page guarded, no open redirect, no browser storage, token never returned, EN + AR for every string, no hard-coded copy, tokens only, white on orange, preview controls disabled. |
| `npm run verify:platform-proxy` | The real `proxy()`: the flag (7 values), public and protected paths, look-alikes, 19 token-confusion cases, fail-closed configuration, cross-principal cookies, **96 customer path × cookie cases identical to 621f156's proxy**, an unchanged matcher, and production cookie names. |
| `npm run verify:platform-console` | Disposable database: audit protection, the flag on every operation, CSRF and origin on every mutation, trusted IP and throttle bypass, generic sign-in failures, TOTP and recovery-code replay, revocation (including concurrent), expiry, atomic step-up regeneration, cross-principal isolation, no secret in audit rows. |
| `npm run verify:platform-browser` | Production build + `next start` + Chromium. Every flow listed in the PO-01B brief: EN/AR, light/dark, 1440/1024/390, a forged-request replay, and the flag-off server. `PO01B_SCREENSHOT_DIR` saves the screenshots. Needs `npm run build` first; uses the pre-installed Chromium (`PO01B_CHROMIUM`, default `/opt/pw-browsers/chromium`). |
| `npm run verify:platform` | boundary → proxy → schema → auth → bootstrap → console. |

## Change control

`verify/po01b-approved-delta.mts` records PO-01B exactly as PO-01A recorded itself:

- the 16 hunks in `src/proxy.ts`, `src/lib/platform/guards.ts` and the two freeze verifiers;
- the sha256 of each of the 37 added `src/` files.

Both freeze verifiers undo the layers in this order: PO-01B, then PO-01A, then LCP, then ACC-01. Every
older pin therefore keeps reading its original bytes; nothing was re-baselined and no test was disabled.
`verify-page-archetypes` group 22 also proves three things:

- the proxy hunk is only the import and the delegation;
- the guard hunk is only the redirect target;
- every added file is in the console's own directories.

Changing a PO-01B file means regenerating the record. The regenerated record is part of the change under review.

## Provisional and open — owner decisions

- 12 h absolute / 30 min idle sessions, and the password and throttle settings (unchanged from PO-01A).
- `PLATFORM_TRUSTED_PROXY_HOPS` for the production proxy chain.
- D-6 (production application of the platform SQL) is still open. `db:push` does not install the audit triggers.
- Times in Riyadh. The customer ERP displays UTC (`formatDisplayDate`); the console shows platform security times in Riyadh time.
- Package prices: none are shown until the owner approves them.

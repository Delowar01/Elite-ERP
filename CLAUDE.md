# Elite ERP — Project Instructions


## Development-stage SaaS status and data-loss tolerance (owner-confirmed, 2026-10-30)

- **Lifecycle:** Elite ERP is currently **under development**, not commercially launched or in business production. The VPS runs a deployment for development/testing even if Node uses `NODE_ENV=production`; do not mistake runtime settings for live customer operations.
- **Data status:** There are **no real customers, real end users, or real business data** in the Elite ERP system at this stage. Existing database records and document updates are test data.
- **Owner's explicit risk acceptance:** The owner is comfortable losing **all existing Elite ERP test data**, including test records and changes. Do **not** require complex production-grade backup, off-site transfer, disaster-recovery, or retention procedures as blockers to routine development, schema changes, test resets, or development deployments. Backups may be kept as a convenience, not an owner-imposed requirement at this stage.
- **Priorities:** Focus on finishing outstanding functionality and bugs efficiently, minimizing unnecessary additions and repetitive preflight gates. Elite ERP is intended to become a **commercial, multi-tenant SaaS ERP** offered to external customers in the future. Maintain good architecture, authorization, tenant isolation, and security so it can be properly production-hardened **before customer launch**.
- **Scope of accepted loss:** This acceptance covers **Elite ERP test data only**. It does not authorize damaging unrelated applications, other databases, hosting infrastructure, shared VPS services, third-party accounts, or secrets. Confirm destructive commands target only the intended ERP development environment; keep unrelated services safe.
- **Credentials:** The owner has stated they are not concerned if development credentials are shared in this conversation. Nevertheless, credentials can provide real server, database, cloud, or billing access even without production customers. **Never unnecessarily reproduce, publish, or commit secrets**; handle them safely without overburdening the development workflow. Assess a specific exposed key on its actual capabilities rather than assuming all development credentials are harmless.
- **Operational posture:** A test-data backup has already been made and encrypted on the VPS. Completing the attempted Windows off-server transfer is **optional**; do not let it delay the SaaS development work. Do not automatically switch public deployments, edit unrelated services, or claim a release has been deployed without the actual operation and verification.

## Arabic/English bilingual requirement (standing convention)

Every feature, screen, or component built for this project from now on **must ship with Arabic support from the start** — not as a separate translation pass added later. The Arabic output must read as **native, idiomatic Arabic**, not a literal/mechanical translation. Saudi Arabic phrasing, not generic MSA where the two diverge in a business/ERP context.

This applies to both:
- **The clickable HTML mockup** (`build_mockup_v12.py`, in the session scratchpad) — use the existing `AR_DICT` dictionary + `T(en, tag, cls)` / `TA(en)` helper functions (see the file, defined near the top after `i18n_text()`). Every new call site that renders user-facing text should route through `T()`/`TA()` with a matching `AR_DICT` entry, not raw English strings.
- **The real Next.js app** (this repo) — once a translation layer exists here, follow the equivalent pattern; until then, any new user-facing string added to a Server/Client Component should be written with its Arabic counterpart available (a local dict, a shared i18n util, etc.) rather than hardcoded English-only.

### What "native, not translated" means in practice
- Correct ERP/business terminology in Arabic (e.g. "ضريبة القيمة المضافة" for VAT, not a clumsy transliteration).
- RTL layout correctness for every new screen: mirrored flex/grid direction, mirrored icons where directional (chevrons, arrows), numbers/dates/currency stay LTR inside RTL text per the pattern already established (`.mono`/`.num`/`.kpi-value` forced `direction: ltr`).
- Don't leave dynamic/computed strings (stat labels, table headers, button labels, empty states, error messages, toasts) as English-only "for now" — they get missed in later audits. Translate at the point of creation.

### Verification checklist for new features going forward
1. Build the screen/component with both `data-i18n-en`/`data-i18n-ar` (or the real-app equivalent) from the first commit, not retrofitted.
2. Regenerate the mockup (`python3 build_mockup_v12.py`) and manually switch to Arabic via the language switcher to eyeball the new content.
3. Extend the Playwright verification script for that version (`verify_vNN.js` pattern) with at least one assertion that the new content is Arabic after switching languages — matching the audit methodology used in v24/v25 (regex `[؀-ۿ]` test against `textContent`).
4. Re-run the existing verification suites (they accumulate — see `verify_v23.js`, `verify_v24.js`, `verify_v25.js` in the scratchpad) to confirm no regressions.

### Background
This requirement was set explicitly by the user after a v24 pass initially only translated the app shell (sidebar/topbar), and a v25 audit found six document detail screens, timeline/version-history widgets, and several settings screens still fully in English. Going forward, "translate later" is not an acceptable pattern for this project — Arabic is a first-class requirement alongside English for every new piece of UI.

# Elite ERP — Project Instructions

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

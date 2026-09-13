# Elite ERP Executive Presentation — Implementation Plan

> **Status:** Planning deliverable — no presentation code has been written yet.
> **Inputs analyzed:** All 10 Markdown specification documents (01–10), EIS Brand Guidelines 2026 (PDF), EIS logo pack (SVG, full lockup + icon), Elite ERP Product Knowledge Base v2.0, and the latest approved HTML mockup (V27, "Design System v12 Clickable Prototype", 26 screens).
> **Date:** 2026-07-17

> **Amendment (design-overhaul pass):** Per explicit client direction, this build was temporarily switched to **English-only** — the EN/AR toggle, `data-i18n-ar` content, and Arabic screenshot swapping described in §9 below were removed from `presentation/` to focus entirely on visual/brand quality. Arabic captures and fonts remain on disk (`assets/screenshots/ar/`, `fonts/arabic/`) for reintroduction once the English design is finalized, per CLAUDE.md's standing bilingual requirement. Do not treat §9's bilingual language as currently implemented.

> **Amendment (Round 4 — color/background direction override):** `02_Global_Design_System.md` §5 (Color System → Neutral Palette) and §6 (Background System) instruct that the deck "SHOULD primarily use White / Soft White / Light Gray," "MUST remain bright and spacious," and that "Heavy textures, patterns, and dark themes SHOULD NOT be used." Live client feedback after three rounds of targeted fixes (borders/type, edge framing, reference-concept density) was that the result was **still too white/empty, colors too flat and muted, too minimal and quiet** compared to the reference concept deck — a direction problem, not a residual polish item. **For this project, that feedback overrides Doc 02 §5–6 as of Round 4.** The operative rules going forward, for slides 01–15:
> - Color does real visual work as solid/gradient fills — navy and orange panels, dark full-bleed sections, gradient-filled icon medallions — not just thin accent lines and 5–15%-opacity glows on white.
> - No slide should read as more than roughly a third flat white/cream background once finished; an underfilled slide gets more real content or a real color treatment, not more "premium" whitespace.
> - Every slide matches the 8-image reference concept's density: a real visual (device mockup / diagram / dashboard), a color-filled icon/benefit row, and a bottom proof strip or stat band.
> - The structural fixes from Rounds 1–3 stand: accent-edge (not flat 4-side) borders on small components, asymmetric icon corner-cuts, real device mockups (no stock photography, no generic circle-icon kits), varied per-slide edge framing, and the ~18px type floor. Round 4 adds color richness and density on top of that foundation.
>
> Do not build slides 05–15 against Doc 02 §5–6's "bright, spacious, no heavy texture" instruction — build them to the Round 4 standard above from the start.

---

## 1. What the analysis established

### 1.1 The specifications (Documents 01–10)

- **Doc 01 (highest priority):** Native HTML presentation, fixed 16:9 canvas, 15 slides, premium keynote quality comparable to Microsoft/SAP/Oracle/Salesforce/Apple. No frameworks, fully offline, authentic Elite ERP screens only, no redesign of the product UI.
- **Doc 02:** Design system — Navy + Orange brand palette, white/soft-white backgrounds, editorial layouts, generous whitespace, one icon language, consistent radius/shadows, product screens are the hero assets.
- **Doc 03:** Technical architecture — `index.html` + modular `css/` (global, components, animations, presentation) + modular `js/` (app, navigation, animation, presentation) + organized `assets/` + `fonts/`. Semantic sections per slide, reusable components, descriptive class names, proportional 16:9 scaling, keyboard/mouse/full-screen navigation.
- **Doc 04:** Story arc — Introduction → Problems → Solution → Platform → Modules → Intelligence → Technology → Value → CTA. 15-slide sequence is fixed. 30–40% information / 60–70% visuals.
- **Docs 05–08:** Per-slide specs (detailed below), including the standard module layout for slides 05–15 (header + 30% left panel + 70% product screen + callouts + 5-item benefit strip).
- **Doc 09:** Motion — fade/slide/scale only, defined duration table (fade 300–500ms, screen transition 500–700ms, KPI counters 800–1200ms), fixed entry sequence (background → header → headline → text → hero → screen → callouts → benefit strip), hardware-accelerated transforms, `prefers-reduced-motion` respect.
- **Doc 10:** QA gates — content, visual, screen validation, animation, navigation, responsive, cross-browser (Chrome/Edge/Firefox/Safari), performance, accessibility, branding, technical validation.

### 1.2 The brand (authoritative values from the Brand Guidelines PDF)

| Token | Value | Usage |
|---|---|---|
| Midnight Navy | `#151348` (PMS 2765C) | Headlines, key content, primary illustrations — **leads (60%)** |
| Ignition Orange | `#E56C25` (PMS 166C) | Highlights, icons, stats, active states — **accents (10%)** |
| Paper | `#FFFFFF` | Primary background |
| Cream | `#F7F3EC` | Soft background variant |
| Stone | `#EFEAE1` | Cards / subtle fills |
| Graphite | `#6B6B72` | Secondary text |
| Ink | `#1A1A1A` | Body text |

- **Typography:** Inter (fallback Helvetica Neue → Arial). Titles Bold with tight tracking, body Regular, max three weights per surface, uppercase reserved for eyebrows/labels.
- **Logos:** Two approved SVGs — full lockup (E-mark + ELITE wordmark + descriptor) and standalone icon mark. Never stretch, rotate, recolor, restyle, or place on low contrast. Clear space = height of "E"; min sizes 110px (lockup) / 32px (icon).
- **Note:** The spec documents say only "Navy Blue" and "Orange"; the PDF's exact hex values above are the single source of truth.

### 1.3 The product screens available (V27 mockup inventory)

The mockup contains **26 authentic screens** (each a `data-screen` view): dashboard, quotations, orders, proforma, invoices, delivery-challans, credit-notes, debit-notes, payments, bank-accounts, journal, coa, ledger, reports, po, vendors, clients, products, employees, departments, attendance, leave, payroll, projects, presets, organization.

Critically, the mockup already ships **full bilingual EN/AR support** (1,200+ `data-i18n-ar` call sites, working `setLang()` switcher, RTL layout). This matters — see §9.

### 1.4 Standing project convention (CLAUDE.md)

Every new deliverable in this project **must ship with native, idiomatic Arabic support from the first commit** — not retrofitted. This applies to the presentation itself: an EN/AR language toggle, RTL-mirrored slide layouts, Arabic screenshots of the product screens, and Playwright verification that switched content is genuinely Arabic (regex `[؀-ۿ]` methodology from the v24/v25 audits). The 10 spec documents do not mention this, but the project convention adds it on top of (not in conflict with) them — Elite ERP's own "Multi-Language Support" positioning makes this a selling point, and it is implemented as an additive enhancement that leaves the default English experience exactly as specified.

---

## 2. Overall development strategy

1. **Standalone static presentation, zero dependencies.** Pure HTML5 + CSS3 + ES6 vanilla JS in a self-contained `presentation/` folder at the repo root. It never imports from the Next.js app; opening `presentation/index.html` from disk works offline (Doc 01 §7, Doc 03 §2).
2. **Screens as pre-rendered screenshots, not live embeds.** The V27 mockup is driven by Playwright (already the project's verification tooling) to capture each needed screen at 2× device-scale in a fixed 1600×1000 viewport — once in English, once in Arabic. Static PNG/WebP screenshots guarantee Doc 10's "no stretching, no blur, consistent framing" gates, keep the presentation fast, and keep it authentic (pixels come from the real approved mockup, untouched).
3. **Single `index.html`, 15 `<section class="slide">` elements.** One DOM, CSS-class-driven state (`.active`, `.entered`), no per-slide HTML files — matches Doc 03 §4 and makes transitions trivial and fast.
4. **A fixed 1920×1080 design canvas scaled with `transform: scale()`.** All slide layout is authored at exact pixel values on a 1920×1080 stage; a tiny JS resize handler scales the stage to fit the window while preserving 16:9 (letterboxed on off-ratio windows). This is the only reliable way to guarantee "pixel-perfect alignment" and "composition preserved at any size" simultaneously (Doc 01 §13, Doc 08 §Responsive).
5. **Component classes, not copy-paste.** One set of CSS components (`slide-header`, `panel-left`, `screen-frame`, `callout`, `benefit-strip`, `stat-card`, `module-chip`…) reused across slides 05–15 so the mandated identical module layout is structurally identical, not visually approximated.
6. **Animation centralized and data-driven.** Entry sequences declared as `data-anim` + `data-anim-order` attributes on elements; one `animation.js` engine applies the Doc 09 timing table with IntersectionObserver-free logic (slides animate on activation). No per-slide animation code.
7. **i18n via the mockup's proven pattern.** `data-i18n-en` / `data-i18n-ar` attributes + a small dictionary + `setLang()` toggle, mirroring the pattern already established in `build_mockup_v12.py` — including forced-LTR `.num`/`.kpi-value` inside RTL text.
8. **QA is continuous, not final.** Each phase ends with a Playwright verification script (accumulating `verify_p1.js` … pattern) asserting slide presence, navigation, animation classes, asset loading, and Arabic content — so Doc 10's checklist is enforced by machine before human review.

---

## 3. Folder & file structure

Per Doc 03 §3, adapted into this repo without touching the Next.js app:

```
presentation/
│
├── index.html                  # all 15 <section class="slide"> + shell
├── css/
│   ├── global.css              # reset, brand tokens (CSS custom properties), typography, canvas/scaling
│   ├── components.css          # cards, callouts, benefit strip, screen frames, buttons, icons, stat cards
│   ├── animations.css          # keyframes + .anim-* utility classes (Doc 09 timing table as CSS variables)
│   └── presentation.css        # per-slide layout (slide-01 … slide-15), RTL overrides
│
├── js/
│   ├── app.js                  # boot, preload, loading screen, language toggle (i18n dictionary)
│   ├── navigation.js           # keyboard / wheel / click / touch / progress dots / full-screen
│   ├── animation.js            # entry-sequence engine (data-anim orchestration), KPI count-up
│   └── presentation.js         # slide registry, state machine, deep-link (#slide-07)
│
├── assets/
│   ├── logo/                   # eis-lockup.svg, eis-icon.svg (+ white/knockout variants for navy areas)
│   ├── icons/                  # single-style inline SVG icon set (see §6)
│   ├── screenshots/
│   │   ├── en/                 # dashboard.png, quotations.png, … (2× resolution)
│   │   └── ar/                 # same set captured with the mockup switched to Arabic
│   ├── illustrations/          # hero-cover.svg, ecosystem.svg, challenges.svg, architecture.svg, roadmap.svg
│   └── images/                 # any raster backgrounds (mesh gradient, exported once, optimized)
│
├── fonts/
│   ├── inter/                  # Inter var/400/600/700/800 woff2 (self-hosted, offline)
│   └── arabic/                 # IBM Plex Sans Arabic (or Noto Sans Arabic) 400/600/700 woff2
│
└── tools/
    ├── capture_screens.js      # Playwright: drives V27 mockup, captures en/ + ar/ screenshots
    └── verify_presentation.js  # accumulating QA suite (navigation, assets, Arabic assertions, timing)
```

The V27 mockup file itself is stored at `presentation/tools/mockup-v27.html` (source for captures only — never shipped inside the deck).

---

## 4. Asset organization & production pipeline

| Asset | Source | Production step |
|---|---|---|
| Brand colors / tokens | Brand PDF | Encode once as CSS custom properties in `global.css` (`--navy:#151348; --orange:#E56C25; --cream:#F7F3EC; --stone:#EFEAE1; --graphite:#6B6B72; --ink:#1A1A1A`) |
| Logos | `eislogos.html` | Extract the two SVGs verbatim; crop viewBoxes to content; create a white knockout variant for use on navy (permitted — recoloring the approved reversed application, not restyling) |
| Product screenshots | V27 mockup + Playwright | `capture_screens.js`: 1600×1000 viewport, `deviceScaleFactor: 2`, wait for fonts/sparklines, capture each of the ~12 needed screens in EN, run `setLang('ar')`, recapture. Output optimized PNG (lossless, then squoosh/oxipng pass) |
| Browser frame | Built in CSS | One reusable `.screen-frame` component (traffic-light dots + URL bar reading `erp.elite-innovation.com/...`), so framing is identical everywhere (Doc 08) |
| Icons | Authored | ~24 inline SVGs, one style: 1.5px stroke, rounded caps, 24×24 grid, currentColor (see §6) |
| Illustrations | Authored SVG | 5 custom pieces (see §6) in the brand's flat-geometric-with-depth style, navy-led with orange accents |
| Fonts | Google Fonts (downloaded once) | Self-hosted woff2 subsets; `font-display: block` behind the loading screen so no FOUT during a live keynote |
| Background | Authored | One soft radial/mesh gradient (white → cream, faint navy/orange glows) reused on slides 01 and 15 for the bookend effect |

---

## 5. Slide-by-slide implementation plan (15 slides)

Every module slide (05–15 where applicable) uses the **standard module layout**: header (icon + module name + value proposition) / left panel 30% (challenge, 5–6 capabilities, value) / right panel 70% (framed screenshot + 3–5 callouts with thin connector lines) / bottom benefit strip (5 outcomes with icons).

| # | Slide | Layout | Product screen(s) used | Key visuals & notes |
|---|---|---|---|---|
| 01 | **Cover** | Logo upper-left, headline center-left, hero right, tagline bottom | Faint, angled **dashboard** fragment inside the hero composition (subtle UI fragments are explicitly allowed) | Headline "One Intelligent Platform. Every Business Process."; custom abstract enterprise-network hero (SVG); entry: background → logo → headline → support → hero → accents |
| 02 | **Executive Summary** | Editorial: message left, illustration right, 5 outcomes bottom | none (illustration slide) | Connected-modules platform illustration (shared `ecosystem.svg` base); outcome chips: Better Decisions, Faster Operations, Unified Data, Higher Productivity, Sustainable Growth |
| 03 | **Business Challenges** | Problem statement left, infographic right, transition bottom | none | "Disconnected → connected" infographic: scattered grey silo cards progressively revealed, then converging arrows; challenges limited to 6 (silos, manual work, duplicate entry, delayed reporting, poor visibility, decision delays) |
| 04 | **Why Elite ERP** | Ecosystem diagram center, value left, capabilities right | none | Central hub-and-spoke SVG: Elite icon-mark core, 8 module nodes (CRM, Sales, Finance, HR, Procurement, Inventory, Projects, Analytics) connecting in sequence; transition line "Let's explore how each business function is transformed with Elite ERP." |
| 05 | **Unified Enterprise Platform** | First standard module layout | **dashboard** (primary) | The dashboard is the perfect "one platform" proof: KPI row, finance overview, HR snapshot, project overview, cash flow in one view. Callouts: Unified KPIs · Live Finance · HR Snapshot · Projects · Quick Actions |
| 06 | **Sales & CRM** | Standard module layout | **quotations** (primary), **clients** (secondary thumbnail card) | Callouts: Customer Profiles · Quotation Pipeline · Status Workflow · Follow-ups · Totals. Capabilities: Lead & Client Management, Quotations, Sales Orders, Proforma, Pipeline Tracking, Activities |
| 07 | **Finance & Accounting** | Standard module layout | **ledger** (primary), **invoices** (secondary thumbnail) | Callouts: Chart of Accounts · Ledger Entries · Financial Reports · Payment Records · Reconciliation. Capabilities: GL, AR/AP, Journals, Reports, Bank Reconciliation, VAT (ضريبة القيمة المضافة) compliance |
| 08 | **HR & Payroll** | Standard module layout | **employees** (primary), **payroll** (secondary thumbnail) | Callouts: Employee Directory · Attendance · Payroll Runs · Leave Requests · Departments |
| 09 | **Procurement & Inventory** | Standard module layout | **po** (primary), **products** (secondary thumbnail) | Callouts: Purchase Orders · Vendor Information · Product Catalog · Stock Values · Approval Status. (See risk R3 on warehouse depth) |
| 10 | **Project Management** | Standard module layout | **projects** (kanban board + time logs) | Callouts: Project Dashboard · Task Board · Team Allocation · Progress · Time Logs |
| 11 | **Executive Dashboard & AI** | **Visual centerpiece** — oversized screen (~78%), extra whitespace, slimmer left panel | **dashboard** (hero treatment, larger scale than slide 05, different crop/focus: KPI + sparkline region) | KPI count-up animation over the real numbers; AI positioning delivered via callouts/left panel (AI Insights, Predictive Trends, Executive Alerts) — **no fabricated AI UI** (see risk R4) |
| 12 | **Security, Scalability & Technology** | Illustration-led (spec: avoid screenshots here) | none | Custom `architecture.svg`: shield + cloud + database + API nodes + devices, building progressively; three columns Security / Technology / Scalability; slow pulse animation on connection lines |
| 13 | **Implementation Methodology** | Left 35% overview, right 65% roadmap | none | Premium horizontal 6-milestone timeline (Discovery → Design → Implementation → Testing → Training → Go-Live), connector draws left-to-right, milestone icons pop sequentially |
| 14 | **Business Outcomes & ROI** | Outcomes left, KPI cards right | none | 5 stat cards with directional arrows (↑ Productivity, ↓ Manual Processes, ↑ Visibility, ↑ Collaboration, ↑ Intelligence) — qualitative arrows, **no invented percentages** (Doc 08 mandate); closing executive statement |
| 15 | **Thank You** | Center-aligned bookend of slide 01 | none | Both logos, "Transform Your Business with Elite ERP", thank-you line, contact block (see risk R5), same background family as cover; final animation ends at rest (no loop) |

Visual rhythm check (Doc 08): editorial (01–02) → infographic (03–04) → product (05–10, with 11 as oversized break) → illustration (12) → timeline (13) → KPI (14) → hero bookend (15). No two adjacent identical compositions outside the mandated module run, where the secondary-thumbnail alternation and per-module accent icons provide variation within consistency.

---

## 6. Additional graphics to be created

**Illustrations (5, authored SVG, navy-led + orange accents, flat-geometric with subtle depth):**
1. `hero-cover.svg` — abstract enterprise network with embedded faint dashboard fragment (slides 01/15 variants)
2. `ecosystem.svg` — connected modules around one core (slide 02 platform variant + slide 04 hub-and-spoke variant share geometry)
3. `challenges.svg` — disconnected-silos-to-connected infographic (slide 03)
4. `architecture.svg` — security/cloud/API technology diagram (slide 12)
5. `roadmap.svg` — 6-phase implementation timeline base (slide 13; milestone content in HTML for i18n)

**Icon set (~24, single style — 24×24, 1.5px stroke, rounded joins, `currentColor`):** module icons (crm, sales, finance, hr, procurement, inventory, projects, analytics, ai, security), benefit icons (speed, visibility, collaboration, accuracy, productivity, growth, cost, compliance), UI icons (arrow-left/right, fullscreen, check, globe/language). Directional icons must mirror in RTL.

**Components:** browser frame, callout pill + thin connector line, benefit strip, stat card, progress dots — all CSS/HTML, no images.

**Deliberately not created:** any fake ERP UI, AI chat mockups, stock imagery, emoji icons, 3D charts (all prohibited by Docs 01/02).

---

## 7. Animation & interaction strategy

- **Timing tokens** (CSS variables, from Doc 09): `--t-fade: 400ms; --t-slide: 500ms; --t-scale: 400ms; --t-callout: 300ms; --t-kpi: 1000ms; --t-transition: 600ms;` single easing `cubic-bezier(0.22, 1, 0.36, 1)` (confident, decelerating, never bouncy).
- **Slide transition:** cross-fade + 24px directional drift (soft slide), driven by `.active`/`.leaving` classes; only `opacity` and `transform` are animated (GPU-composited).
- **Entry sequencing:** every animated element declares `data-anim="fade-up|fade|scale-in|draw"` and `data-anim-order="1…8"`; `animation.js` staggers them 120ms apart in the fixed Doc 09 order (background → header → headline → text → hero → screen → callouts → strip). Sequence re-plays when a slide becomes active, runs once per visit direction.
- **Product screens:** fade + 20px rise + scale 0.97→1.0; callouts appear sequentially only *after* the screen settles, connector lines drawn with `stroke-dashoffset`.
- **Infographics:** progressive builds (silos → convergence on 03; nodes connect in order on 04; timeline draws on 13; architecture pulses on 12).
- **KPI counters:** requestAnimationFrame count-up (800–1200ms) with locale-aware number formatting (Arabic mode keeps Western digits LTR per the established `.num` convention).
- **Navigation:** `←/→`, `PgUp/PgDn`, `Home/End`, `Space`, `F` (fullscreen), mouse wheel (throttled), on-canvas prev/next buttons, clickable progress dots, optional touch swipe, `#slide-NN` deep links.
- **Loading screen:** Elite icon-mark + minimal progress bar on cream gradient; preloads fonts + first screenshots; guaranteed sub-second on local disk.
- **Accessibility:** `prefers-reduced-motion` collapses all animation to simple fades; content fully readable with animations disabled; no flashing.

---

## 8. Risks & missing assets

| # | Risk / gap | Mitigation |
|---|---|---|
| R1 | **No dedicated CRM lead-pipeline screen** in V27 (closest: `clients`, `quotations`). Doc 06 suggests "sales pipeline" callouts. | Slide 06 leads with `quotations` (a genuine pipeline of commercial documents with statuses) + `clients` thumbnail; callout wording matched to what is actually visible. Flag to client: if a leads/pipeline screen ships in a future mockup version, it drops in via one file swap. |
| R2 | **No AI-specific UI** exists in the mockup, but slide 11 is titled "Executive Dashboard & AI". | Use the real dashboard as the visual; express AI through left-panel messaging and callout labels, not fabricated interface elements. Keeps Doc 02 §14 ("MUST NOT redesign / MUST remain authentic") intact. |
| R3 | **No warehouse/stock-level screen** (only `products`, `po`, `vendors`). Doc 07 suggests "stock levels / warehouse summary" callouts. | Lead slide 09 with `po`; use `products` (catalog + values) as secondary; callouts restricted to visible elements. Flagged as the one place spec suggestions exceed available product surface. |
| R4 | **Slide 15 contact details** (website, email, phone, optional QR) are not provided anywhere authoritative — the brand PDF's samples are placeholder stationery data. | Build the contact block as a clearly-marked variable region; request real values before final delivery (Doc 10 §3: "no placeholder text remains"). |
| R5 | **Screenshot text legibility at 70% panel width.** Dense tables (ledger, payroll) may render small on projectors. | 2× capture + tight cropping to the meaningful region + Doc 10 readability check at 1080p and 4K; choose crops per screen during Phase 0 review. |
| R6 | **Safari compatibility** can't be verified in this Linux environment (Chromium/Firefox only via Playwright). | Use only well-supported CSS (no experimental features); Playwright WebKit engine as Safari proxy; note residual risk for real-device Safari check by the client. |
| R7 | **Font licensing/offline:** Inter and IBM Plex Sans Arabic are OFL — safe to self-host. | Subset woff2 to used glyph ranges (Latin + Arabic) to keep the deck light. |
| R8 | **Spec file artifacts:** the uploaded MD files contain concatenated fragments of other documents at their ends. | Treat each document's own titled content (top section) as authoritative; conflicts resolved by Doc 01's precedence rule. No actual contradictions found. |

---

## 9. Compliant enhancement suggestions

All additive, none violating a MUST/MUST NOT:

1. **Full EN/AR bilingual presentation** (required by project convention, and a genuine differentiator — it demos Elite ERP's multi-language claim live). Globe toggle in the chrome; RTL-mirrored layouts; Arabic screenshots captured from the mockup's own Arabic mode; native Saudi-business Arabic copy (e.g. "منصة ذكية واحدة لكل عمليات أعمالك", "ضريبة القيمة المضافة", "لوحة المؤشرات التنفيذية") — no mechanical translation.
2. **Presenter aids:** slide counter + progress dots (subtle, hideable with `H`), `#slide-NN` deep links for jumping during Q&A, `Esc` overview grid (optional, cheap with the existing slide registry).
3. **The 05↔11 dashboard "payoff":** same screen shown normally on 05 and enlarged with animated KPIs on 11 creates an intentional narrative echo ("you saw the platform — now see what leadership sees").
4. **`erp.elite-innovation.com` URL in the browser frame** — a small authenticity cue consistent with the brand domain.
5. **Print/PDF fallback stylesheet** (one `@media print` block) so the deck can be exported as a leave-behind — zero runtime cost.
6. **Bookended background system** (identical gradient family on 01/15) for the closing full-circle impression Doc 08 asks for.

---

## 10. Implementation phases & estimates

| Phase | Scope | Exit criteria (Doc 10 mapped) | Est. |
|---|---|---|---|
| **P0 — Assets** | Screenshot pipeline (`capture_screens.js`, EN+AR sets), logo extraction/variants, font subsetting, icon set, 5 illustrations, crop review | All screenshots sharp at 2×, no distortion; icons single-style; illustrations approved | 1 session |
| **P1 — Shell** | `index.html` skeleton, 16:9 scaling canvas, brand tokens, typography, navigation.js (all input modes + fullscreen), loading screen, i18n engine + toggle, slide state machine | Navigation checklist passes in Chromium+Firefox; canvas holds 16:9 at any window size; language toggle flips shell EN↔AR with RTL | 1 session |
| **P2 — Slides 01–04** | Cover, Executive Summary, Challenges, Why Elite ERP + their illustrations wired to the animation engine | Docs 05 acceptance criteria; entry sequences per Doc 09; AR verified | 1 session |
| **P3 — Slides 05–08** | Standard module layout components + Platform, Sales & CRM, Finance, HR slides | Doc 06 acceptance criteria; identical layout structure verified; callouts sequence correctly | 1 session |
| **P4 — Slides 09–12** | Procurement, Projects, Executive Dashboard & AI (centerpiece treatment + KPI count-up), Security & Technology illustration | Doc 07 acceptance criteria; slide 11 reads as the visual highlight | 1 session |
| **P5 — Slides 13–15** | Implementation timeline, ROI stat cards, Thank You + closing animation; contact block finalized (pending R4 input) | Doc 08 acceptance criteria | 1 session |
| **P6 — Motion & polish** | Timing consistency pass, hover states, reduced-motion, performance profiling (transform/opacity only, image sizes), print stylesheet | Doc 09 consistency checklist; smooth on 60Hz; fast initial load | 0.5 session |
| **P7 — QA & delivery** | `verify_presentation.js` full suite (15 slides present, order, navigation, assets resolve, no console errors, Arabic regex assertions per slide, timing tokens), cross-browser run (Chromium/Firefox/WebKit), final visual audit against Doc 10 §16 | Every Doc 10 checkpoint green; zero placeholders (blocked only on R4 contact data) | 0.5 session |

Total: ~7 working sessions, each ending in a committed, verifiable state on this branch.

---

## 11. Open questions for the client

1. **Contact details for Slide 15** — real website / email / phone (and whether a QR code is wanted, and where it should point).
2. **Arabic-first or English-first default?** Plan assumes English default with an AR toggle; confirm if executive audiences warrant Arabic as the launch language.
3. **CRM pipeline screen** — accept `quotations` + `clients` as the Sales & CRM visuals (R1), or is an updated mockup with a leads screen expected first?

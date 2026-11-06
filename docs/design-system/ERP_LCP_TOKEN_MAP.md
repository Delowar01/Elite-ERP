# Elite ERP × LCP — token map

How every Lead Capture Pro (LCP) **web** design value reaches the ERP. The LCP source is the design kit
extracted from `Delowar01/Exhibition-Lead-Pro` @ `8baaa00364b677c702bb557ca13959ae04a5d824`
(`web/css/lcp-tokens.css`, rendered screenshots, `DESIGN_TOKENS.md`). Web values win over the Expo
client (`#FF6B00` is **not** used). Ratios are WCAG 2.x, measured with `src/lib/contrast.ts`.

## 1. Mechanism (no second variable system)

1. LCP declares bare HSL triplets (`--primary: 24 100% 50%`) read through `hsl(var(--primary))`. The
   ERP registers its colour tokens as `@property … { syntax: "<color>" }`; a triplet is not a `<color>`,
   so pasting LCP CSS would make every token compute to `transparent`. **No LCP stylesheet is imported.**
2. Each LCP value is resolved to HEX and written into the existing canonical token of the same meaning
   in `src/lib/design-tokens.ts` (`TOKENS.light` / `TOKENS.dark`), mirrored once per token in
   `src/app/globals.css` as `light-dark(<light>, <dark>)`. `verify:contrast` fails on any drift and
   measures every pair below in both appearances.
3. Shell-only surfaces get new registered tokens (`--header-bg`, `--header-ink`, `--header-border`,
   `--header-accent`, `--shadow-color-soft`), so `getComputedStyle` reads real colours.
4. Presentation that the legacy layer hard-codes (card radius, table header case, KPI type, tabs, menus,
   page titles) is restyled by `src/app/(app)/lcp.css`, loaded after `mockup-parity.css` and `shell.css`.
   The legacy stylesheet and the pinned primitives stay byte-identical.

## 2. Colour tokens

| ERP token | LCP source | Light | Dark | Notes |
|---|---|---|---|---|
| `--canvas` | `--background` 220 20% 98% / 0 0% 10% | `#f9fafb` | `#1a1a1a` | exact |
| `--surface` | `--card` 0 0% 100% / 0 0% 13% | `#ffffff` | **`#272727`** | dark lifted from `#212121`: LCP canvas/card is 1.08:1; the ERP requires ≥ 1.15:1 (now 1.165) |
| `--surface-subtle` | `--muted` / `--secondary` 220 14% 96% / 0 0% 18% | `#f3f4f6` | `#333333` | dark step follows the lifted card |
| `--surface-raised` | `--popover` | `#ffffff` | `#2b2b2b` | menus / dialogs a step above the card in dark |
| `--text` | `--foreground` 0 0% 13% / 220 20% 98% | `#212121` | `#f9fafb` | exact |
| `--text-muted` / `--text-faint` | `--muted-foreground` 220 10% 45% / 65% | `#676f7e` | `#9da3af` | LCP has one secondary level; both names carry it (5.06:1 / 6.0:1 on the card) |
| `--border` | `--border` 220 14% 90% / 0 0% 18% | `#e2e4e9` | `#363636` | dark step follows the lifted card |
| `--border-strong` | — | `#cbcfd7` | `#454545` | ERP-only (secondary button outline) |
| `--border-control` | `--input` 220 14% 90% | **`#878e9b`** | **`#7a7a7a`** | LCP's input hairline is 1.27:1; a control boundary must be ≥ 3:1 (WCAG 1.4.11) |
| `--primary` | `--primary` 24 100% 50% `#FF6600` | **`#f06000`** | `#ff6600` | light: `#FF6600` is 2.94:1 on white (< 3:1 boundary); `#F06000` is the org engine's own `adaptBrand("#FF6600")` (3.30:1 on white, 3.16:1 on the canvas). Dark renders `#FF6600` exactly |
| `--primary-foreground` | `--primary-foreground` 0 0% 100% (white) | `#ffffff` | `#ffffff` | **white, exactly as LCP — owner decision (2026-11-06)**, replacing the earlier INK label. Measured 3.29:1 on `#F06000`, 2.94:1 on `#FF6600`: below AA 4.5:1 for body-size text (light still meets the 3:1 large-text / UI level). `verify:contrast` asserts the pair and reports its ratio; it never counts it as a pass |
| `--primary-hover` | `hover-elevate` overlay (≈ 3% darker / lighter) | `#e65c00` | `#ff7b24` | white measures 3.56:1 / 2.59:1 (reported, floor 2.5:1) |
| `--accent` / `--accent-foreground` | active nav = `bg-primary` / `text-primary-foreground` | `#f06000` / `#ffffff` | `#ff6600` / `#ffffff` | the ERP's marker colour (active tab, selected nav, org "accent") = the LCP primary, with its white label |
| `--accent-ink` / `--link` | `text-primary` | **`#b84900`** | `#ff6600` | orange text on light needs ≥ 4.5 (5.26 on white, 4.72 on the tint) |
| `--accent-tint` | `--primary-soft` 24 100% 95% / 24 60% 15% | `#fff0e5` | `#3d220f` | exact |
| `--focus` | `--ring` = primary | `#f06000` | `#ff6600` | ≥ 3:1 on card and canvas in both modes |
| `--success` / `-bg` | 142 72% 29% · 142 60% 95% / 142 69% 45% · 142 40% 14% | `#157f3c` / `#ebfaf0` | `#24c25e` / `#153220` | exact |
| `--warning` / `-bg` | 32 95% 38% · 43 96% 93% / 43 96% 56% · 36 45% 14% | **`#9f5704`** / `#fef5dc` | `#fbbd23` / `#342714` | LCP light warning is 4.11:1 on white, 3.78:1 on its tint → darkened along its hue |
| `--danger` / `-bg` | 0 84% 60% · 0 86% 96% / same · 0 45% 15% | **`#c52020`** / `#feecec` | **`#f87171`** / `#371515` | LCP `#EF4343`: 3.78:1 on white and under white text, 4.26:1 on the dark card |
| `--danger-foreground` / `-hover` | white | `#ffffff` / `#a71b1b` | `#17173f` / `#f98686` | |
| `--info` / `-bg` | 217 91% 45% · 214 95% 95% / 213 94% 68% · 216 45% 15% | `#0a5adb` / `#e6f1fe` | `#61a6fa` / `#152337` | exact |
| `--corrective` / `-bg` | — | `#5b3fb8` / `#eeeafb` | `#b3a3f5` / `#251d45` | ERP-only status tone, unchanged |
| `--neutral` / `-bg` | status `neutral` = muted | `#676f7e` / `#f3f4f6` | `#9da3af` / `#333333` | |
| `--header-bg` | `--sidebar` 233 28% 14% / 0 0% 13% | `#1a1c2e` | `#212121` | the dark 56px header |
| `--header-ink` | `--sidebar-foreground` 220 20% 98% | `#f9fafb` | `#f9fafb` | |
| `--header-border` | `--sidebar-border` 233 28% 10% / 0 0% 18% | `#121421` | `#2e2e2e` | |
| `--header-accent` | `--sidebar-accent` 233 28% 20% / 0 0% 20% | `#252841` | `#333333` | search field, hover |
| `--chart-navy` | `--chart-2` 233 28% 40% / 60% | `#495083` | `#7c83b6` | |

`--sidebar-bg / -ink / -border / -hover-bg` now point at the card surface tokens: the LCP sidebar is
`bg-card` with a hairline, in both modes. `--brand-navy` (`#1b1b4e`) stays an Elite brand constant.

## 3. Organisation themes

| Stored org theme | What paints | Database |
|---|---|---|
| untouched (column defaults: gradient mode, `#1B1B4E` / `#E87722`, default stops) | stock palette = this map | unchanged |
| single mode, `#1B1B4E` / `#E87722` (the old defaults saved explicitly) | stock palette (it was "default" before too) | unchanged |
| LCP preset (single, `#FF6600` / `#FF6600`, no overrides) — what the panel shows for a default org | stock palette | written only when an owner/admin presses Save |
| any other primary / accent / gradient / override | the engine (`brand-theme.ts`) generates contrast-checked component colours over the LCP neutrals; the stock orange itself (`#F06000` light / `#FF6600` dark) keeps the stock white label, so a preset theme with overrides matches the stock palette instead of flipping to INK | unchanged |

`resolveComponentColors()` returns the stock colours for a default theme, so the Color Theme preview
and its contrast audit show exactly what is painted.

## 4. Typography

| | LCP | ERP |
|---|---|---|
| Latin UI | Inter 400/500/600/700 | Inter via `next/font/google` (self-hosted at build, no binary in the repo) |
| Arabic | — (LCP web is English-only) | IBM Plex Sans Arabic 400/500/600, after Inter in `--font-ui` (bold steps use the 600 face — see deviation 11) |
| Codes / IDs | Menlo | IBM Plex Mono (unchanged ERP rule: codes, IDs, hashes only) |
| Body / controls | `text-sm` 14/20 | `--text-body` and `--text-body-lg` 14/20 (Arabic 24) |
| Labels / meta | `text-xs` 12/16 | `--text-body-sm` 12/16 |
| Form labels | `ui/label` `text-sm font-medium`, foreground | Label primitive (FormField: every long form, settings panel and dialog field) 14/20, 500, `--text`; document editors' compact in-box labels keep the 11px caption |
| Menu items / tabs | `text-sm` | `.row-menu-item` and `.tab` 14px (tabs keep the ERP's 600 on the active tab) |
| Group label | `text-[11px]` semibold uppercase | `--text-caption` 11/16 (Arabic: no case, no tracking) |
| Page title | `text-2xl font-bold tracking-tight` | `--text-display-sm` 24/32, 700, −0.015em |
| KPI value | `text-3xl font-bold tabular-nums` | 24/32 700 in list KPI rows (four across), tabular |
| Numbers | `tabular-nums` | `tabular-nums` on `body` (unchanged) |
| Print / PDF documents | — | **unchanged**: IBM Plex Sans 400/500/600 + IBM Plex Sans Arabic 400/500/600 inside `.print-root` (deviation 12) |

## 5. Shape, elevation, motion, layout

| | LCP | ERP |
|---|---|---|
| Radii | 4 / 6 (controls) / 8 (nav, KPI) / 12 (cards) | same family; `.card` and table cards 12px |
| Shadows | rendered Tailwind v4 scale (`xs`, `sm`, `md`, `lg`) | `--shadow-xs/sm/md/overlay` with the same geometry; deeper colour in dark |
| Motion | 120 / 180 / 280ms, reduced-motion collapses all | `--motion-fast/base/slow`, the existing global reduced-motion rule |
| Header | 56px, `bg-sidebar` | `.topbar` 56px on `--header-bg`, sticky; below 768px (beside the menu trigger) the compact search entry replaces the field, and the organization name truncates — it and the search entry never push the row past the viewport or under EN \| ع (they did from 640 to 767px) |
| Sidebar | 256px / 68px mini, `bg-card border-e`; sheet `w-72` < 768 | same; 768–1023 is forced to the 68px rail (dense ERP tables) |
| Content | `p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto` | `.app-main-inner` 16 / 24 / 32px, max 1280px |
| Dashboard grid | (ERP-only: the LCP has no twelve-track widget grid) | twelve tracks from 1280px (LCP `xl`) beside the expanded 256px sidebar — its spans need a grid of about 950px — and from 1101px beside the 68px rail, as before; two tracks below; one below 641px |
| Controls | `h-9`, 6px radius, `shadow-sm` inputs | 36px, 6px radius; 3:1 control border (above) |
| Status | `ds/StatusBadge`: rounded-full pill, tone tint, 25% tone border, 6px dot | `.status-tag` (registry-driven), same recipe; icon or pulse replaces the dot |
| Overlay | `bg-black/80` (`DialogOverlay`, `SheetOverlay`, and so `CommandDialog`) | dialog, sheet, command-palette and record-search overlays `bg-black/80`, no blur |

## 6. Deviations from the LCP reference (all accessibility- or ERP-driven)

1. *Not a deviation any more — the one accepted contrast exception.* Text on orange fills is white, exactly as in LCP
   (owner decision, 2026-11-06; it was INK `#17173f` until then). It is the only token pair below WCAG AA: 3.29:1 on the
   light `#F06000`, 2.94:1 on `#FF6600`, 3.56 / 2.59:1 on hover, about 2.4 / 2.0:1 under avatar initials on the gradient's
   lighter stop. `verify:contrast` and `verify:lcp-design` assert the pair and report the ratios; the all-routes sweep
   counts these labels separately; the Color Theme panel shows them as low-contrast warnings for the default theme.
2. Light-mode orange fill is `#F06000` (3:1 boundary on white), dark renders `#FF6600`.
3. Orange *text* on light surfaces is `#B84900`.
4. Warning and danger are darkened (light) / lightened (dark) to reach 4.5:1.
5. Control borders are ≥ 3:1 (LCP hairline 1.27:1).
6. Sidebar group labels use full muted ink (LCP's 70% is ≈ 2.8:1).
7. Dark cards `#272727` instead of `#212121` (surface separation ≥ 1.15:1).
8. Tablet 768–1023 uses the 68px rail; the LCP keeps 256px there.
9. Arabic / RTL throughout (LCP web is English / LTR only); Arabic glyphs in IBM Plex Sans Arabic.
10. No LCP logo, favicon, product name or copy anywhere; the brand slot shows the organisation (logo
    or the Elite mark) and "Elite ERP".
11. Arabic keeps its pre-LCP weights 400/500/600: `next/font` family names are global, so a 700 Arabic
    face would also reach the Arabic text of printed / PDF documents (party names at 700, the brand word
    at 800 render with the 600 face today). Arabic page titles and KPI values therefore render 600.
12. Print / PDF output is frozen (master prompt §13: no change to output document appearance). The
    `/print/[type]/[id]` page — the PDF generator's source — keeps the pre-LCP faces: the root layout
    loads IBM Plex Sans 400–600 as `--font-print-raw` (not preloaded) and globals.css declares the type
    families once on `:root, .print-root`, with `.print-root` re-binding `--font-body-raw` to that face.
    The print route's body also keeps the pre-LCP canvas (light `#f5f6f8`, dark `#090b17`): Chromium
    paints the document canvas into the PDF wherever the A4 page does not cover it (measured: a 1px strip
    at the page edge, Δ4 light / Δ17 dark with the LCP canvas, and the second page of long Arabic
    invoices).
    `src/app/print/**` is byte-identical to 83e8093; the base-vs-branch print comparison (48 states:
    16 documents of all nine types × EN light / AR light / EN dark — screen pixels, print-media pixels,
    rasterised PDF pages and PDF text) is in `ERP_LCP_FINAL_HANDOVER.md`.

# DEV-UI-01.7 C5 — Settings

Parent: C4 `a1dbc6e151c19ca30873386d9b2a912cc92328e7` (tree `929745e997439ee5761df2221a6e5986aa723122`),
on C3 `65e12d6`, C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C5 is one commit on C4. Nothing is merged to main.
**DEV-UI-01.7 C6 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Builds are normal, unmocked `next build`s.
Nothing touched production; nothing was deployed; no package, environment or configuration changed.

## Scope — the Settings family

| Route | File(s) (`src/app/(app)/settings/…`) | C5 change |
|---|---|---|
| `/settings/organization` (ten tabs: `?tab=` business-details, logo, color-theme — the default —, default-bank, fiscal-year, vat-config, number-format, team, roles-permissions, zatca) | `organization/page.tsx`; the panels in `organization/company-panels.tsx`, `finance-panel.tsx`, `vat-settings-form.tsx`, `number-format-form.tsx`, `reference-panels.tsx`, `zatca-panel.tsx`, `team/team-panel.tsx`; `src/components/ui/settings-nav.tsx` | a `PageHeader` "Business Settings" (the page had no title, so no h1) above the navigation, outside every tab panel; the `SettingsNav` root `flex flex-col md:flex-row gap-8 items-start` (D-7); each panel title `h3` → `SectionHeader level={2}`; Roles & Permissions' subsection `h4` → `h3`; `SettingsNav` direction-aware, start-aligned, full width below `md` |
| `/settings/team` | `team/page.tsx` | unchanged — still `redirect("/settings/organization?tab=team")`, no page of its own |
| `/settings/presets` (14 tabs) | `presets/page.tsx`; `presets/default-bank-accounts-panel.tsx`, `print-layout-panel.tsx`, `seal-signature-panel.tsx` | `.main-head h3` → `PageHeader` "Presets"; the three panel titles that exist (`h3`) → `SectionHeader level={2}`. Tabs, panels, queries and actions unchanged |
| `/settings/security` | `security/security-client.tsx` | `.main-head h3` + risk pill → `PageHeader` "Security Center", the admin risk pill its `meta`; Two-Factor Authentication / Password `div` → `h2` (same classes); Active Sessions / Security Timeline `.main-head h3` → `SectionHeader level={2}` (Log out all other devices its action, same condition); the Timeline's empty `div` → `EmptyState`; the alerts' `borderLeft` → `borderInlineStart` |
| `/settings/compliance` | `compliance/compliance-client.tsx` | `.main-head h3` → `PageHeader` "Security & Compliance Readiness", the disclaimer (word for word) its description; a `SectionHeader level={2}` "Readiness checklist" over the three groups; the group names `span` → `h3`; Data Subject Rights / Consent Management `div` → `SectionHeader level={2}`; the erase and consent rows `flex-wrap` |

Shared: `src/lib/i18n/dict.ts` — the four Settings navigation labels and the one structural heading (below).
No CSS file changed: the D-7 layout is Tailwind utilities on the existing primitives.

## Changed files

| File | Change |
|---|---|
| `src/components/ui/settings-nav.tsx` | `SettingsNav` a function over `TabsPrimitive.Root` with `dir={dir ?? docDir}` from `useDocumentDir`; `SettingsNavList` `w-full md:w-56 shrink-0`; `SettingsNavItem` `text-start` (was `text-left rtl:text-right`); `SettingsNavContent` `w-full min-w-0 md:flex-1` |
| the 14 Settings page / panel files above | markup only — the static verifier proves each of the 15 C5 files (these and SettingsNav) is C4's code plus exactly its share of C5's 51 hunks (below) |
| `src/lib/i18n/dict.ts` | +5 entries (1,746 → 1,751 keys, no duplicate): Fiscal Year, VAT Configuration, Users, Integrations, Readiness checklist |
| `verify/verify-page-archetypes.mts` | group 13 (C5, 24 checks); groups 6 / 9 / 10 / 12 adjusted to C5's consumers, its two dictionary blocks and the D-6 security pin (below) |
| `verify/page-archetype-pins.json` | consumer inventory only: +18 `SectionHeader`, +1 `EmptyState`, +4 `PageHeader` |
| `verify/verify-page-archetypes-runtime.mjs` | seven new Business Settings routes (54 routes), the C5 targets, the SettingsNav / D-7 facts, the keyboard / Presets / Staff / Timeline / Security-layout / alert / Compliance probes |
| `verify/page-archetype-runtime-baseline.json` | the 14 Settings routes' 112 owner states: the seven new routes' 56 first recorded on C4's build (a1dbc6e, `--rebaseline` adding a named route), then all 112 re-recorded on C5's (376 → 432 owner states); the new routes' 14 Staff and 14 sweep entries (94 → 108 each; the re-record changed none); every other entry, `d6`, `c3ref` and `c4ref` unchanged |
| `verify/page-archetype-actions.json` | 35 lists added for the seven new routes (21 owner + 14 Staff; recorded on C4's build, re-recorded on C5's with only the two Arabic tab names changed); the four existing Arabic Business Settings owner lists changed in exactly those two names; the other 231 of C4's 235 lists untouched (270 now) |
| `tests/ui-baseline/archetype-states.mjs` | six C5 states and two C5 interactions |
| this document | |

Not changed (guarded): every Settings action module (`organization/actions.ts`, `team/actions.ts`,
`presets/actions.ts`, `presets/document-preset-actions.ts`, `presets/exchange-rates-actions.ts`,
`security/actions.ts`, `compliance/actions.ts`), the Security and Compliance server pages
(`security/page.tsx`, `compliance/page.tsx` — their props), `team/page.tsx`, `organization/number-format-panel.tsx`,
Presets' other panels (`simple-preset-panel.tsx`, `bundles-panel.tsx`, `exchange-rates-panel.tsx`,
`note-templates-panel.tsx`, `numbering-panel.tsx`, `terms-groups-panel.tsx`), `src/components/ui/tabs.tsx`,
`src/components/ui/use-document-dir.ts`, the two document pill dialogs that reuse the VAT / Number Format forms,
`src/db/**`, `drizzle/**`, every CSS file, and every P0 / P0.1 / P0.2 verifier — including
`verify/verify-ar-locale-hydration.mjs` with C4's approved selector (`a226b47188ddf478`).

## SettingsNav — the old and new contract

```tsx
// C4
const SettingsNav = TabsPrimitive.Root;
… cn("settings-nav w-56 shrink-0", className)                 // SettingsNavList
… cn("settings-nav-item text-left rtl:text-right", className) // SettingsNavItem
… cn("flex-1 min-w-0", className)                              // SettingsNavContent

// C5
function SettingsNav({ dir, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const docDir = useDocumentDir();
  return <TabsPrimitive.Root dir={dir ?? docDir} {...props} />;
}
… cn("settings-nav w-full md:w-56 shrink-0", className)        // SettingsNavList
… cn("settings-nav-item text-start", className)                // SettingsNavItem
… cn("w-full min-w-0 md:flex-1", className)                    // SettingsNavContent
```

Radix Tabs read the direction from a `DirectionProvider` or their `dir` prop; the app has no provider, so
left to itself the root wrote `dir="ltr"` over the whole Business Settings page in Arabic (measured on C4's
build: `rootDir: "ltr"` on every Arabic state). `useDocumentDir` is the hook the shared `Tabs` primitive has used
since DEV-UI-01.4 — `useSyncExternalStore` over `<html dir>`, `undefined` on the server, so the server markup
and the first client render agree (no React #418) — imported, not copied: it is still defined once in `src`,
and `tabs.tsx` / `use-document-dir.ts` are byte-identical to C4. A caller's own `dir` still wins. Keyboard
behaviour is Radix's own (no handler was added): a vertical list moves with ArrowUp / ArrowDown, Home / End;
ArrowLeft / ArrowRight do nothing.

## D-7 — the navigation above the panel below `md`

The root is `flex flex-col md:flex-row gap-8 items-start`: a column below 768 px, the navigation full width
above the panel; a row from 768 px (Tailwind's `md`, the existing contract), the 224 px navigation at the
inline start and the panel after it. No `Select` replaces the list. Measured (Business Details; root /
navigation / panel widths in px; EN and AR identical but for `dir`):

| Width | C4 (EN; AR the same boxes) | C5 (EN and AR) |
|---|---|---|
| 1440 | row — root 1024 / nav 224 / panel 768, side by side | row — 1024 / 224 / 768, side by side, the nav at the inline start |
| 1024 | row — 910 / 224 / 654 | row — 910 / 224 / 654 |
| 768 | row — 736 / 224 / 480 | row — 736 / 224 / 480 (`md` starts here) |
| 767 | row — 735 / 224 / 479 | **column** — 735 / 735 / 735, the nav above the panel, overflow 0 |
| 390 | row — 366 / 224 / **110** (the panel squeezed to 110 px; the page 80 px wider than the viewport on Business Details in English, 92 on Color Theme, 44 on Team) | **column** — 366 / 366 / 366, the nav above the panel, overflow 0 |

The D-7 probe measures 767 and 768 directly (EN and AR, Business Details): computed `flex-direction`
`column` at 767 and `row` at 768, with exactly these widths, and no overflow on either side. Every Business
Settings state (the ten tabs and `/settings/team`, EN and AR, four widths — 88) passes the same layout check:
side by side with the 224 px navigation from 768 px, stacked with both at the root's width below.

## RTL

Arabic, measured on every Business Settings state:

| | C4 | C5 |
|---|---|---|
| Radix root `dir` | `ltr` (Radix's default, inside an `rtl` document) | `rtl` — the document's |
| navigation side (1440 / 1024 / 768) | the left — the inline **end** of the Arabic page | the right — the inline start; the panel to its left |
| item alignment | `right` (`rtl:text-right`, through the `<html dir>`) inside an LTR box | `start` (`text-start`), direction `rtl` |
| 767 / 390 | still a row — at 390 the panel 110 px wide | a column: the navigation full width above the panel, the panel full width below, nothing clipped, overflow 0 |
| keyboard | — | as in English: Tab reaches the active tab (the only tabbable one); ArrowDown, ArrowDown, ArrowUp → Logo, Color Theme, Logo, each shown with its h2; End → ZATCA, Home → Business Details; ArrowRight / ArrowLeft move nothing (a vertical list — Radix flips only the horizontal arrows in RTL); the focus visible (`outline: auto`); the URL unchanged |

C0's own measure agrees: its "Settings navigation at the inline start" flag was `false` on all 16 Arabic
Business Settings states C4 recorded (the four routes C4 had, every width); C5's baseline has it `true` on all
88 Business Settings states and `false` on none — and the generic check holds it there ("never lost").

Presets' shared `Tabs` already took the document's direction (DEV-UI-01.4): `rtl` in Arabic, unchanged.

## Business Settings

`<PageHeader title={t(locale, "Business Settings")} />` — one h1 ("إعدادات الشركة"), above the navigation,
outside every tab panel, so the page has its title whichever tab shows. Frozen (canonical hashes in group 13):
`SETTINGS_TABS` (the ten values), the default `color-theme`, the `?tab=` reading and its fallback, ZATCA
only for the profiles that enable it (and its fallback to color-theme), the ten `SettingsNavItem`s in order,
each `SettingsNavContent` mapped to its panel as before. No URL is written on a tab change (as in C4). The
server data — the organization, the posted-journal count, the country profile, the bank accounts, the
members — and the `requireRole("owner", "admin")` guard are the pinned ones.

## The four Arabic navigation labels (and the one structural label)

| Key | Arabic | Where |
|---|---|---|
| `Fiscal Year` | السنة المالية | the Finance tab (and the Fiscal Year panel title) |
| `VAT Configuration` | إعدادات ضريبة القيمة المضافة | the Finance tab (and its panel title) |
| `Users` | المستخدمون | the navigation group label |
| `Integrations` | التكاملات | the navigation group label (shown with ZATCA) |
| `Readiness checklist` | قائمة التحقق من الجاهزية | Compliance's structural h2 (below) — the one other entry §26 / §32 allow |

Plain keys, no inline ternaries; no other copy was translated (Gradient, Preset Management, Compliance
Center, the alerts' server-written titles and the rest of the generic translation debt stay deferred).

## Panel-heading inventory (complete)

Every top-level panel title in the C5 files, enumerated before editing — 13 — and the nested headings:

| File | Old element | Title | New | Visible style |
|---|---|---|---|---|
| `organization/company-panels.tsx` | `h3.text-[17px].font-bold` | Business Details | `SectionHeader` h2 | 17 → 16 px (`text-title-sm`), weight 600 as before (the global heading rule), `text-ink` |
| `organization/company-panels.tsx` | `h3.text-[17px].font-bold` | Logo | `SectionHeader` h2 | same |
| `organization/company-panels.tsx` | `h3.text-[17px].font-bold` | Color Theme | `SectionHeader` h2 | same |
| `organization/finance-panel.tsx` | `h3.text-[17px].font-bold` | Default Bank Account | `SectionHeader` h2 | same |
| `organization/finance-panel.tsx` | `h3.text-[17px].font-bold` | Fiscal Year | `SectionHeader` h2 | same |
| `organization/vat-settings-form.tsx` | `h3.text-[17px].font-bold` (behind `heading`) | VAT Configuration | `SectionHeader` h2 (behind `heading`) | same; the document pill dialog still passes `heading={false}` |
| `organization/number-format-form.tsx` | `h3.text-[17px].font-bold` (behind `heading`) | Number Format | `SectionHeader` h2 (behind `heading`) | same; the pill dialog unchanged |
| `team/team-panel.tsx` | `h3.text-[17px].font-bold` | Team | `SectionHeader` h2 | same |
| `organization/reference-panels.tsx` | `h3.text-[17px].font-bold` | Roles & Permissions | `SectionHeader` h2 | same |
| `organization/zatca-panel.tsx` | `h3.text-[17px].font-bold.mb-1` | ZATCA Phase 1 | `SectionHeader` h2, `className="mb-1"` | same |
| `presets/default-bank-accounts-panel.tsx` | `h3.text-[15px].font-bold` | Default Bank Accounts | `SectionHeader` h2 | 15 → 16 px |
| `presets/print-layout-panel.tsx` | `h3.text-[17px].font-bold` | Print Layout | `SectionHeader` h2 | 17 → 16 px |
| `presets/seal-signature-panel.tsx` | `h3.text-[17px].font-bold` | Seal & Signature | `SectionHeader` h2 | 17 → 16 px |
| `organization/reference-panels.tsx` (nested) | `h4.text-[13.5px].font-bold.mb-1` | Actions restricted beyond their module | `h3`, same classes | none (the same rule styles h3 and h4) |

Security and Compliance (section titles, not panels): Two-Factor Authentication, Password — `div.text-[14px].font-bold`
→ `h2`, same classes (700 → 600 by the global heading rule); Active Sessions, Security Timeline —
`.main-head > h3` (15 px inline) → `SectionHeader` h2 (16 px; the `.main-head` margins kept as `mt-2 mb-[22px]` /
`mt-[26px] mb-[22px]`); GDPR, ISO 27001 — roadmap, Platform security — `span.text-[14px].font-bold` → `h3`,
same classes; Data Subject Rights, Consent Management — `div.text-[14px].font-bold.mb-1` → `SectionHeader` h2
(`mb-1`); Readiness checklist — new `SectionHeader` h2 (`mb-3`). Page titles: Presets, Security Center and
Security & Compliance Readiness — `.main-head > h3` (19 px) → `PageHeader` h1; Business Settings — new
`PageHeader` h1. No blanket replacement: each site is one of group 13's 51 hunks. Presets' other panels
(SimplePresetPanel and friends) have no title of their own and were not touched.

## Heading hierarchy

```
/settings/organization?tab=…   h1 Business Settings
                                 h2 <the shown panel's title>          (Business Details | Logo | Color Theme | Default Bank Account | Fiscal Year | VAT Configuration | Number Format | Team | Roles & Permissions | ZATCA Phase 1)
                                   h3 Actions restricted beyond their module   (Roles & Permissions only)
/settings/presets               h1 Presets
                                 h2 Print Layout | Seal & Signature | Default Bank Accounts   (when that tab is open)
/settings/security              h1 Security Center                      [meta: Risk: Low — owner / admin only]
                                 h2 Two-Factor Authentication
                                 h2 Password
                                 h2 Active Sessions                     [action: Log out all other devices — when another session exists]
                                 h2 Security Timeline                   (owner / admin only)
/settings/compliance            h1 Security & Compliance Readiness     [description: the disclaimer]
                                 h2 Readiness checklist
                                   h3 GDPR
                                   h3 ISO 27001 — roadmap
                                   h3 Platform security
                                 h2 Data Subject Rights
                                 h2 Consent Management
/settings/team                  → /settings/organization?tab=team (redirect, unchanged)
```

C4 had no h1 on any Settings page: Business Settings had none at all (its first heading was the panel's
h3), the other three an h3 title.

## Presets

`.main-head h3` → `<PageHeader title={t(locale, "Presets")} />` — the h1 reads "Presets" ("الإعدادات المسبقة"),
not the navigation's "Preset Management" (that mismatch is deferred). The shared `Tabs` (direction-aware
since DEV-UI-01.4, unchanged) with `defaultValue="tax-rates"`; the 14 triggers in their order — Tax Rates,
Payment Terms, Units, Note Templates, Terms & Conditions Groups, Bundles, Numbering, Exchange Rates, Print
Layout, Seal & Signature, Default Bank Accounts, Departments, Product Categories, Leave Types — each with its
panel. The three panels with a title of their own (Print Layout, Seal & Signature, Default Bank Accounts) now
put it in an h2 under the page's h1; SimplePresetPanel and the other panels have none and are byte-identical
(their pointer-only Add controls are deferred). The page's guard and its preset / rate queries are the pinned
ones, every preset action module byte-identical.

## Security Center

* `PageHeader title={t(locale, "Security Center")}`, the risk pill — `{t(locale, "Risk")}: {t(locale, risk.label)}`,
  its `RISK_STYLE` colours and weight 700 unchanged — as `meta`, rendered only for owner / admin as before,
  outside the h1 (the h1 reads "Security Center" alone). Staff see the h1 and the three h2s below, no pill,
  no alerts, no Timeline (measured).
* h2s: Two-Factor Authentication and Password (their cards, icons, Enable / Disable and Change password and
  the password fields as they were); Active Sessions (`SectionHeader`, Log out all other devices its action
  under the same `props.sessions.length > 1` condition, same handler); Security Timeline (`SectionHeader`,
  admin only).
* The Timeline with no event: `EmptyState message={t(locale, "No security events yet.")}` — no hint, no
  action. The page's window is SQL `now() - interval '30 days'` (the database's clock), so in the TEST-only
  copy — events stamped at the frozen instant — the window is empty (counted: 0) and the EmptyState shows.
  With events, the same table as before.
* `fmtDateTime` (P0.1's explicit `timeZone: "UTC"`) and `RISK_STYLE` canonical-hash-identical to C4; the
  admin attack-stat row (D-6's bare `.stat-row-2`, weight 800 KPI values) untouched.
* The alerts: `borderLeft: 3px solid …` → `borderInlineStart: 3px solid …`, the same severity expression
  (`var(--crit)` for high / critical, `var(--warn)` otherwise) — the only physical-direction fix. Measured with
  a fixture (five failed logins for an org registered through the UI in the run's TEST-only copy; the
  seeded org untouched, `security_events` being append-only): "Repeated failed logins", the declaration on
  `border-inline-start`, no physical border; the side it governs is the inline start — left in English, right
  in Arabic — with the card's own 1px line on the other side; the risk "Elevated" in the meta.
  **Found, not fixed:** `--warn`, `--crit` (and `--good`, `--warn-bg`, `--crit-bg`, `--good-bg`) are defined in
  no stylesheet — only these two Settings clients use them — so `3px solid var(--warn)` is invalid at
  computed-value time: the inline-start border computes to `0px` and no stripe paints, exactly as C4's
  `border-left` did not (measured on C4's build: its left border `0px` in both directions). The same undefined
  tokens are why `RISK_STYLE`'s pill has no colour of its own. Defining or replacing them is the deferred
  `RISK_STYLE` migration (DEV-UI-01.8), which should cover this stripe too.

## Security & Compliance Readiness

* `PageHeader title={t(locale, "Security & Compliance Readiness")}` — the existing title (not the navigation's
  "Compliance Center": deferred) — with the existing disclaimer, word for word and still one string in the
  file, as its description: "An internal checklist of what this build implements. It is not a certification:
  no external audit has been carried out, and no framework compliance is claimed."
* The three readiness groups needed an h2 parent and the page had no existing readiness phrase that was not
  the title itself or a claim, so C5 added exactly one neutral structural label, `Readiness checklist`
  ("قائمة التحقق من الجاهزية") — no certification, no "compliant", no score. Under it the group names are real
  h3s — GDPR, ISO 27001 — roadmap, Platform security — with their notes outside the headings.
* Data Subject Rights and Consent Management: `SectionHeader level={2}` (`mb-1`), their descriptions and
  controls as they were.
* `fmtDate` (P0.1's explicit UTC), `groupsFor` (the groups, notes, controls and their states, the live
  field-encryption and audit-trigger detection), `ControlState`, `STATE_LABEL` and `CONSENT_SUBJECTS`
  canonical-hash-identical to C4; the server page (its props) byte-identical.
* 390 px: C4 overflowed 32 px in English — the erase row (customer `Select` `min-w-[220px]` + Erase) and the
  consent row (subject `Select` + Grant + Withdraw) were non-wrapping `flex` rows. Both are now
  `flex flex-wrap items-end gap-2` (the consent row keeps `mb-4`): 0 px in both languages at every width; the
  six controls inside the viewport at 1440, 768 and 390; the customer list opens and closes; a consent
  granted at 390 (deleted after) lists in a table inside its card.

## Team — redirect and panel

`/settings/team` is byte-identical: `redirect("/settings/organization?tab=team")`, no PageHeader of its own;
measured, it lands on `/settings/organization?tab=team` (200) for the owner, EN and AR at every width, and
Staff land on `/dashboard` as before. The Team panel's title is an h2 under "Business Settings"; nothing else
in it changed — its action row needed no fix: C4's 44 px overflow at 390 came from the navigation beside it,
and with D-7 the Team tab is 0 px at every width.

## Permissions, data and actions — invariants

`verify/page-archetype-pins.json` is unchanged in every category but `consumers`; group 13 holds the
Settings pages to it:

| Page | Guard (pinned) | Server data (pinned sections) | Static action inventory (pinned) |
|---|---|---|---|
| `settings/organization/page.tsx` | `requireRole("owner", "admin")`; `currentUserRole={session.role}` to the Team panel | `SETTINGS_TABS`, the params, session, locale, the organization, the posted-journal count, the country profile / `showZatca`, the tab fallbacks, the bank accounts, the members | the 11 actions: `updateBusinessDetailsAction`, `uploadLogoAction`, `updateColorThemeAction`, `updateDefaultBankAccountAction`, `updateFiscalYearAction`, `updateVatConfigAction`, `updateNumberFormatAction`, `enableZatcaPhase1Action`, `addTeamMemberAction`, `changeRoleAction`, `toggleMemberActiveAction` |
| `settings/presets/page.tsx` | `requireRole("owner", "admin")` | the preset datasets (tax presets, payment terms, units, departments, product categories, leave types, note templates, terms groups, bundles and their items, products, numbering sequences), the bank / GL accounts, the org and seal assets, the rate history and fetch attempt (`fireEnsureFreshRates` after the response), the latest rates and attribution | the 39 preset create / update / delete actions, as pinned |
| `settings/security/page.tsx` | `requireSession()`; `isAdmin = owner \|\| admin` | MFA state, password date, the org MFA policy, active sessions; for admins the 30-day events, alerts, stats | `beginMfaSetupAction`, `confirmMfaAction`, `disableMfaAction`, `changePasswordAction`, `terminateSessionAction`, `logoutAllOtherSessionsAction` |
| `settings/compliance/page.tsx` | `requireRole("owner", "admin")` | consents (50), customers (500), field-encryption and audit-trigger state | `exportOrgDataAction`, `anonymizeCustomerAction`, `recordConsentAction`, `deleteConsentAction` |
| `settings/team/page.tsx` | `redirect("/settings/organization?tab=team")` | — | the redirect target |

The seven Settings action modules keep their business pins (`organization/actions.ts` `b18877690cebd342`,
`team/actions.ts` `e4f5dfbcbb16b82a`, `presets/actions.ts` `e17b0608fb3a5170`,
`presets/document-preset-actions.ts` `59b89a81ac4ed22c`, `presets/exchange-rates-actions.ts`
`cfd3497081304e0a`, `security/actions.ts` `d4fc9703c67456c1`, `compliance/actions.ts` `6c9bc6033eb1e75f`).
No database write path, schema, migration or storage code changed.

Measured (C4's build → C5's, EN and AR): the owner opens all 14 Settings routes (200; `/settings/team` →
`?tab=team`); Staff are sent to `/dashboard` from every Business Settings route, `/settings/team`, Presets and
Compliance, exactly as before, and open the Security Center — h1, Two-Factor Authentication, Password, Active
Sessions; no risk pill, no alert, no Timeline (the admin-only parts, as in C4). The Staff action lists are
identical. Staff gained nothing.

## P0 / P0.1 / P0.2

Not modified: `verify/verify-ar-locale-hydration.mjs` (C4's approved selector
`[data-slot="page-header-actions"] button`, sha256 prefix `a226b47188ddf478`), `verify-number-locale.mts`,
`verify-date-timezone.mts`, `verify-business-dates.mts`, `verify-settings-timezone-hydration.mjs`,
`verify-business-date-hydration.mjs` — group 13 pins all six by hash (and group 12 still pins the P0 suite).
The two explicit-UTC formatters P0.1 put into Settings — Security's `fmtDateTime`, Compliance's `fmtDate` —
are canonical-hash-pinned; the P0.1 browser suite reads exactly those pages and passes (below).

## Action inventory (C4 → C5)

Measured — every link, button, tab, menu trigger and toggle in `<main>`: kind, visible name, target, type,
disabled, selected / pressed / current — for the owner (EN and AR at 1440, EN at 390) and for Staff (EN and
AR at 1440), on the 14 Settings routes, C4's build against C5's. The only differences, all intended:

| Lists | Change |
|---|---|
| owner, AR, 1440 — the 11 Business Settings routes (the ten tabs and `/settings/team`) | `tab "Fiscal Year"` → `tab "السنة المالية"`, `tab "VAT Configuration"` → `tab "إعدادات ضريبة القيمة المضافة"` (the dictionary entries C5 added; the selected one stays selected on its own tab) |

Nothing else: no action added, removed, duplicated or retargeted; no type, disabled or selected state
changed; the English lists, the 390 lists, Presets (its 14 tabs, Add Tax Preset, the rows' Edit / Delete),
Security (Enable MFA, Change password — disabled until both fields are filled — and the session's End; Log
out all other devices under the same more-than-one-session condition, absent with the seed's one session as
in C4), Compliance (Export organization data, the customer select, Erase, the consent subject, Grant,
Withdraw) and every Staff list identical. Unexplained delta: 0. The runtime's re-record rule names these
two renames exactly — from exactly the English key to exactly the new Arabic, on Business Settings routes,
in Arabic only — alongside C1's page copy, C2's / C3's added controls and C4's states; any other change
fails it.

## Static verifier — `verify:page-archetypes` group 13 (C5)

24 checks (188 in all; groups 1–12 unchanged in strength):

* **Hunk reversal.** Each of the 15 C5 files is C4's code plus exactly C5's 51 hunks
  (`[C4 code, C5 code]` pairs, compared without comments or whitespace): undo them and every file hashes to
  its C4 flat hash. Per file: SettingsNav 5, Business Settings 2, company panels 4, finance panel 3, VAT form
  2, Number Format form 2, Roles & Permissions 3, ZATCA 2, Team 2, Presets 2, Presets' Default Bank Accounts
  2, Print Layout 2, Seal & Signature 2, Security 10, Compliance 8. A form, field, query, save action, permission,
  tab value, MFA / password / session control, readiness claim or consent control cannot change unseen.
* **Dictionary.** C5's change to `dict.ts` is exactly its two blocks (undone, the file is C4's to the byte);
  the five Arabic values pinned; English unchanged.
* **SettingsNav.** A function, not the alias; `useDocumentDir` imported from `./use-document-dir`;
  `dir={dir ?? docDir}`; no other direction source; `text-start`, no `text-left` / `text-right` / `rtl:`;
  `w-full md:w-56 shrink-0` and `w-full min-w-0 md:flex-1`; no physical left / right. `tabs.tsx` and
  `use-document-dir.ts` byte-pinned; `useDocumentDir` defined once in `src`.
* **Business Settings.** One `PageHeader` (title only) right before `SettingsNav`; the root's classes,
  orientation and `defaultValue`; `SETTINGS_TABS` (canonical hash), the default, the `?tab=` and ZATCA
  fallbacks, the ten items in order, the panels mapped to them, ZATCA gated.
* **Headings.** The 13 panel titles each one `SectionHeader level={2}` with its own words, no old h3 title
  or `.main-head` left; the Roles subsection an h3 (no h4 left); VAT / Number Format titles behind
  `heading`, the two pill dialogs byte-identical.
* **Presets / Security / Compliance.** Presets' header, Tabs, default and 14 triggers / panels; Security's
  header + meta, the four h2s (Log out all's condition and handler), the EmptyState, `fmtDateTime` /
  `RISK_STYLE` canonical, the stripe declared on `border-inline-start`, no `borderLeft` / `borderRight`, the
  bare `.stat-row-2`; Compliance's header + disclaimer (one copy), the outline, the two wrapping rows,
  `fmtDate` / `groupsFor` / `STATE_LABEL` / `CONSENT_SUBJECTS` canonical.
* **Everything else.** The other ten Settings files byte-pinned (both server pages, the redirect, Presets'
  other panels, the Number Format wrapper) and every Settings file accounted for; the four pages' guards,
  data sections and static action inventories equal the pins, the seven action modules their business
  pins; the six P0 / P0.1 / P0.2 verifiers hashed; no Settings abstraction (`SettingsLayout`,
  `SettingsShell`, `SettingsPageLayout`, `SettingsPanel`, `SettingsSection`, `SettingsHeader`,
  `SettingsContainer`; no layout / template under `/settings`); no physical left / right added (the only
  ones in a C5 file are C4's, deferred).

Earlier groups, adjusted to C5 without loosening: group 6's consumer lists gain C5's 18 `SectionHeader`
and 1 `EmptyState` uses; group 9's PageHeader count 29 → 33 (the four Settings pages); group 10's D-6 byte
pin hands Security's client to group 13 (C4's code plus C5's hunks, its stat row untouched — the other
eight D-6 sources stay byte-identical to C1); group 12's dictionary pin compares `dict.ts` with C5's two
blocks undone (still C4's to the byte). `verify/page-archetype-pins.json` changed in its consumer inventory
only (`--write-pins`; every route, guard, data, action, business and P0 pin identical).

## Runtime (C4 → C5)

`verify/verify-page-archetypes-runtime.mjs`, its own TEST-only database, production builds:

1. **C4's build** (wt at exactly a1dbc6e, build `af6N219DkGqublWYTE63l`), C5's verifier,
   `--rebaseline=<the seven new routes>`: their 56 owner states, 14 Staff, 14 sweep entries and 35 action
   lists recorded — every other route kept as pinned. On that build every C5 target fails, as it must:
   Arabic Radix root `ltr`, the navigation at the inline end, a row at 767 and 390 (the panel 110 px at
   390), no h1, h3 titles, Compliance 32 px over at 390, the alert's border on the physical left.
2. **C5's build** (`0kyHFTjXs2FJdZXhkueWd`), `--rebaseline=<the 14 Settings routes>`: 112 owner states, 28
   Staff, 28 sweep, 70 action lists re-recorded; 118/118 — every never-worse measure held against C4's
   record, route behaviour and direction the same, the 28 outline changes listed for review (all of them the
   intended h1 / h2 / h3 above), the action changes exactly the two Arabic tab names. A second run from the
   same C4 baseline wrote the same files byte for byte.
3. **The final tree** (`wt-final`, its own fresh normal build `JyP8E1seKY5-OuIUnWYWT`): **117/117** — 54
   routes, 432 owner states, 108 Staff, 108 sweep, every baseline state measured; route behaviour, direction
   and outlines as the baseline; every never-worse measure held; zero React #418 across all 648 measured
   states; the owner (1,629 actions) and Staff (1,050) inventories unchanged; Staff sent to `/dashboard` from
   Payroll, Business Settings, Presets and Compliance (and `/settings/team`), opening every other route; the
   C1 (7), C2 (14), C3 (20), C4 (17, the value pass and the ledger / chart gate among them), D-2 (3), D-6
   (10) and C5 (17) targets all green. (A `--rebaseline` run has one more check — the re-record's action
   equivalence, 118/118 above.)

C4 → C5 on the 14 Settings routes × EN / AR × 1440 / 1024 / 768 / 390 (112 states; h1 / skips / overflow px
/ offenders / tables past the viewport / unnamed / pointer-only / errors / Arabic-Indic digits):

| Route (worst state of its 8) | C4 | C5 (every state) |
|---|---|---|
| Business Settings — Color Theme (the default) | 0 / 0 / **92** (EN 390) / 16 / 0 / 12 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 12 / 0 / 0 / 0 |
| — Business Details | 0 / 0 / **80** (EN 390) / 6 / 0 / 2 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 2 / 0 / 0 / 0 |
| — Logo (new) | 0 / 0 / **15** (EN 390) / 1 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — Default Bank Account (new) | 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — Fiscal Year (new) | 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — VAT Configuration (new) | 0 / 0 / **69** (EN 390) / 1 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — Number Format (new) | 0 / 0 / **69** (EN 390) / 2 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — Team, and `/settings/team` | 0 / 0 / **44** (EN 390) / 1 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — Roles & Permissions (new) | 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| — ZATCA Phase 1 (new) | 0 / 0 / **63** (EN 390) / 2 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| Presets | 0 / 0 / 0 / 0 / 0 / 0 / 1 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 1 / 0 / 0 |
| Security Center | 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| Security & Compliance Readiness | 0 / 0 / **32** (EN 390) / 1 / 0 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0 |

(In Arabic C4's page overflow read 0 only because its LTR row overflowed on the right — the RTL page's start
side, which does not scroll — so the content there was clipped, unreachable: up to 16 elements past the
viewport on Color Theme. C5 has none in either language.)

Nothing grew anywhere; the unnamed (12 colour / hex inputs, 2 on Business Details) and pointer-only
(Presets' Add) counts are C4's, deferred. Staff land where they did — `/dashboard` from Business Settings,
`/settings/team`, Presets and Compliance; `/settings/security` itself — EN and AR; the Staff action lists are
unchanged.

C5's blocking targets (all green on the final run): the 14 routes measured (112 states, seven new); every
route 200 where it is, `/settings/team` landing on `?tab=team`; one PageHeader holding the only h1 on every
state, the title at the inline start, nothing overlapping it; every outline exact and in the dictionary's
words, no skip; overflow, offenders and tables past the viewport 0 on every state; zero console errors, page
errors and React #418; Western digits; Security's risk pill the PageHeader's meta ("Risk: Low"), not in the h1;
SettingsNav on all 88 Business Settings states; the D-7 767 / 768 probe; the keyboard probe (EN / AR at 1440
and 390); Presets (14 tabs, three titled panels; EN / AR at 1440 and 390); Security as Staff; the Timeline's
EmptyState (0 events in the window); the Security layout at 1440 / 768 / 390 (header and meta, both cards,
their controls, the password fields — the current one focusable — the sessions table, the Timeline, all inside
the viewport); the alert fixture; Compliance at 1440 / 768 / 390 (all six controls inside the viewport, the
customer list opening and closing, a consent granted at 390 listed inside its card and deleted after). The C1,
C2, C3, C4 and D-6 targets and the C4 value pass stay green.

## Screenshots

Same harness, frozen clock, seed, TEST-only database and pinned Chromium as every earlier stage; no masking,
no injected CSS. The before reference is a fresh capture of exactly a1dbc6e (its own build
`af6N219DkGqublWYTE63l`) with C5's harness minus C5's two interactions (C4 cannot do them); it reproduces
C4's own approved final captures **byte for byte — all 950 states they share**. C5's captures reuse the
final runtime run's build `JyP8E1seKY5-OuIUnWYWT`.

C5 adds to the archetype set (`tests/ui-baseline/archetype-states.mjs`): Business Settings on Color Theme (its
default tab), Team, Fiscal Year and VAT Configuration, Presets and Security & Compliance Readiness — EN + AR
at 1440 and 390, full page (24; Business Details and the Security Center are already captured at every
width) — and two interactions (6), viewport screenshots, each failing the capture unless the page does it:
the Settings navigation by keyboard (Tab to the active tab, ArrowDown: Logo focused, the only selected and
tabbable tab, its panel shown, the focus ring visible, Radix's `dir` the document's, stacked below 768 px,
the URL unchanged; EN / AR at 1440 and 390), and Compliance at 390 (Tab to the customer select: the six
controls of the two cards inside the viewport, no overflow; EN / AR).

| Set | States | Byte-identical to C4 | Different | Which |
|---|---|---|---|---|
| 256-state matrix | 256 | 240 | 16 | `settings-organization` (its 16 states) |
| shell | 44 | 44 | 0 | — |
| lists | 210 | 210 | 0 | — |
| documents (the VAT / Number Format pill dialogs among them) | 134 | 134 | 0 | — |
| archetypes | 336 | 286 | 50 | Business Details (10), Security Center (10), the six C5 states (24), and the C5 interactions (6, new) |
| **all** | **980** | **914** | **66** | every one a Settings state C5 owns; **every non-Settings state byte-identical** |

What the Settings differences show: the h1 above each Settings page; in Arabic the navigation on the right
and the panel laid out right to left (C4: an LTR block — the navigation on the left, the form mirrored the
wrong way — inside the Arabic page), the four labels in Arabic; at 390 the navigation full width above the
panel (C4: the panel squeezed to 110 px beside it, the page wider than the screen); the panel titles in the
`SectionHeader` style; the Security and Compliance hierarchy; Compliance's rows wrapped. One consequence of
the right direction is visible: Latin and numeric values inside Arabic inputs now follow the document's bidi
like the app's other Arabic forms (the phone reads `0000 000 11 966+`, an address's leading number moves to
the end; only the column-formula fields and the rich-text editor set a direction of their own) — C5 did not
add `dir="auto"` / `dir="ltr"` to those fields (an app-wide input question, deferred).

## Mutations

Static (`verify:page-archetypes`, a mutation worktree synced to the final tree, each edit applied alone and
restored): **68/68 caught** — the brief's 44 (§52, in its order) 44/44, 22 extra 22/22, 2 P0 pins 2/2; the
worktree back to exactly the C5 change set afterwards:

| # | Mutation | Caught by |
|---|---|---|
| 1–4 | SettingsNav back to the raw alias; `dir` removed; `dir="ltr"`; `useDocumentDir` removed | the SettingsNav contract + hunk reversal |
| 5–8 | `text-left` back; the list loses `w-full`; the root a row at 390; the breakpoint moved to `lg` | item / width checks, Business Settings root, hunk reversal |
| 9–10 | Business Settings h1 removed; its title changed | the Business Settings PageHeader check |
| 11–14 | each of the four Arabic labels removed | the dictionary block + Arabic checks (and group 12's byte pin) |
| 15–17 | a tab value; the default tab; the ZATCA gating | the tabs check (canonical `SETTINGS_TABS`, fallbacks, items / panels); 16–17 also C0's server-data pins |
| 18 | the `/settings/team` redirect | C0's guard snapshot and its redirect check, the data pins, C5's untouched-files and guards checks |
| 19–20 | Presets title back to an h3; two tabs swapped | the Presets check |
| 21 | a panel h2 back to an h3 (Fiscal Year) | the panel-title check |
| 22–28 | Security title an h3; the risk pill inside the h1; a Security h2 a div; the Timeline EmptyState reverted; `fmtDateTime` without UTC; `RISK_STYLE` changed; `borderLeft` back | the Security header / outline / Timeline / frozen checks |
| 29–33 | Compliance h1 an h3; the disclaimer reworded; a group h3 a span; Data Subject Rights / Consent Management h2s removed | the Compliance header / outline checks |
| 34 | the nested Roles heading at the wrong level — back to h4 (a skip under its h2) | the nested-headings check (see "Decisions" — the literal "h4 → h3" is C5's intended change) |
| 35–37 | the consent row stops wrapping; `fmtDate` without UTC; a `groupsFor` claim reworded | the Compliance 390 / frozen checks |
| 38, 40 | the compliance / organization action module touched | C0's business pins (57 files) and C5's action-module check |
| 39 | Compliance opened to Staff (`requireRole(…, "staff")`) | C0's guard snapshot and its owner / admin check, the data pins, C5's guards check |
| 41 | the C4 P0 suite's selector reverted | the P0 hash pins (groups 12 and 13) |
| 42–44 | C4 `.acct-grid` loses `minmax`; C3 task card back to a div; C2 D-6 four across at 640 | groups 12, 11, 10 |
| X01–X22 | the Roles heading promoted to h2; `SettingsNavContent` loses `min-w-0`; `md:w-56` → `lg:w-56`; a local `useDocumentDir`; a sixth dictionary entry; the readiness label's Arabic changed; `SETTINGS_TABS` without zatca; Presets' default tab; a Presets tab removed; the risk pill for everyone; Log out all with one session; the Timeline h2 back; the readiness h2 removed; the erase row unwrapped; a pill dialog showing its VAT heading; a physical utility added; `tabs.tsx` touched; SimplePresetPanel touched; the Security server page touched; a `SettingsSection` abstraction; the Team h2 back; the alert colour changed | each by its check |
| P01–P02 | the P0 selector broadened to the whole PageHeader; the P0.1 suite touched | the P0 hash pins |

Runtime (`--only=settings`, the mutation worktree rebuilt normally for each, each edit restored after):
**7/7 caught**; the worktree back to exactly the C5 change set afterwards.

| Mutation (§52) | Build | Result | Caught by |
|---|---|---|---|
| RT1 — Settings `dir="ltr"` in Arabic (`dir={dir ?? docDir}` → `dir="ltr"`) | `i-zbFN4y2eTH9Mpmnwg3x` | 114/117 | C0's "navigation at the inline start never lost" (33 states), C5 SettingsNav, C5 D-7 |
| RT2 — mobile Settings forced to a row (`flex flex-row`) | `HY_RU1lysjy0UZNYLUjfB` | 109/117 | overflow (up to 200 px at 390), overflowing elements, tables past the viewport, outlines (the panel's h2 off screen), C5 overflow / outline / SettingsNav / D-7 |
| RT3 — SettingsNav loses its full width (`w-full md:w-56` → `w-56`) | `rG3mOAwSJp2a2nQQBod3t` | 115/117 | C5 SettingsNav, C5 D-7 |
| RT4 — the Compliance consent row stops wrapping | `OsZX47bX_TUMkxC5giATB` | 113/117 | overflow (32 px EN 390), overflowing elements, C5 overflow, C5 Compliance |
| RT5 — a second h1 (Data Subject Rights as an h1) | `Xiuzj6Zhyzg0AIG0vkRMz` | 113/117 | outlines, "one h1 per page", C5 PageHeader / outline |
| RT6 — Staff given Compliance (`requireRole(…, "staff")`) | `NNpG5qzInigeIzbmpBJcD` | 114/117 | Staff landing (`/dashboard` → `/settings/compliance`), "Staff are sent to /dashboard …", the Staff action inventory |
| RT7 — an injected console error (Security client) | `RaffRcbwQ38YGQM3l3ZUz` | 109/117 | console errors never more, the sweep, C5 errors and every Security probe (Staff, Timeline, layout, alert), D-6's error check |

## Previous gates

All on the final tree (`git diff` of everything but this document identical in the main checkout and every
worktree used: `5437d99dc72553ba`):

* `verify:page-archetypes` **188/188** — C0's groups 1–8 (routes 4, guards 6, server data 2, business 2,
  P0 / P0.1 / P0.2 contracts 15, primitives 44, abstraction creep 3, static action inventory 2), C1 19/19,
  C2 13/13, C3 26/26, C4 28/28 (its P0 pin `a226b47188ddf478` unchanged), C5 24/24.
* `verify:static` exit 0 — role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89,
  contrast 161/161, typography 43/43, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69,
  document form 76/76, edit-action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26,
  money precision 12/12, **number-locale (P0) 29/29, date-timezone (P0.1) 38/38, business-dates (P0.2)
  44/44**, ledger-only balances 8/8, page archetypes 188/188.
* `verify:server` exit 0 (TEST-only database, no `.env`) — the 23 suites (statements 70/70, project costing
  50/50, docs import 339/339, exchange rates 57/57, … bank opening backfill 31/31) and DB hardening (both
  append-only triggers present).
* `tsc --noEmit` exit 0; ESLint `--max-warnings=0` on the 19 changed code files: clean; dictionary 1,751
  keys, no duplicate.
* Browser tier (`verify/run-browser-suites.mjs`, its own fresh normal build `FZPuORva2LkBwrZqBuDK8` of the
  same source — `src` diff `d0e6425678f4e3b9` — a TEST-only database, no repository `.env`): **49/49** —
  among them P0 `verify-ar-locale-hydration.mjs` **169/169**, P0.1 `verify-settings-timezone-hydration.mjs`
  **85/85** (the Security Center and Compliance dates), P0.2 `verify-business-date-hydration.mjs`
  **108/108**, shell 341/341, controls 302/302, DataTable 130/130, document form 188/188, edit e2e 218/218,
  advances 172/172, FX posting 108/108, staff 20/20, and the Settings-facing suites `verify-color-theme`,
  `verify-compliance-claims`, `verify-preset-zatca`, `verify-staff-runtime` — and, run directly on that build
  for their full output, P0 169/169, P0.1 85/85, P0.2 108/108 again.
* C1–C4: their runtime targets (C1 7, C2 14, C3 20, C4 17 — the value pass and the ledger / chart gate
  among them — D-2 3, D-6 10) are green in the final runtime run; no C1–C4 source file changed (group 13's file accounting, groups
  9–12's pins).
* The C4 P0 selector maintenance is untouched: `verify/verify-ar-locale-hydration.mjs` is byte-identical to
  C4 (`[data-slot="page-header-actions"] button`, `a226b47188ddf478`).

## Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack), each fresh from the C5 source (`src` diff
`d0e6425678f4e3b9`): `JyP8E1seKY5-OuIUnWYWT` (the final runtime run and every C5 screenshot),
`FZPuORva2LkBwrZqBuDK8` (the browser tier and the three hydration suites), `0kyHFTjXs2FJdZXhkueWd` (the
Settings re-record), plus one per runtime mutation. The C4 reference build `af6N219DkGqublWYTE63l` (exact
a1dbc6e) recorded the seven new routes and the C4 screenshots. No font mocks, no
`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, no package, Next config, environment, server or deployment change.

## Decisions where the brief's premise did not hold

1. **"Actions restricted beyond their module" (§28, §52.34).** The brief expects this nested heading in
   Compliance, as an h4. It is not in Compliance: it is the subsection of Roles & Permissions
   (`organization/reference-panels.tsx`), where C4 had it as an `h4` under the panel's `h3`. With the panel
   title now an h2 (§11), an h4 would skip a level — a blocking runtime failure (§47) — so C5 made it an `h3`:
   one level below its panel, as it was ("nested subsections remain nested", §11), wording, classes and
   table unchanged. The mutation suite therefore guards the wrong levels for this heading — back to h4 (a
   skip) and promoted to h2 — instead of the literal "h4 becomes h3", which is C5's intended change.
2. **The readiness parent h2 (§26).** No existing phrase fitted (the only candidates were the page title
   and the disclaimer), so C5 added exactly one neutral key, `Readiness checklist` — the single copy
   exception §32 allows — and put the disclaimer in the PageHeader's description.
3. **The alert stripe (§23).** The physical → logical fix is made and proven on its own terms (the declared
   property, the side it governs in each direction). The stripe's colour tokens are undefined (above), so
   no stripe paints, as in C4; C5 does not define them (that is the deferred `RISK_STYLE` migration) and
   reports it.
4. **Team's action row (§14).** No change was needed: the overflow was the navigation's (D-7 fixed it).

## Deferred (not C5)

* Settings "Gradient" wording / debt (DEV-UI-01.8).
* The 12 colour / hex inputs without an accessible name (Color Theme; still recorded, 12 per state) and
  Business Details' 2 unnamed controls — as recorded since C0, not lowered.
* `RISK_STYLE` migration — and with it the undefined `--warn` / `--crit` / `--good` (+ `-bg`) tokens, which
  leave the risk pill uncoloured and the alerts' severity stripe unpainted.
* Security KPI weight 800 and the generic weight-800 sweep.
* Presets' pointer-only Add controls (SimplePresetPanel; 1 pointer-only per Presets state).
* Title / navigation mismatches: Presets vs "Preset Management"; Security & Compliance Readiness vs
  "Compliance Center".
* Generic translation debt — among it the alerts' server-written English titles ("Repeated failed logins")
  and other Settings copy C5 was not allowed to translate.
* Settings URL tab synchronisation (`?tab=` is read, never written).
* Direction of Latin / numeric values in Arabic inputs (phone, VAT number, addresses): they follow the
  document's bidi, as on the app's other Arabic forms; whether such fields take `dir="auto"` is an app-wide
  input decision.
* Compliance's consent subjects show their raw keys in English (`privacy_policy`, …; Arabic has words for
  them) — `CONSENT_SUBJECTS` is frozen (§31).
* Physical utilities C5 did not own: Color Theme's cards (`text-left`, the check mark at `right-3`) and
  Print Layout's options (`text-left` ×2).
* `.settings-nav-item` has no `:focus-visible` style of its own: the focus ring is the browser's default
  outline (`auto`), visible on every focused tab (measured).

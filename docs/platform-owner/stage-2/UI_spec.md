# Elite ERP — Platform Owner UI Specification
## Stage 2 · New LCP-Inspired Design System

**Version:** 1.0 · **Date:** 2026-11-06 · **Status:** Proposed production specification; Stage 2 HTML remains a demo.  
**Prototype:** `Elite_ERP_Platform_Owner_Stage2_Interactive.html`  
**Design reference:** `Elite-ERP-LCP-Design-System-Ready-Kit(1).zip` / LCP **web** screenshots, design tokens and implementation guide.  
**Owner override:** **Text on orange-filled surfaces must always be white, in every theme and state.**

## 1. Visual language and inheritance

This specification supersedes the previous Navy Command look **for visuals only**. It does not authorize changes to ERP data models, tenancy, accounting, access control or invoice/PDF output. The Platform Owner console retains the **Elite ERP** brand, not Lead Capture Pro branding. Use the same visual token adapter being developed for the customer ERP; do not create a competing independent theme engine or paste the LCP raw-HSL CSS into ERP's typed `@property` tokens.

### 1.1 Color contract

| Token / context | Light | Dark | Notes |
|---|---|---|---|
| `brand.orange` | `#FF6600` | `#FF6600` | Canonical visual identity, line/indicator/ring/illustration. From LCP web, not Expo `#FF6B00`. |
| `brand.orangeText` | `#FFFFFF` | `#FFFFFF` | **Mandatory on orange-filled buttons, navigation, chips and controls.** |
| `action.orangeAccessible` | `#C95000` candidate | Same or separately AA-validated variant | For ordinary white action text; verify contrast ≥4.5:1 before release. Keep recognizable orange. |
| `canvas` | `#F9FAFB` | `#1A1A1A` | Page background. |
| `surface.card` | `#FFFFFF` | `#212121` | Cards, detail sheets, popovers. |
| `surface.secondary` | `#F3F4F6` | `#2E2E2E` | Row hover/secondary panels. |
| `content.primary` | `#212121` | `#F9FAFB` | Body text. |
| `content.muted` | `#676F7E` | `#9DA3AF` | Captions/help/table headers. |
| `border` | `#E2E4E9` | `#343434` or validated kit equivalent | Consistent 1px boundaries. |
| `header` | `#1A1C2E` | `#212121` | 56px top frame. |
| `header.text` | `#F9FAFB` | `#F9FAFB` | Contrast against dark header. |
| Success / warning / danger / info | Soft semantic foreground and tint | Dark semantic foreground and tint | Account and subscription statuses never rely on color alone. |

**Contrast conflict resolution:** exact `#FF6600` with white text is about 2.94:1 and fails WCAG AA for normal body text. Since the owner requires **white** text, never solve this by using black text on orange. Instead, choose a darker orange fill for text-bearing interactive components, e.g. `#C95000` after actual computed contrast verification, while `#FF6600` remains the brand accent. Record both tokens in the CSS and tests. No white text on light/orange-tinted backgrounds unless that background is an appropriately dark orange.

### 1.2 Geometry, typography, spacing

| Element | Target |
|---|---|
| Global header | 56px fixed/sticky with logo, global search, optional quick action, locale/theme/account menu. |
| Desktop sidebar | 256px wide, light/card surface, grouped: Workspace / Tenants / Governance. Collapsed rail 68px. |
| Content | `max-w-7xl` where practical; 16 / 24 / 32px responsive padding; wide tables can use full available content width. |
| Font | Inter regular 400, medium 500, semibold 600, bold 700; Arabic uses tested script fallback that respects joining and line height. |
| Page title | 22–24px desktop, 20–22px mobile; supporting description 12–14px. |
| Body/tables | 13–14px; table header 12–13px; metadata 11–12px; numerical values tabular figures. |
| Inputs / selects | Approx 36px high; mobile touch surfaces at least 44px where needed. |
| Cards | 1px border, subtle resting shadow, 8–12px corner radius; no glass/glow/gradient. |
| Table | 40px header; 40–48px rows depending on density; status pill, row actions and pagination. |
| Interactions | 120/180/280ms restrained transitions; disabled or reduced motion when OS requests. |
| Icons | Existing `lucide-react`; 16px inline, 18–20px actions/headers; directional icons mirror in RTL. |

### 1.3 Responsive behavior

- **≥1280px:** full sidebar + multi-column KPIs/tables, drawers up to ~640px, sensible content max width.
- **1024–1279px:** collapsed/sidebar rail where needed, 2–4 KPI columns, tables scroll inside their frame.
- **768–1023px:** collapsible sidebar or drawer, 2-column stats, flexible toolbar.
- **≤767px:** no persistent side rail; hamburger opens focus-trapped navigation sheet; stacked views/cards, 1–2 KPI columns, full-width primary controls. Every action remains available.
- **390×844 and 360×800:** no viewport horizontal overflow; a complex list can use horizontal scrolling inside its table or a faithful record-card view with all fields/actions. Bottom dialogs respect safe areas and keyboard.
- **RTL:** sidebar appears at inline start (right); drawers, breadcrumbs, table alignment and arrows mirror logically; email, IDs, ISO dates, money and codes retain readable LTR segments.

## 2. Global application shell

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Elite ERP | Platform Owner    Search companies/users…        EN/AR ☾ User  │ ← dark 56px header
├────────────────────┬───────────────────────────────────────────────────────┤
│ WORKSPACE          │ Heading + context                              CTA │
│  Dashboard         │ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │
│ TENANTS            │ │ KPI│ │ KPI│ │ KPI│ │ KPI│                    │
│  Companies         │ └────┘ └────┘ └────┘ └────┘                    │
│  Users             │ Search / Filters / Export                         │
│  Subscribers       │ ┌──────────────────────────────────────────────┐    │
│  Packages          │ │ Table / cards / charts / detail drawers      │    │
│ GOVERNANCE         │ └──────────────────────────────────────────────┘    │
│  Activity Log      │                                                    │
│  Settings          │                                                    │
└────────────────────┴───────────────────────────────────────────────────────┘
```

- Menu labels use simple professional SaaS language; no sales/CRM navigation from the customer ERP leaks into the platform console.
- Global search is limited to **platform metadata** (company names/IDs, customer user names/emails, package names). Never include private accounting documents.
- Search hotkeys: Ctrl/Cmd+K and `/` when not in a text field; search result actions are focusable and announce the destination.
- Account menu: operator name, view security settings, sign out. No customer-user impersonation.
- Every page has loading skeletons, empty-with-action, error-with-retry, and permission-denied states.
- Each mutating action displays pending/disabled state until the server confirms success; never show “saved” based only on optimistic local state for security or billing changes.

## 3. Screen-by-screen spec

### UI-01 — Dashboard (`/platform/dashboard`)

**Top:** “Platform Overview” + date context + Invite Company CTA.  
**Primary metrics:** Total companies, Active access, Paid plan assignments, Trials running, Suspended, Customer users, Expiring soon, Estimated MRR (SAR).  
**Panels:** monthly registrations bar chart; package mix donut/legend; expirations (company, package, days, action); recent platform events.  
**Interactions:** cards and list entries navigate into prefiltered tables; accessible chart summary displayed as text/table; date range for registration trend where data exists.  
**Empty:** no organizations → show invitation CTA and explanatory copy.  
**Data semantics:** estimated MRR is **not cash collected**; paid assignment count is **not bank-settled count**.

### UI-02 — Companies (`/platform/companies`)

**Metrics strip:** Registered, Active access, Suspended, Pending invitations.  
**Toolbar:** search by company/owner/email; filters by Access / Package / Country; CSV Export; Invite Company.  
**Table columns:** Company + `ORG-ID` or `INV-ID`; owner; package; subscription; access; user count; renewal/expiry; row menu.  
**Row menu:** View, Edit metadata, Users, Subscription, Suspend/Reactivate (when real tenant), Revoke/Resend pending invitation (pending only).  
**Detail drawer tabs:** Overview | Access & controls | Users | Subscription | Activity.  
**Overview:** industry, country, base currency (read-only if posted), contact, owner, created, notes.  
**Access:** explicit status and consequences; Suspend/Reactivate with reason + confirmation.  
**Users:** inline list, invite and manage button.  
**Subscription:** current version and history, change package, extend, pause, payment.  
**Activity:** last operator events linked to full log.  
**Invite form:** company name, industry, country, currency, email, owner name/email, starting package; returns one-time copy link.

### UI-03 — Users (`/platform/users`)

**Metrics strip:** Total active users, Invited, Disabled, Organizations with users.  
**Toolbar:** search; Company / Role / Status filters; Invite User; metadata CSV.  
**Table columns:** User (avatar initials), email, company, role, account state, last login, actions.  
**User drawer:** identity + company + status; actions Change Role, Disable/Enable, Revoke Sessions, Resend Invitation where applicable; no password/MFA secret display.  
**Transfer ownership:** company-level dedicated dialog with eligible **active same-tenant** members; clearly explains that old owner becomes admin and both must sign back in.  
**Safeguards:** primary owner disable/demotion action disabled with reason; selection validated on server.  
**Seat allowance:** show `8 of 10 seats` counter where active package includes a seat cap; warn when grandfathered account is already over limit. Count disabled existing users and open invitations per published business rule.

### UI-04 — Subscribers (`/platform/subscribers`)

**Metrics strip:** Active plans, Trials, Expired, Paused, Estimated MRR.  
**Toolbar:** search company; filter by package, billing cycle, subscription state, expiry window; Export CSV.  
**Table columns:** Company, Plan/version, Cycle, Status, SAR recurring price, term end, company access, action.  
**Subscriber drawer:** overview; current package snapshot; renewal/expiry; company access; recent manual payment entries; subscriptions history; audit.  
**Actions:** Assign/change package, Renew/Extend, Pause/Resume, Record Payment, View Company.  
**Assign dialog:** Company, package/version, Trial/Monthly/Annual, start/end, price preview, reason; no implicit payment.  
**Renew dialog:** 14/30/90/365 days with computed new expiry and a clear note that payment is separate.  
**Record Payment:** Amount (SAR), date, reference, cycle, note, receipt preview; does **not** renew, post GL or generate tax invoice.

### UI-05 — Packages (`/platform/packages`)

**Presentation:** clean package cards with name, description, status, monthly/annual price SAR, seat cap, storage allowance, module group labels, current subscribers and `vN` label.  
**Actions:** Create, Edit (new immutable version), Duplicate, Publish, Archive (subject to current assignments).  
**Editor:** code/name/description; currency locked SAR; month/year `numeric(14,2)`; seats positive; storage GB positive; trial days 1–120 for Trial; included module groups Sales, Projects, Purchasing, Inventory, Finance, People, Reports.  
**Label mandatory:** “Module inclusion and storage are commercial descriptors; technical enforcement is not active in this release.”  
**Behavior:** show draft vs active/published version; preview impact before publish. Editing current package does not migrate current customers.  
**Danger:** Trial default cannot be archived; assigned package cannot be archived.  
**Pricing:** example HTML SAR values are fake; display “Sample pricing” in prototype only. No real package becomes sellable without product-owner price approval.

### UI-06 — Activity Log (`/platform/activity`)

**Filters:** date range, actor, company, entity, event type, result; pagination and export.  
**Columns:** time (display local; source UTC), actor, action, target/company, reason excerpt, result, event ID.  
**Detail:** before/after summary, correlation ID, source, time; scrub secrets and raw token/password material.  
**No Edit/Delete.** Events created by failed security-sensitive operations are reported without sensitive payloads.

### UI-07 — Settings (`/platform/settings`)

**Onboarding:** default trial 14 days (1–120), reminder grace 0 days (0–60), invite-only **on / locked**, expiration alerts on/off.  
**Security:** mandatory platform MFA **on / locked**, session listing and revoke controls, password change and recovery-code regeneration.  
**Billing:** manual-only **on / locked**, currency `SAR` until approved multi-currency phase.  
**Save:** explicit Save Defaults with validation; settings changes do not retroactively rewrite active subscriptions.  
**Danger policy:** never allow a toggle to turn off audit, MFA or tenant isolation.

## 4. Reusable component inventory

| Component | Behavior and accessibility |
|---|---|
| `PlatformPageHeader` | Title, supporting context, primary right/RTL-inline-end action, breadcrumbs on detail pages. |
| `MetricCard` | Large tabular number, semantic label, optional clickable drill-down, accessible change description. |
| `PlatformDataTable` | Column labels, sort affordances, pagination, record row links, status + action, in-table horizontal scroll on small view. |
| `SearchFilterToolbar` | Live search with debounce, faceted filter, clear-all, results count, Export; preserve query in URL. |
| `StatusPill` | Colored dot and text label; separate org access vs subscription vs user status families. |
| `PackageCard` | Plan/version/price/seats/storage/modules, explicit enforcement disclosure, actions. |
| `EntityDrawer` | 5-tab company detail, 2–4 tab subscriber/user details; focus trap and restore focus on close. |
| `ConfirmActionDialog` | Target summary, reason textarea, impact warning, confirm/cancel; destructive color not confused with primary. |
| `InviteDialog` | Email uniqueness checks, friendly expiry explanation, one-time token link, Copy with accessible feedback. |
| `Toast / InlineError` | Pending/success/refusal with actual server response; action errors also tied to fields. |
| `Empty / Loading / ErrorState` | Nonmisleading content and clear next step. |

## 5. Interaction-specific requirements

- Buttons, dropdowns, dialogs, drawers, and links cannot be decorative/inert in production; all interactive controls have keyboard support.
- Text on orange **always white** in hover, active, selected and disabled modes wherever text remains visible; avoid translucent orange backgrounds under white text that fail contrast.
- Confirmation dialogs require reason for suspension, reactivation, user disable, ownership transfer, package archive and subscription pause. Informational actions may have optional notes.
- Dialog close: Escape, Cancel or close button; safe focus restoration. Never silently lose edits; use discard warning if fields changed.
- CSV download should be generated by an authorized server endpoint, with safe output encoding and allowlisted metadata fields; the browser-only demo CSV logic is not production-safe evidence.
- Internal page scroll only; sticky header remains readable; sensitive drawers do not overlap the mobile keyboard.
- Danger confirmations show company name/email/ID so the operator can verify target before submit.

## 6. Localization specification

- Every label, validation, confirmation, toast, empty state, chart description, column and date-range control translated EN/AR; the prototype's Arabic is **partial** and must not be treated as acceptance.
- Saudi-facing Arabic should sound natural and professional. Apply `dir="rtl"` at the logical app root; use CSS logical start/end properties rather than arbitrary reversed DOM order.
- Preserve Latin directional ordering for IDs/emails/URLs and SAR figures inside Arabic paragraphs with `bdi`/`dir="ltr"` where necessary.
- All dates stored UTC; show user-friendly local date/time with explicit timezone where material. Subscription date-only field is unambiguous in the platform timezone (default Asia/Riyadh) and backend-normalized.

## 7. Visual QA matrix and evidence

| Viewport | Light EN | Dark EN | Light AR/RTL | Dark AR/RTL |
|---|---|---|---|---|
| 1440×900 | Required | Required | Required | Required |
| 1280×800 | Required | Required | Required | Required |
| 1024×768 | Required | Required | Required | Required |
| 820×1180 | Required | Required | Required | Required |
| 390×844 | Required | Required | Required | Required |
| 360×800 | Required | Required | Required | Required |

Capture representative evidence for: dashboard, company list/drawer, user list/role/transfer, subscriber assignment/renewal/payment, package catalog/editor, audit, settings, login/MFA, empty/loading/error, and long Arabic labels. Check keyboard-only operation, screen-reader names, real computed color contrast, no horizontal *page* overflow, theme persistence and role denial. A passing static build alone does not satisfy UI acceptance.

## 8. Visual references and known deviations

- Prototype screenshots: `Elite_ERP_Stage2_Dashboard_Light.png`, `Elite_ERP_Stage2_Dashboard_Dark.png`, `Elite_ERP_Stage2_Companies_Light.png`, `Elite_ERP_Stage2_Users_Light.png`, `Elite_ERP_Stage2_Subscribers_Light.png`, `Elite_ERP_Stage2_Packages_Light.png`, and mobile variants.
- LCP kit screenshots `lcp-reference/screenshots/web/{light,dark}/desktop/platform-*` and shared web admin/tablet/mobile references are **visual inspiration**, not a product-feature checklist.
- Demo uses local storage and simplified roles, prices, invite links and client-side filters. Production must use authenticated server data/actions and full localization, as specified in `TRD.md`.
- If the common ERP design-system branch is still evolving, **import/consume the final approved tokens** after its merge. Do not lock the platform console to a competing palette or overwrite the ongoing CSS changes.

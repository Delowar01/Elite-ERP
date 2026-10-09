# DEV-UI-01.6-C2 — Edit confirmation stuck after client-side navigation

Base: main `c3ef0fb` (the DEV-UI-01.6 merge). Branch `claude/dev-ui-01-6-c2-edit-confirm-close`.
C0 / C1 evidence is unchanged; this records the one correction made after merge.

## Live symptom (independent browser QA, VPS staging, 390px)
1. Open a draft Sales Invoice's detail page and press **Edit**.
2. The confirmation "Continue to Edit Invoice INV-0001?" opens; press **Continue to Edit**.
3. The URL and the page underneath move to `/sales/invoices/<id>/edit` — the edit route works.
4. The confirmation dialog stays on top of the edit page in its disabled **"Working…"** state
   indefinitely. A browser reload clears it, and the edit page then works normally.

## Root cause
`useDocumentEditAction` (`src/app/(app)/_shared/edit-document.tsx`) requested the `document.edit`
confirmation with `navigatesOnSuccess: true`. On a successful `onConfirm`, the shared
`ConfirmProvider` (`confirm-provider.tsx`) then returns early — `if (request.navigatesOnSuccess) return;`
— leaving `request` set, `busy` true, the dialog open and the button on "Working…", on the assumption
that the navigation unmounts the page.

That assumption is false here. `onConfirm` calls `router.push(editHrefFor(docType, id))`, a
client-side App Router navigation, and the `ConfirmProvider` is mounted once in the persistent app
layout, so it survives the route change and the dialog stays up. The unsaved-changes guard in
`dirty-form.tsx` already documents and follows the correct rule ("NOT `navigatesOnSuccess`: this
navigation is client-side, so the provider … survives it").

The flag dates from `cdb5b1b` (2026-08-07, "Central confirmation policy for sensitive actions");
`edit-document.tsx` and `confirm-provider.tsx` were byte-identical to the 01.5 baseline throughout
DEV-UI-01.6 (both byte-pinned), so the defect predates 01.6. The existing `verify-edit-e2e` only waited
for the `/edit` URL — which the bug also satisfies — and its next step was a full page load that wiped
the stuck dialog, so it never noticed.

## Correction (one behavioural line)
`src/app/(app)/_shared/edit-document.tsx`: removed `navigatesOnSuccess: true` from the `document.edit`
request and added a 4-line comment saying why (client-side `router.push`; provider in the persistent
layout survives the route change; the normal success path must close the dialog). `onConfirm` is
unchanged. The provider's normal success path now clears the request after `router.push()` is invoked,
so the dialog closes while Next completes the navigation.

Not changed: `ConfirmProvider` (still byte-pinned at `e9a1f39974078cdc`), the other
`navigatesOnSuccess` users (`document-row-actions.tsx`, `confirm-actions.tsx`), the confirmation
policy and wording, `canEditDocument` / Edit availability, `editHrefFor`, detail-page and row-menu
Edit visibility, every document form, every `actions.ts`, routes, permissions, lifecycle, posting,
totals, the database and migrations. No business, accounting or database behaviour changed.

## Pin change (the only one)
`verify/document-form-pins.json`: `src/app/(app)/_shared/edit-document.tsx`
`2ff456ea85b2a63c` → `761cf03ae256b8ef`. Before the update, `verify:document-form` failed on exactly
this file and nothing else (75/76), proving the pin is live. The other 46 pins — including
`confirm-provider.tsx` and `dirty-form.tsx` — are unchanged.

## Regression assertions (`verify/verify-edit-e2e.mjs`, additive only: +109 lines, 0 removed)
A helper, `afterContinueToEdit()`, waits up to 5 s for the dialog to leave and then measures what is
still on screen: `[role=dialog]` / `[role=alertdialog]` count, the visible Radix overlay, visible
"Working…" buttons, `pointer-events: none` on `<body>`, `<main>` inside `aria-hidden`, and whether the
edit page takes input (a **trial** click on its Save Changes button — Playwright's actionability
checks: visible, enabled, not covered; nothing is submitted).

| Path | New checks |
|---|---|
| List row menu → Edit → Continue to Edit, all 8 types | dialog count 0 · no overlay / page not blocked · no "Working…" · edit page usable in the same tab · Escape stays on the list |
| Detail / Preview → Edit → Continue to Edit, all 8 types | the same four · Preview Escape closes and stays on the Preview |
| Arabic (`المتابعة إلى التعديل`) | confirmation closed and edit page usable |
| 390px: draft Sales Invoice detail → Edit → Continue to Edit | dialog inside the viewport naming the invoice · reaches `/edit` · no dialog / overlay / "Working…" · edit page usable in the same tab |
| Continue to Edit activated twice (`clickCount: 2`) | usable edit page, confirmation closed, no page errors |

Types covered: Quotation, Sales Order, Proforma Invoice, Sales Invoice, Delivery Challan, Credit
Note, Purchase Order, Debit Note. Suite size 132 → 218 checks.

## Evidence
- Strengthened suite on the **old code** (`c3ef0fb` with only the new test): **FAIL, 150/218** — the
  68 post-navigation assertions fail with `{"dialogs":1,"overlays":1,"working":1,"bodyBlocked":true,
  "usable":false}` (the live symptom); the 132 original checks and the other new checks pass.
- Same suite on the **corrected code**: **PASS, 218/218**.

## Verification (isolated worktrees, `devui010_test_only_*` databases on localhost, no repository `.env`)
- `verify-edit-e2e` 218/218 · `verify:confirm-policy` 62/62 · `verify:document-form` 76/76 ·
  TypeScript (`tsc --noEmit`) clean · ESLint (changed files) clean.
- `npm run verify:static`: exit 0, no failing suite.
- Full browser tier: 46/46 suites, including `verify-confirm-e2e` 34/34 (the provider's double-click
  guard: "Confirm performed the action exactly once"), `verify-dirty-core` 72/72, `verify-dirty-ui` 8/8,
  `verify-edit`, `verify-draft-*`, `verify-document-form-runtime` 188/188.
- Proof points: Continue to Edit navigates (same tab) and the dialog, overlay and "Working…" button are
  gone; Cancel and Escape close and stay put; locked / non-draft documents expose no Edit; direct edit
  URLs stay protected (locked → Preview, Recycle Bin refused, unauthenticated → login, other org →
  not found); EN and AR; 390px dialog and destination page; all 8 document types. No existing check was
  removed or weakened.

# Elite ERP × LCP — route matrix

One row per `page.tsx` (72) plus the shared overlays. Status: **Pending / In Progress / Verified / Blocked**.
A family is never marked done because its list page changed — every row carries its own evidence.
Evidence columns: ✓ = captured and reviewed in that language·theme / viewport; – = not captured.
Screenshot evidence lives outside the repository (synthetic TEST data only); the run that produced
each ✓ is named in `ERP_LCP_FINAL_HANDOVER.md`.

| # | Route | Source | Roles | Archetype | EN·L | EN·D | AR·L | AR·D | 1440 | 820 | 390 | Interaction regression | Found / fixed | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/clients/[id]` | `src/app/(app)/clients/[id]/page.tsx` | owner, admin, staff | detail / workspace | – | – | – | – | – | – | – | – | – | Pending | – |
| 2 | `/clients/new` | `src/app/(app)/clients/new/page.tsx` | owner, admin, staff | long form | – | – | – | – | – | – | – | – | – | Pending | – |
| 3 | `/clients` | `src/app/(app)/clients/page.tsx` | owner, admin, staff | list / table | – | – | – | – | – | – | – | – | – | Pending | – |
| 4 | `/clients/recycle-bin` | `src/app/(app)/clients/recycle-bin/page.tsx` | owner, admin, staff | recycle / restore | – | – | – | – | – | – | – | – | – | Pending | – |
| 5 | `/dashboard` | `src/app/(app)/dashboard/page.tsx` | owner, admin, staff | dashboard | – | – | – | – | – | – | – | – | – | Pending | – |
| 6 | `/finance/bank-accounts` | `src/app/(app)/finance/bank-accounts/page.tsx` | owner, admin, staff | finance list | – | – | – | – | – | – | – | – | – | Pending | – |
| 7 | `/finance/chart-of-accounts` | `src/app/(app)/finance/chart-of-accounts/page.tsx` | owner, admin, staff | accounting ledger | – | – | – | – | – | – | – | – | – | Pending | – |
| 8 | `/finance/journal` | `src/app/(app)/finance/journal/page.tsx` | owner, admin, staff | accounting ledger | – | – | – | – | – | – | – | – | – | Pending | – |
| 9 | `/finance/ledger` | `src/app/(app)/finance/ledger/page.tsx` | owner, admin, staff | accounting ledger | – | – | – | – | – | – | – | – | – | Pending | – |
| 10 | `/finance/payments` | `src/app/(app)/finance/payments/page.tsx` | owner, admin, staff | finance list | – | – | – | – | – | – | – | – | – | Pending | – |
| 11 | `/finance/reports` | `src/app/(app)/finance/reports/page.tsx` | owner, admin, staff | financial report | – | – | – | – | – | – | – | – | – | Pending | – |
| 12 | `/finance/statements` | `src/app/(app)/finance/statements/page.tsx` | owner, admin, staff | financial report | – | – | – | – | – | – | – | – | – | Pending | – |
| 13 | `/hr/attendance` | `src/app/(app)/hr/attendance/page.tsx` | owner, admin, staff | HR list | – | – | – | – | – | – | – | – | – | Pending | – |
| 14 | `/hr/departments` | `src/app/(app)/hr/departments/page.tsx` | owner, admin, staff | HR list | – | – | – | – | – | – | – | – | – | Pending | – |
| 15 | `/hr/employees/[id]` | `src/app/(app)/hr/employees/[id]/page.tsx` | owner, admin, staff | HR detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 16 | `/hr/employees/new` | `src/app/(app)/hr/employees/new/page.tsx` | owner, admin, staff | HR form | – | – | – | – | – | – | – | – | – | Pending | – |
| 17 | `/hr/employees` | `src/app/(app)/hr/employees/page.tsx` | owner, admin, staff | HR list | – | – | – | – | – | – | – | – | – | Pending | – |
| 18 | `/hr/leave` | `src/app/(app)/hr/leave/page.tsx` | owner, admin, staff | HR list | – | – | – | – | – | – | – | – | – | Pending | – |
| 19 | `/hr/payroll` | `src/app/(app)/hr/payroll/page.tsx` | owner, admin | HR list | – | – | – | – | – | – | – | – | – | Pending | – |
| 20 | `/inventory/products/[id]` | `src/app/(app)/inventory/products/[id]/page.tsx` | owner, admin, staff | detail / workspace | – | – | – | – | – | – | – | – | – | Pending | – |
| 21 | `/inventory/products/new` | `src/app/(app)/inventory/products/new/page.tsx` | owner, admin, staff | long form | – | – | – | – | – | – | – | – | – | Pending | – |
| 22 | `/inventory/products` | `src/app/(app)/inventory/products/page.tsx` | owner, admin, staff | list / table | – | – | – | – | – | – | – | – | – | Pending | – |
| 23 | `/inventory/products/recycle-bin` | `src/app/(app)/inventory/products/recycle-bin/page.tsx` | owner, admin, staff | recycle / restore | – | – | – | – | – | – | – | – | – | Pending | – |
| 24 | `/projects/[id]` | `src/app/(app)/projects/[id]/page.tsx` | owner, admin, staff | detail / workspace | – | – | – | – | – | – | – | – | – | Pending | – |
| 25 | `/projects/new` | `src/app/(app)/projects/new/page.tsx` | owner, admin, staff | long form | – | – | – | – | – | – | – | – | – | Pending | – |
| 26 | `/projects` | `src/app/(app)/projects/page.tsx` | owner, admin, staff | list / table | – | – | – | – | – | – | – | – | – | Pending | – |
| 27 | `/purchasing/debit-notes/[id]/edit` | `src/app/(app)/purchasing/debit-notes/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 28 | `/purchasing/debit-notes/[id]` | `src/app/(app)/purchasing/debit-notes/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 29 | `/purchasing/debit-notes/new` | `src/app/(app)/purchasing/debit-notes/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 30 | `/purchasing/debit-notes` | `src/app/(app)/purchasing/debit-notes/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 31 | `/purchasing/orders/[id]/edit` | `src/app/(app)/purchasing/orders/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 32 | `/purchasing/orders/[id]` | `src/app/(app)/purchasing/orders/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 33 | `/purchasing/orders/new` | `src/app/(app)/purchasing/orders/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 34 | `/purchasing/orders` | `src/app/(app)/purchasing/orders/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 35 | `/purchasing/vendors/[id]` | `src/app/(app)/purchasing/vendors/[id]/page.tsx` | owner, admin, staff | detail / workspace | – | – | – | – | – | – | – | – | – | Pending | – |
| 36 | `/purchasing/vendors/new` | `src/app/(app)/purchasing/vendors/new/page.tsx` | owner, admin, staff | long form | – | – | – | – | – | – | – | – | – | Pending | – |
| 37 | `/purchasing/vendors` | `src/app/(app)/purchasing/vendors/page.tsx` | owner, admin, staff | list / table | – | – | – | – | – | – | – | – | – | Pending | – |
| 38 | `/purchasing/vendors/recycle-bin` | `src/app/(app)/purchasing/vendors/recycle-bin/page.tsx` | owner, admin, staff | recycle / restore | – | – | – | – | – | – | – | – | – | Pending | – |
| 39 | `/recycle-bin` | `src/app/(app)/recycle-bin/page.tsx` | owner, admin, staff | recycle / restore | – | – | – | – | – | – | – | – | – | Pending | – |
| 40 | `/sales/credit-notes/[id]/edit` | `src/app/(app)/sales/credit-notes/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 41 | `/sales/credit-notes/[id]` | `src/app/(app)/sales/credit-notes/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 42 | `/sales/credit-notes/new` | `src/app/(app)/sales/credit-notes/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 43 | `/sales/credit-notes` | `src/app/(app)/sales/credit-notes/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 44 | `/sales/delivery-challans/[id]/edit` | `src/app/(app)/sales/delivery-challans/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 45 | `/sales/delivery-challans/[id]` | `src/app/(app)/sales/delivery-challans/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 46 | `/sales/delivery-challans/new` | `src/app/(app)/sales/delivery-challans/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 47 | `/sales/delivery-challans` | `src/app/(app)/sales/delivery-challans/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 48 | `/sales/invoices/[id]/edit` | `src/app/(app)/sales/invoices/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 49 | `/sales/invoices/[id]` | `src/app/(app)/sales/invoices/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 50 | `/sales/invoices/new` | `src/app/(app)/sales/invoices/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 51 | `/sales/invoices` | `src/app/(app)/sales/invoices/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 52 | `/sales/orders/[id]/edit` | `src/app/(app)/sales/orders/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 53 | `/sales/orders/[id]` | `src/app/(app)/sales/orders/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 54 | `/sales/orders/new` | `src/app/(app)/sales/orders/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 55 | `/sales/orders` | `src/app/(app)/sales/orders/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 56 | `/sales/proforma/[id]/edit` | `src/app/(app)/sales/proforma/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 57 | `/sales/proforma/[id]` | `src/app/(app)/sales/proforma/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 58 | `/sales/proforma/new` | `src/app/(app)/sales/proforma/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 59 | `/sales/proforma` | `src/app/(app)/sales/proforma/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 60 | `/sales/quotations/[id]/edit` | `src/app/(app)/sales/quotations/[id]/edit/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 61 | `/sales/quotations/[id]` | `src/app/(app)/sales/quotations/[id]/page.tsx` | owner, admin, staff | document detail | – | – | – | – | – | – | – | – | – | Pending | – |
| 62 | `/sales/quotations/new` | `src/app/(app)/sales/quotations/new/page.tsx` | owner, admin, staff | line-item document editor | – | – | – | – | – | – | – | – | – | Pending | – |
| 63 | `/sales/quotations` | `src/app/(app)/sales/quotations/page.tsx` | owner, admin, staff | document list | – | – | – | – | – | – | – | – | – | Pending | – |
| 64 | `/settings/compliance` | `src/app/(app)/settings/compliance/page.tsx` | owner, admin | settings | – | – | – | – | – | – | – | – | – | Pending | – |
| 65 | `/settings/organization` | `src/app/(app)/settings/organization/page.tsx` | owner, admin | settings | – | – | – | – | – | – | – | – | – | Pending | – |
| 66 | `/settings/presets` | `src/app/(app)/settings/presets/page.tsx` | owner, admin | settings | – | – | – | – | – | – | – | – | – | Pending | – |
| 67 | `/settings/security` | `src/app/(app)/settings/security/page.tsx` | owner, admin, staff | settings | – | – | – | – | – | – | – | – | – | Pending | – |
| 68 | `/settings/team` | `src/app/(app)/settings/team/page.tsx` | owner, admin, staff | redirect → settings tab | – | – | – | – | – | – | – | – | – | Pending | – |
| 69 | `/login` | `src/app/(auth)/login/page.tsx` | public | auth | – | – | – | – | – | – | – | – | – | Pending | – |
| 70 | `/register` | `src/app/(auth)/register/page.tsx` | public | auth | – | – | – | – | – | – | – | – | – | Pending | – |
| 71 | `/` | `src/app/page.tsx` | any (redirect) | redirect | – | – | – | – | – | – | – | – | – | Pending | – |
| 72 | `/print/[type]/[id]` | `src/app/print/[type]/[id]/page.tsx` | owner, admin, staff | print preview (output frozen) | – | – | – | – | – | – | – | – | – | Pending | – |

## Shared overlays and inline UI

| Surface | Source | Archetype | Evidence | Status | Commit |
|---|---|---|---|---|---|
| App header (search, EN|ع, theme, favorites, notifications, settings, account) | `src/components/layout/app-shell.tsx` | shell | – | Pending | – |
| Sidebar (groups, mini rail, collapse) | `src/components/layout/sidebar.tsx` | shell | – | Pending | – |
| Mobile navigation drawer | `src/components/layout/mobile-nav.tsx` | sheet | – | Pending | – |
| Command palette (Ctrl/⌘+K) | `src/components/layout/command-palette.tsx` | dialog | – | Pending | – |
| Record search | `src/components/layout/record-search.tsx` | dialog | – | Pending | – |
| Favorites / notifications / account menus | `src/components/layout/*-menu.tsx` | dropdown | – | Pending | – |
| Confirmation dialog (all sensitive actions, unsaved changes) | `src/app/(app)/_shared/confirm-provider.tsx` | alert dialog | – | Pending | – |
| Generic Dialog / Drawer primitives | `src/components/ui/dialog.tsx, drawer.tsx` | dialog / sheet | – | Pending | – |
| Toasts | `src/components/ui/sonner.tsx` | toast | – | Pending | – |
| Configure columns / crop image / preview & print modals | `src/app/(app)/mockup-parity.css consumers` | dialog | – | Pending | – |
| Import wizard (clients, products, vendors) | `src/app/(app)/**/import*` | dialog | – | Pending | – |
| Credit-note goods return dialog (ACC-01) | `src/app/(app)/sales/credit-notes/cn-detail-actions.tsx` | dialog | – | Pending | – |
| Payment / settlement dialogs | `src/app/(app)/sales/**, finance/**` | dialog | – | Pending | – |

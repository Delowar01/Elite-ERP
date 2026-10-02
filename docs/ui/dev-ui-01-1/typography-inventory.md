# DEV-UI-01.1-C1 — typography inventory

Every `font-mono` / `.mono` / `var(--font-mono)` / literal Plex Mono usage under `src/` at 1724131,
classified. Rule: **codes and identifiers → IBM Plex Mono**; **numeric data (money, prices, rates,
quantities, balances, percentages, payroll figures, counts, dates, times) → UI face + tabular figures
(`num-tabular`)**. Ambiguous cases were left in Mono and are listed here, not decided silently.

## Moved to UI face + tabular figures — 125 call-site tokens

| File | Line | Was |
|---|---|---|
| `sales/quotations/[id]/page.tsx` | 116 | `font-mono` |
| `sales/quotations/[id]/page.tsx` | 117 | `font-mono` |
| `sales/quotations/[id]/page.tsx` | 118 | `font-mono` |
| `sales/quotations/[id]/page.tsx` | 119 | `font-mono` |
| `sales/invoices/[id]/page.tsx` | 219 | `font-mono` |
| `sales/invoices/[id]/page.tsx` | 220 | `font-mono` |
| `sales/invoices/[id]/page.tsx` | 221 | `font-mono` |
| `sales/invoices/[id]/page.tsx` | 222 | `font-mono` |
| `sales/orders/[id]/page.tsx` | 129 | `font-mono` |
| `sales/orders/[id]/page.tsx` | 130 | `font-mono` |
| `sales/orders/[id]/page.tsx` | 131 | `font-mono` |
| `sales/orders/[id]/page.tsx` | 132 | `font-mono` |
| `sales/delivery-challans/[id]/page.tsx` | 109 | `font-mono` |
| `sales/credit-notes/[id]/page.tsx` | 118 | `font-mono` |
| `sales/credit-notes/[id]/page.tsx` | 119 | `font-mono` |
| `sales/credit-notes/[id]/page.tsx` | 120 | `font-mono` |
| `sales/proforma/[id]/page.tsx` | 218 | `font-mono` |
| `sales/proforma/[id]/page.tsx` | 219 | `font-mono` |
| `sales/proforma/[id]/page.tsx` | 220 | `font-mono` |
| `sales/proforma/[id]/page.tsx` | 221 | `font-mono` |
| `purchasing/orders/[id]/page.tsx` | 140 | `font-mono` |
| `purchasing/orders/[id]/page.tsx` | 141 | `font-mono` |
| `purchasing/orders/[id]/page.tsx` | 142 | `font-mono` |
| `purchasing/orders/[id]/page.tsx` | 143 | `font-mono` |
| `purchasing/debit-notes/[id]/page.tsx` | 118 | `font-mono` |
| `purchasing/debit-notes/[id]/page.tsx` | 119 | `font-mono` |
| `purchasing/debit-notes/[id]/page.tsx` | 120 | `font-mono` |
| `sales/quotations/quotations-list-client.tsx` | 169 | `font-mono` |
| `sales/quotations/quotations-list-client.tsx` | 170 | `font-mono` |
| `sales/quotations/quotations-list-client.tsx` | 171 | `font-mono` |
| `sales/invoices/invoices-list-client.tsx` | 162 | `font-mono` |
| `sales/invoices/invoices-list-client.tsx` | 163 | `font-mono` |
| `sales/orders/orders-list-client.tsx` | 161 | `font-mono` |
| `sales/orders/orders-list-client.tsx` | 162 | `font-mono` |
| `sales/orders/orders-list-client.tsx` | 163 | `font-mono` |
| `sales/delivery-challans/dc-list-client.tsx` | 140 | `font-mono` |
| `sales/credit-notes/cn-list-client.tsx` | 154 | `font-mono` |
| `sales/credit-notes/cn-list-client.tsx` | 155 | `font-mono` |
| `sales/proforma/proforma-list-client.tsx` | 158 | `font-mono` |
| `sales/proforma/proforma-list-client.tsx` | 159 | `font-mono` |
| `purchasing/orders/po-list-client.tsx` | 159 | `font-mono` |
| `purchasing/orders/po-list-client.tsx` | 160 | `font-mono` |
| `purchasing/orders/po-list-client.tsx` | 161 | `font-mono` |
| `purchasing/debit-notes/dn-list-client.tsx` | 154 | `font-mono` |
| `purchasing/debit-notes/dn-list-client.tsx` | 155 | `font-mono` |
| `sales/_shared/date-settings-dialog.tsx` | 53 | `font-mono` |
| `sales/_shared/validity-days-dialog.tsx` | 63 | `font-mono` |
| `recycle-bin/recycle-bin-client.tsx` | 121 | `font-mono` |
| `projects/[id]/page.tsx` | 149 | `font-mono` |
| `projects/[id]/page.tsx` | 154 | `font-mono` |
| `projects/[id]/page.tsx` | 210 | `font-mono` |
| `projects/[id]/page.tsx` | 216 | `font-mono` |
| `projects/[id]/page.tsx` | 250 | `font-mono` |
| `projects/[id]/page.tsx` | 251 | `font-mono` |
| `projects/[id]/cost-control.tsx` | 43 | `mono` |
| `projects/[id]/cost-control.tsx` | 74 | `mono` |
| `projects/projects-list-client.tsx` | 102 | `font-mono` |
| `projects/projects-list-client.tsx` | 103 | `font-mono` |
| `projects/projects-list-client.tsx` | 104 | `font-mono` |
| `projects/projects-list-client.tsx` | 107 | `font-mono` |
| `hr/attendance/page.tsx` | 85 | `font-mono` |
| `hr/attendance/page.tsx` | 86 | `font-mono` |
| `hr/payroll/page.tsx` | 161 | `font-mono` |
| `hr/payroll/page.tsx` | 167 | `font-mono` |
| `hr/payroll/payroll-client.tsx` | 74 | `font-mono` |
| `hr/payroll/payroll-client.tsx` | 75 | `font-mono` |
| `hr/payroll/payroll-client.tsx` | 76 | `font-mono` |
| `hr/payroll/payroll-client.tsx` | 89 | `mono` |
| `hr/payroll/payroll-client.tsx` | 93 | `mono` |
| `hr/payroll/payroll-client.tsx` | 97 | `mono` |
| `hr/payroll/payroll-client.tsx` | 101 | `mono` |
| `hr/leave/leave-client.tsx` | 112 | `font-mono` |
| `finance/journal/page.tsx` | 60 | `mono` |
| `finance/payments/payments-list-client.tsx` | 123 | `font-mono` |
| `finance/payments/payments-list-client.tsx` | 144 | `font-mono` |
| `finance/reports/reports-workspace.tsx` | 64 | `mono` |
| `finance/reports/reports-workspace.tsx` | 231 | `mono` |
| `finance/reports/reports-workspace.tsx` | 388 | `mono` |
| `finance/reports/reports-workspace.tsx` | 401 | `mono` |
| `finance/reports/reports-workspace.tsx` | 451 | `mono` |
| `finance/reports/reports-workspace.tsx` | 456 | `mono` |
| `finance/reports/reports-workspace.tsx` | 541 | `mono` |
| `finance/reports/reports-workspace.tsx` | 359 | `mono` |
| `finance/reports/reports-workspace.tsx` | 360 | `mono` |
| `finance/reports/reports-workspace.tsx` | 361 | `mono` |
| `finance/reports/reports-workspace.tsx` | 366 | `mono` |
| `finance/reports/reports-workspace.tsx` | 367 | `mono` |
| `finance/reports/reports-workspace.tsx` | 368 | `mono` |
| `finance/reports/reports-workspace.tsx` | 404 | `mono` |
| `finance/reports/reports-workspace.tsx` | 405 | `mono` |
| `finance/reports/reports-workspace.tsx` | 410 | `mono` |
| `finance/reports/reports-workspace.tsx` | 411 | `mono` |
| `finance/reports/reports-workspace.tsx` | 478 | `mono` |
| `finance/reports/reports-workspace.tsx` | 479 | `mono` |
| `finance/reports/reports-workspace.tsx` | 480 | `mono` |
| `finance/reports/reports-workspace.tsx` | 481 | `mono` |
| `finance/reports/reports-workspace.tsx` | 543 | `mono` |
| `finance/reports/reports-workspace.tsx` | 544 | `mono` |
| `finance/reports/reports-workspace.tsx` | 477 | `mono` |
| `finance/bank-accounts/bank-account-form-dialog.tsx` | 158 | `font-mono` |
| `finance/bank-accounts/page.tsx` | 171 | `mono` |
| `finance/_shared/account-ledger-view.tsx` | 115 | `mono` |
| `finance/_shared/payment-history.tsx` | 156 | `font-mono` |
| `finance/_shared/payment-history.tsx` | 174 | `font-mono` |
| `finance/_shared/payment-history.tsx` | 178 | `font-mono` |
| `finance/statements/statement-view.tsx` | 318 | `font-mono` |
| `settings/presets/numbering-panel.tsx` | 105 | `font-mono` |
| `settings/presets/numbering-panel.tsx` | 122 | `font-mono` |
| `settings/presets/exchange-rates-panel.tsx` | 135 | `font-mono` |
| `settings/presets/exchange-rates-panel.tsx` | 180 | `font-mono` |
| `settings/presets/bundles-panel.tsx` | 125 | `font-mono` |
| `settings/presets/bundles-panel.tsx` | 205 | `font-mono` |
| `settings/organization/number-format-form.tsx` | 109 | `font-mono` |
| `settings/organization/number-format-form.tsx` | 116 | `font-mono` |
| `settings/organization/number-format-form.tsx` | 120 | `font-mono` |
| `settings/security/security-client.tsx` | 268 | `font-mono` |
| `settings/security/security-client.tsx` | 269 | `font-mono` |
| `settings/security/security-client.tsx` | 309 | `font-mono` |
| `inventory/products/page.tsx` | 88 | `font-mono` |
| `inventory/products/page.tsx` | 89 | `font-mono` |
| `documents/_workspace/import-v2-dialog.tsx` | 367 | `font-mono` |
| `documents/_workspace/import-v2-dialog.tsx` | 451 | `font-mono` |
| `documents/_workspace/import-v2-dialog.tsx` | 452 | `font-mono` |
| `documents/_workspace/import-v2-dialog.tsx` | 454 | `font-mono` |
| `documents/_workspace/import-dialog.tsx` | 164 | `font-mono` |

Plus, at component / stylesheet level:

* `Money` and `DocNum` (`src/app/(app)/sales/_shared/money.tsx`) always render `num-tabular`.
* `mockup-parity.css`: `td.num`, `.totals-strip .v`, `.item-cell-input`, discount input, `.cellval`, `.acct-row .bal`, `.tb-tile .v`, `.donut-legend-row .val`, `.bc-stat-row .val`, and `.doc-field .input input[type="date"]`.
* `print.css`: `table.pdf-items td.num`, `.totals-box .v`.
* `dashboard/_shared/charts.tsx`: x-axis day labels (a literal `IBM Plex Mono` family that never matched the self-hosted face).

## Kept in IBM Plex Mono (codes / identifiers) — 66 call sites

| File | Line | Content |
|---|---|---|
| `sales/quotations/[id]/page.tsx` | 75 | `<h3 className="mono">{quotation.quotationNumber}</h3>` |
| `sales/quotations/quotations-list-client.tsx` | 160 | `<Link href={`/sales/quotations/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/invoices/invoices-list-client.tsx` | 153 | `<Link href={`/sales/invoices/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/invoices/invoices-list-client.tsx` | 160 | `<TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? "—"}</TableCell>` |
| `sales/invoices/[id]/page.tsx` | 150 | `<h3 className="mono">{invoice.invoiceNumber}</h3>` |
| `sales/orders/orders-list-client.tsx` | 152 | `<Link href={`/sales/orders/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/orders/orders-list-client.tsx` | 159 | `<TableCell className="text-ink-muted font-mono text-xs">{r.sourceQuotationNumber ?? "—"}</TableCell>` |
| `sales/orders/[id]/page.tsx` | 77 | `<h3 className="mono">{order.soNumber}</h3>` |
| `sales/delivery-challans/[id]/page.tsx` | 65 | `<h3 className="mono">{dc.dcNumber}</h3>` |
| `sales/delivery-challans/dc-list-client.tsx` | 131 | `<Link href={`/sales/delivery-challans/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/delivery-challans/dc-list-client.tsx` | 138 | `<TableCell className="text-ink-muted font-mono text-xs">{r.sourceLabel ?? "—"}</TableCell>` |
| `sales/credit-notes/[id]/page.tsx` | 77 | `<h3 className="mono">{cn.creditNoteNumber}</h3>` |
| `sales/credit-notes/cn-list-client.tsx` | 141 | `<Link href={`/sales/credit-notes/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/credit-notes/cn-list-client.tsx` | 148 | `<TableCell className="text-ink-muted font-mono text-xs">` |
| `sales/proforma/proforma-list-client.tsx` | 149 | `<Link href={`/sales/proforma/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `sales/proforma/proforma-list-client.tsx` | 156 | `<TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? "—"}</TableCell>` |
| `sales/proforma/[id]/page.tsx` | 145 | `<h3 className="mono">{pf.proformaNumber}</h3>` |
| `sales/_shared/number-settings-dialog.tsx` | 74 | `<p className="text-[11.5px] text-ink-faint">{t(locale, "Next document")}: <span className="font-mono text-ink"` |
| `sales/_shared/preview-dialog.tsx` | 67 | `<div className="font-mono text-[13px]">{data.number}</div>` |
| `sales/_shared/party-card.tsx` | 176 | `<div className="pc-row"><span className="text-ink-faint">{t(locale, selLabels.taxNumberLabel)}:</span>&nbsp;<s` |
| `sales/_shared/party-card.tsx` | 179 | `<div className="pc-row"><span className="text-ink-faint">{t(locale, selLabels.registrationLabel)}:</span>&nbsp` |
| `recycle-bin/recycle-bin-client.tsx` | 113 | `<Link href={r.detailHref} className="hover:text-brand-orange font-mono">` |
| `projects/[id]/page.tsx` | 246 | `<Link href={d.href} className="hover:text-brand-orange font-mono">` |
| `projects/[id]/cost-control.tsx` | 70 | `<Link href={r.href} className="mono hover:text-brand-orange">` |
| `hr/employees/[id]/page.tsx` | 44 | `{employee.name} <span className="font-mono text-[13px] text-ink-muted">· {employee.employeeCode}</span>` |
| `finance/payments/payments-list-client.tsx` | 128 | `<TableCell className="font-mono text-xs">` |
| `finance/reports/reports-workspace.tsx` | 358 | `<TableCell className="mono">{r.code}</TableCell><TableCell>{accountName(locale, r)}</TableCell>` |
| `finance/reports/reports-workspace.tsx` | 387 | `<div className="font-semibold text-[13px]"><span className="mono text-ink-faint">{b.code}</span> {accountName(` |
| `finance/_shared/add-account-dialog.tsx` | 52 | `<Input id="acc-code" name="code" required placeholder="e.g. 1300" className="font-mono" />` |
| `finance/_shared/account-ledger-view.tsx` | 87 | `<div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>` |
| `finance/statements/statement-view.tsx` | 320 | `<td className="p-2.5 font-mono">` |
| `finance/statements/statement-view.tsx` | 328 | `<td className="p-2.5 font-mono text-ink-muted">{l.currency \|\| "—"}</td>` |
| `settings/presets/numbering-panel.tsx` | 89 | `className="h-8 font-mono w-24"` |
| `settings/presets/numbering-panel.tsx` | 97 | `className="h-8 font-mono w-24 ml-auto text-right"` |
| `settings/presets/numbering-panel.tsx` | 120 | `<TableCell className="font-mono text-xs">{seq.prefix}</TableCell>` |
| `settings/presets/numbering-panel.tsx` | 121 | `<TableCell className="text-right font-mono text-xs">{String(seq.nextNumber).padStart(seq.padding, "0")}</Table` |
| `settings/presets/numbering-panel.tsx` | 124 | `<span className="text-ink-faint text-xs font-mono mr-2 hidden sm:inline">{preview}</span>` |
| `settings/presets/exchange-rates-panel.tsx` | 134 | `<TableCell className="font-mono font-semibold">{r.fromCurrency} → {baseCurrency}</TableCell>` |
| `settings/presets/exchange-rates-panel.tsx` | 179 | `<TableCell className="font-mono">{r.fromCurrency} → {baseCurrency}</TableCell>` |
| `settings/presets/bundles-panel.tsx` | 202 | `{item.productName} <span className="text-ink-faint font-mono text-xs">{item.productSku}</span>` |
| `settings/organization/company-panels.tsx` | 148 | `<Input id="org-vat" name="vatNumber" defaultValue={org.vatNumber ?? ""} className="font-mono" />` |
| `settings/organization/company-panels.tsx` | 151 | `<Input id="org-tax-id" name="taxId" defaultValue={org.taxId ?? ""} className="font-mono" />` |
| `settings/organization/company-panels.tsx` | 172 | `<div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Default Currency")}</span><` |
| `settings/organization/company-panels.tsx` | 259 | `<Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono uppercase" spellCheck={fa` |
| `settings/organization/company-panels.tsx` | 288 | `<Input value={overridden ? (value ?? "") : ""} placeholder={auto} onChange={(e) => onChange(e.target.value)} c` |
| `settings/security/security-client.tsx` | 267 | `<TableCell className="font-mono text-xs">{s.ipAddress ?? "—"}</TableCell>` |
| `settings/security/security-client.tsx` | 303 | `<TableCell className="font-mono text-xs">{e.type}</TableCell>` |
| `settings/security/security-client.tsx` | 308 | `<TableCell className="font-mono text-xs">{e.ipAddress ?? "—"}</TableCell>` |
| `settings/security/security-client.tsx` | 335 | `<div className="text-center text-[11px] text-ink-faint font-mono break-all">{secret}</div>` |
| `settings/security/security-client.tsx` | 350 | `<div className="grid grid-cols-2 gap-2 font-mono text-[13px]">` |
| `inventory/products/recycle-bin/page.tsx` | 51 | `<TableCell className="font-mono text-xs">{p.sku}</TableCell>` |
| `inventory/products/page.tsx` | 82 | `<TableCell className="font-mono text-xs">{p.sku}</TableCell>` |
| `clients/[id]/page.tsx` | 81 | `{client.vatNumber && <div className="flex justify-between"><span className="text-ink-faint">{t(locale, taxLabe` |
| `clients/[id]/page.tsx` | 82 | `{client.taxId && <div className="flex justify-between"><span className="text-ink-faint">{t(locale, taxLabels.r` |
| `clients/[id]/page.tsx` | 97 | `<span className="font-mono">{inv.invoiceNumber}</span>` |
| `clients/client-form.tsx` | 102 | `<Input id="vatNumber" name="vatNumber" defaultValue={client?.vatNumber ?? ""} placeholder="3000..." className=` |
| `clients/client-form.tsx` | 105 | `<Input id="taxId" name="taxId" defaultValue={client?.taxId ?? ""} placeholder={labels.registrationPlaceholder}` |
| `documents/_workspace/import-v2-dialog.tsx` | 448 | `<td className="p-2 font-mono">{d.number}</td>` |
| `purchasing/vendors/[id]/page.tsx` | 86 | `<span className="font-mono">{po.poNumber}</span>` |
| `purchasing/vendors/vendor-form.tsx` | 67 | `<Input id="vatNumber" name="vatNumber" defaultValue={vendor?.vatNumber ?? ""} className="font-mono" />` |
| `purchasing/vendors/vendor-form.tsx` | 70 | `<Input id="taxId" name="taxId" defaultValue={vendor?.taxId ?? ""} className="font-mono" />` |
| `purchasing/orders/po-list-client.tsx` | 150 | `<Link href={`/purchasing/orders/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `purchasing/orders/[id]/page.tsx` | 99 | `<h3 className="mono">{po.poNumber}</h3>` |
| `purchasing/debit-notes/dn-list-client.tsx` | 141 | `<Link href={`/purchasing/debit-notes/${r.id}`} className="hover:text-brand-orange font-mono">` |
| `purchasing/debit-notes/dn-list-client.tsx` | 148 | `<TableCell className="text-ink-muted font-mono text-xs">` |
| `purchasing/debit-notes/[id]/page.tsx` | 77 | `<h3 className="mono">{dn.debitNoteNumber}</h3>` |

Stylesheet rules kept in Mono: `.mono` (legacy code class), `.doc-field .input` (document-number box), `.cc-formula`, `.hash-strip`, `.cmdk-kbd`, `.acct-row .code`, `.badge-zatca`; print `.print-root .mono`, `.bank-block .v` (account numbers / IBAN). Ambiguous rules are listed below.

## Ambiguous — left in Mono for an owner/reviewer decision — 8 call sites + 6 rules

| Where | Why ambiguous |
|---|---|
| `sales/quotations/quotations-list-client.tsx:167` | empty placeholder dash in a code column |
| `finance/bank-accounts/bank-account-form-dialog.tsx:219` | journal formula line mixing account codes and an amount |
| `settings/team/team-panel.tsx:113` | member email |
| `settings/presets/simple-preset-panel.tsx:87` | mixed column: Rate % / Net Days / Abbreviation / Days per Year in one cell |
| `clients/page.tsx:98` | phone number |
| `documents/_workspace/import-v2-dialog.tsx:370` | phone number (import preview) |
| `purchasing/vendors/page.tsx:84` | phone number |
| `purchasing/orders/po-list-client.tsx:157` | empty placeholder dash in a code column |
| `mockup-parity.css` `.zatca-fields .v` | ZATCA panel values mix the VAT number (code) with a timestamp / amount |
| `mockup-parity.css` `.org-pill` | meta pill used for dates, labels and code · name pairs |
| `mockup-parity.css` `.acct-group-label` | uppercase account-group heading (a label, neither code nor number) |
| `mockup-parity.css` `.doc-field .input` (non-date children) | Payment Terms / Project selects in the document-number-style box render in Mono (editor shell, DEV-UI-01.6) |
| `print.css` `.pdf-meta .v` | PDF header values mix document number with dates |
| `print.css` `.seal-mark .t2` | decorative seal caption |

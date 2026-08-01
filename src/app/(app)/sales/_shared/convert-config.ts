import type { LucideIcon } from "lucide-react";
import { ClipboardList, FileText, Receipt, Truck, ShoppingCart, FileMinus, FilePlus } from "lucide-react";

import { convertToSalesOrderAction, convertToProformaAction, convertToInvoiceAction, convertToDeliveryChallanAction } from "../quotations/actions";
import { convertSoToProformaAction, convertSoToInvoiceAction, convertSoToDeliveryChallanAction } from "../orders/actions";
import { convertProformaToInvoiceAction, convertProformaToDeliveryChallanAction } from "../proforma/actions";
import { convertInvoiceToDeliveryChallanAction } from "../invoices/actions";

// Single source of truth for document conversions. Both the list/detail three-dot menu and the
// document Preview "Convert to…" menu build their options from getConvertTargets(), so the two
// always show exactly the same targets, order, labels, icons, status/permission gating, and run the
// same conversion action. No location keeps its own hardcoded list (Issue #9).
//
// Conversions come in two shapes, matching the existing behaviour:
//  - action: an in-place server action that creates the target document and redirects to it on
//    success (source references, client/vendor, items, taxes, currency, terms, notes, etc. are all
//    copied by the action itself — nothing is duplicated).
//  - href: navigates to the target's create page prefilled from the source (Credit/Debit Note and
//    Purchase Order, which need user input before posting).

export type ConvertSource = "quotation" | "sales_order" | "proforma" | "invoice" | "purchase_order";

// State the availability rules need: the document status and, where relevant, whether it has
// already been converted (so an existing conversion removes the option in both menus).
export type ConvertCtx = { status: string; converted?: boolean };

export type ConvertTarget = {
  key: string;
  labelKey: string; // i18n key (existing dict entries)
  icon: LucideIcon;
  action?: (id: number) => Promise<{ error?: string }>;
  href?: (id: number) => string;
};

type Entry = ConvertTarget & { available: (ctx: ConvertCtx) => boolean };

const always = () => true;
// Invoices only convert once issued (not draft) and not after being voided.
const invoiceLive = (c: ConvertCtx) => c.status !== "draft" && c.status !== "void";
// Proforma conversions disappear once it has been converted to a sales invoice.
const notConverted = (c: ConvertCtx) => !c.converted;

const REGISTRY: Record<ConvertSource, Entry[]> = {
  quotation: [
    { key: "sales_order", labelKey: "Sales Order", icon: ClipboardList, action: convertToSalesOrderAction, available: always },
    { key: "proforma", labelKey: "Proforma Invoice", icon: FileText, action: convertToProformaAction, available: always },
    { key: "invoice", labelKey: "Invoice", icon: Receipt, action: convertToInvoiceAction, available: always },
    { key: "delivery_challan", labelKey: "Delivery Challan", icon: Truck, action: convertToDeliveryChallanAction, available: always },
    { key: "purchase_order", labelKey: "Purchase Order", icon: ShoppingCart, href: (id) => `/purchasing/orders/new?fromQuotation=${id}`, available: always },
  ],
  sales_order: [
    { key: "proforma", labelKey: "Proforma Invoice", icon: FileText, action: convertSoToProformaAction, available: always },
    { key: "invoice", labelKey: "Invoice", icon: Receipt, action: convertSoToInvoiceAction, available: always },
    { key: "delivery_challan", labelKey: "Delivery Challan", icon: Truck, action: convertSoToDeliveryChallanAction, available: always },
    { key: "purchase_order", labelKey: "Purchase Order", icon: ShoppingCart, href: (id) => `/purchasing/orders/new?fromSalesOrder=${id}`, available: always },
  ],
  proforma: [
    { key: "invoice", labelKey: "Invoice", icon: Receipt, action: convertProformaToInvoiceAction, available: notConverted },
    { key: "delivery_challan", labelKey: "Delivery Challan", icon: Truck, action: convertProformaToDeliveryChallanAction, available: notConverted },
    { key: "purchase_order", labelKey: "Purchase Order", icon: ShoppingCart, href: (id) => `/purchasing/orders/new?fromProforma=${id}`, available: notConverted },
  ],
  invoice: [
    { key: "credit_note", labelKey: "Credit Note", icon: FileMinus, href: (id) => `/sales/credit-notes/new?invoice=${id}`, available: invoiceLive },
    { key: "delivery_challan", labelKey: "Delivery Challan", icon: Truck, action: convertInvoiceToDeliveryChallanAction, available: invoiceLive },
    { key: "purchase_order", labelKey: "Purchase Order", icon: ShoppingCart, href: (id) => `/purchasing/orders/new?fromInvoice=${id}`, available: invoiceLive },
  ],
  purchase_order: [
    { key: "debit_note", labelKey: "Debit Note", icon: FilePlus, href: (id) => `/purchasing/debit-notes/new?po=${id}`, available: (c) => c.status === "received" },
  ],
};

// The ordered list of conversion targets currently allowed for a document. Returns [] when none
// apply (e.g. a draft/void invoice, or an already-converted proforma) — callers then render no menu.
export function getConvertTargets(source: ConvertSource, ctx: ConvertCtx): ConvertTarget[] {
  return REGISTRY[source]
    .filter((e) => e.available(ctx))
    .map((e) => ({ key: e.key, labelKey: e.labelKey, icon: e.icon, action: e.action, href: e.href }));
}

// Execute a conversion the same way from every menu: navigate for href targets, or run the server
// action (which redirects to the new document on success) and surface any error via onError.
export function runConvertTarget(
  target: ConvertTarget,
  id: number,
  start: (fn: () => void) => void,
  onError: (message: string) => void,
): void {
  if (target.href) {
    window.location.assign(target.href(id));
    return;
  }
  const action = target.action;
  if (!action) return;
  start(async () => {
    const result = await action(id);
    if (result?.error) onError(result.error);
  });
}

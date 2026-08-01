"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { t, type Locale } from "@/lib/i18n/dict";

// Slug → filename label, mirroring the server route's DOC_TYPES. Only used to build a fallback
// filename; normally the name comes from the server's Content-Disposition header.
const TYPE_LABELS: Record<string, string> = {
  quotation: "Quotation",
  "sales-order": "Sales-Order",
  proforma: "Proforma-Invoice",
  invoice: "Invoice",
  "delivery-challan": "Delivery-Challan",
  "credit-note": "Credit-Note",
  "purchase-order": "Purchase-Order",
  "debit-note": "Debit-Note",
};

function fallbackName(type: string, number?: string): string {
  const label = TYPE_LABELS[type] ?? "Document";
  const raw = number ? `${label}-${number}` : label;
  return `${raw.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}.pdf`;
}

// Fetch the document PDF from the shared server route and trigger an immediate browser download —
// no navigation, no print page, no new tab. Reuses the existing print layout via
// /api/document-pdf/[type]/[id] (one generator for every document type, org-scoped + auth-checked
// server-side). Throws on any failure so callers surface an error and never save an empty file.
export async function downloadDocumentPdf(type: string, id: number, number?: string): Promise<void> {
  const res = await fetch(`/api/document-pdf/${type}/${id}`, { headers: { Accept: "application/pdf" } });
  if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
  const blob = await res.blob();
  // Guard against an error body slipping through as a "download" (empty/corrupt file protection).
  if (blob.type !== "application/pdf" || blob.size < 1000) throw new Error("Empty or invalid PDF");

  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = decodeURIComponent(match?.[1] ?? "") || fallbackName(type, number);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the browser has claimed the blob for the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The document-page "Download PDF" button. Disabled + labelled while generating (which also blocks
// duplicate downloads from repeated clicks); on failure it toasts an error and re-enables.
export function DownloadPdfButton({
  locale,
  type,
  docId,
  number,
}: {
  locale: Locale;
  type: string;
  docId: number;
  number?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return; // guard against duplicate downloads while one is in flight
    setBusy(true);
    try {
      await downloadDocumentPdf(type, docId, number);
    } catch {
      toast.error(t(locale, "PDF download failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-glass"
      style={{ width: "auto", padding: "0 14px" }}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
    >
      <Download className="size-3.5" /> {busy ? t(locale, "Generating PDF…") : t(locale, "Download PDF")}
    </button>
  );
}

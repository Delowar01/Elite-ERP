import { fmt } from "../../(app)/sales/_shared/totals";
import type { Org } from "@/db";

// Server-rendered building blocks for the print/PDF documents, mirroring the approved
// PDF-templates mockup's helpers (pdf_header / party / items_table_* / totals_box / …)
// one-for-one. English-only by design: formal outbound documents follow the approved
// mockup, which was designed in English (bilingual PDFs are future scope).

export function A4Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-wrap">
      <div className="a4-page">
        <div className="a4-body">{children}</div>
      </div>
    </div>
  );
}

export function PdfHeader({
  docLabel,
  numberLabel,
  numberVal,
  dateVal,
  extraLabel,
  extraVal,
  org,
}: {
  docLabel: string;
  numberLabel: string;
  numberVal: string;
  dateVal: string;
  extraLabel?: string;
  extraVal?: string | null;
  org: Org;
}) {
  return (
    <div className="pdf-header-row">
      <div className="pdf-meta">
        <div className="row">
          <span className="k">{numberLabel}</span>
          <span className="sep">:</span>
          <span className="v">{numberVal}</span>
        </div>
        <div className="row">
          <span className="k">Date</span>
          <span className="sep">:</span>
          <span className="v">{dateVal}</span>
        </div>
        {extraLabel && extraVal ? (
          <div className="row">
            <span className="k">{extraLabel}</span>
            <span className="sep">:</span>
            <span className="v">{extraVal}</span>
          </div>
        ) : null}
      </div>
      <div className="pdf-badge">{docLabel}</div>
      <div className="pdf-brand">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt={org.name} />
        ) : (
          <div>
            <div className="word1">Elite ERP</div>
            <div className="word2">{org.name}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export type PartyLine = { label?: string; value: string };

export function Party({ label, name, lines, tint }: { label: string; name: string; lines: PartyLine[]; tint?: boolean }) {
  return (
    <div className={tint ? "pdf-party tint" : "pdf-party"}>
      <div className="lbl">{label}</div>
      <div className="name">{name}</div>
      {lines.map((line, i) => (
        <div key={i} className="line">
          {line.label ? (
            <>
              <b>{line.label}</b> : {line.value}
            </>
          ) : (
            line.value
          )}
        </div>
      ))}
    </div>
  );
}

export function Parties({ children }: { children: React.ReactNode }) {
  return <div className="pdf-parties">{children}</div>;
}

export function orgPartyLines(org: Org): PartyLine[] {
  const lines: PartyLine[] = [];
  if (org.address) lines.push({ label: "Address", value: org.address });
  if (org.vatNumber) lines.push({ label: "VAT No.", value: org.vatNumber });
  if (org.taxId) lines.push({ label: "CR No.", value: org.taxId });
  return lines;
}

export type FullItemRow = {
  name: string;
  vatPercent: string;
  quantity: string;
  rate: string;
};

export function ItemsTableFull({ items }: { items: FullItemRow[] }) {
  return (
    <div className="pdf-items-wrap">
      <table className="pdf-items">
        <thead>
          <tr>
            <th>Item Description</th>
            <th className="num">VAT %</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amount</th>
            <th className="num">VAT Amt</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const amount = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
            const vatAmt = amount * ((Number(it.vatPercent) || 0) / 100);
            return (
              <tr key={i}>
                <td>
                  <div className="item-name">{it.name}</div>
                </td>
                <td className="num">{Number(it.vatPercent)}%</td>
                <td className="num">{Number(it.quantity)}</td>
                <td className="num">{fmt(it.rate)}</td>
                <td className="num">{fmt(amount)}</td>
                <td className="num">{fmt(vatAmt)}</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmt(amount + vatAmt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ItemsTableSimple({ items }: { items: { name: string; quantity: string; rate: string }[] }) {
  return (
    <div className="pdf-items-wrap">
      <table className="pdf-items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="item-name">{it.name}</td>
              <td className="num">{Number(it.quantity)}</td>
              <td className="num">{fmt(it.rate)}</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {fmt((Number(it.quantity) || 0) * (Number(it.rate) || 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ItemsTableQty({ items }: { items: { name: string; quantity: string }[] }) {
  return (
    <div className="pdf-items-wrap">
      <table className="pdf-items qty-table">
        <thead>
          <tr>
            <th>Item Description</th>
            <th className="num">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>
                <div className="item-name">{it.name}</div>
              </td>
              <td className="num">{Number(it.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TotalsBox({ rows, grandLabel, grandVal }: { rows: [string, string][]; grandLabel: string; grandVal: string }) {
  return (
    <div className="totals-box">
      {rows.map(([k, v], i) => (
        <div key={i} className="t-row">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      <div className="t-row grand">
        <span className="k">{grandLabel}</span>
        <span className="v">{grandVal}</span>
      </div>
    </div>
  );
}

export function AmountWords({ words }: { words: string }) {
  return (
    <div className="pdf-words">
      <b>TOTAL Amount In Words:</b> <span className="val">{words}</span>
    </div>
  );
}

export function BankBlock({ account }: { account: { name: string; bankName: string | null; accountNumberMasked: string | null } | null }) {
  if (!account) return null;
  const rows: [string, string][] = [["Account Name", account.name]];
  if (account.accountNumberMasked) rows.push(["Account Number", account.accountNumberMasked]);
  if (account.bankName) rows.push(["Bank Name", account.bankName]);
  return (
    <div className="bank-block">
      <div className="lbl">Bank Details</div>
      {rows.map(([k, v], i) => (
        <div key={i} className="row">
          <span className="k">{k}</span>
          <span className="sep">:</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function NotesBlock({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <div className="notes-block">
      <b>Note:</b> {notes}
    </div>
  );
}

export function ApprovalBlock() {
  return (
    <div className="approval-block">
      <div className="title">APPROVED BY:</div>
      <div className="approval-grid">
        <div className="f">Name</div>
        <div className="f">Date</div>
        <div className="f">Designation</div>
        <div className="f">Signature &amp; Stamp</div>
      </div>
    </div>
  );
}

export function SealSignature({ org, showSignature = true }: { org: Org; showSignature?: boolean }) {
  return (
    <div className="seal-sig-row">
      {showSignature && (
        <div className="sig-slot">
          <div className="box">
            {org.signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.signatureUrl} alt="Signature" />
            ) : null}
          </div>
          <div className="cap">Authorized Signature</div>
        </div>
      )}
      <div className="seal-mark">
        {org.sealUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.sealUrl} alt="Seal" />
        ) : (
          <div className="seal-ring-outer">
            <div className="seal-ring-inner">
              <div className="t1">{org.name}</div>
              <div className="star">✦ ✦ ✦</div>
              <div className="t2">OFFICIAL SEAL</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function QrPanel({ dataUrl }: { dataUrl: string }) {
  return (
    <div className="qr-panel">
      <div className="qr-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="ZATCA e-invoice QR" />
      </div>
    </div>
  );
}

export function ClientComments() {
  return (
    <div className="client-comments">
      <div className="lbl">Client Comments</div>
      <div className="box"></div>
    </div>
  );
}

export function PdfFooter({ org, extraNote }: { org: Org; extraNote?: string }) {
  const parts: React.ReactNode[] = [];
  if (org.phone) parts.push(<span key="p">Cell: <b>{org.phone}</b></span>);
  if (org.email) parts.push(<span key="e">E-mail: <b>{org.email}</b></span>);
  return (
    <div className="pdf-footer">
      {parts.length > 0
        ? parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <> &nbsp;|&nbsp; </>}
              {p}
            </span>
          ))
        : org.name}
      {extraNote && <span className="sys-note">{extraNote}</span>}
    </div>
  );
}

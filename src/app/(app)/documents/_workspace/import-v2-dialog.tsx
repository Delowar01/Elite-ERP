"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import type { FieldSpec } from "@/lib/import/spec";
import {
  parseImportFileAction, previewImportAction, commitImportV2Action, previewErrorCsvAction,
} from "./import-v2-actions";

// The per-module Import modal: template -> upload -> column mapping -> validation preview ->
// confirmation -> result. Everything happens in-page; nothing is saved until Confirm Import.

type Step = "upload" | "mapping" | "preview" | "done";
const NONE = "__none__"; // Select needs a non-empty value for "ignore this field"

type PreviewData = {
  summary: {
    totalRows: number; documents: number; validDocuments: number; invalidDocuments: number;
    duplicateNumbers: string[]; willCreate: number; lineItems: number; totalLineItems: number;
    conflictingDocuments: number; invalidRows: number;
  };
  documents: { key: string; number: string; client: string; lineCount: number; rows: number[]; ok: boolean; errors: string[]; conflicts: string[] }[];
  rowErrors: [number, string[]][];
};

type Result = { imported: number; updated: number; skipped: number; failed: number; total: number; lineItems: number; errorCsv?: string };

function downloadText(name: string, text: string, mime = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ImportV2Dialog({ locale, module, moduleLabel, fields }: {
  locale: Locale; module: string; moduleLabel: string; fields: FieldSpec[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);      // preserved while mapping changes
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields]);
  const missingRequired = requiredFields.filter((f) => (mapping[f.key] ?? -1) < 0);

  function reset() {
    setStep("upload"); setFileName(""); setHeaders([]); setRows([]);
    setMapping({}); setPreview(null); setResult(null); setDragging(false);
  }

  function handleFile(file: File) {
    setFileName(file.name);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const res = await parseImportFileAction(module, form);
      if (res.error) { toast.error(res.error); setFileName(""); return; }
      setHeaders(res.headers ?? []);
      setRows(res.rows ?? []);
      setMapping(res.mapping ?? {});
      setStep("mapping");
    });
  }

  function runPreview() {
    startTransition(async () => {
      const res = await previewImportAction(module, rows, mapping);
      if (res.error) { toast.error(res.error); return; }
      if (res.missingRequired?.length) { toast.error(`${t(locale, "Map the required columns first:")} ${res.missingRequired.join(", ")}`); return; }
      setPreview(res.preview as PreviewData);
      setStep("preview");
    });
  }

  function confirmImport() {
    startTransition(async () => {
      const res = await commitImportV2Action(module, headers, rows, mapping);
      if (res.error) { toast.error(res.error); return; }
      setResult(res as Result);
      setStep("done");
      router.refresh();
    });
  }

  function downloadErrors() {
    startTransition(async () => {
      const res = await previewErrorCsvAction(module, headers, rows, mapping);
      if (res.error) { toast.error(res.error); return; }
      if (!res.csv) { toast.success(t(locale, "No invalid rows.")); return; }
      downloadText(`${module}-import-errors.csv`, res.csv);
    });
  }

  const s = preview?.summary;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-glass">
          <Upload className="size-3.5" /> <span>{t(locale, "Import")}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "Import")} — {t(locale, moduleLabel)}</DialogTitle>
        </DialogHeader>

        {/* ---------- Step 1: template + upload ---------- */}
        {step === "upload" && (
          <div className="flex flex-col gap-4">
            <p className="text-[12.5px] text-ink-muted">
              {t(locale, "Imported documents are created as Draft only — nothing is posted to the ledger or stock. Download the template, fill it in, then upload it to preview before anything is saved.")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a className="btn btn-glass" style={{ width: "auto" }} href={`/api/import-template/${module}?format=xlsx`}>
                <FileSpreadsheet className="size-3.5" /> {t(locale, "Download Template")} (.xlsx)
              </a>
              <a className="btn btn-glass" style={{ width: "auto" }} href={`/api/import-template/${module}?format=csv`}>
                <Download className="size-3.5" /> .csv
              </a>
            </div>

            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragging ? "border-brand-orange bg-brand-orange/5" : "border-line-strong hover:bg-canvas"}`}
            >
              <Upload className="size-6 mx-auto mb-2 text-ink-faint" />
              <div className="text-[13px] font-semibold">{fileName || t(locale, "Drag and drop a file here, or click to choose")}</div>
              <div className="text-[11.5px] text-ink-faint mt-1">{t(locale, "Supported: .xlsx and .csv (max 10 MB)")}</div>
              <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
            {pending && <p className="text-[12px] text-ink-muted">{t(locale, "Reading file…")}</p>}
          </div>
        )}

        {/* ---------- Step 2: column mapping ---------- */}
        {step === "mapping" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[12.5px]">
                <span className="font-semibold">{fileName}</span>
                <span className="text-ink-muted"> — {rows.length} {t(locale, "rows")}, {headers.length} {t(locale, "columns")}</span>
              </div>
              <button type="button" className="text-[12px] text-ink-muted hover:text-brand-orange inline-flex items-center gap-1" onClick={reset}>
                <ArrowLeft className="size-3" /> {t(locale, "Choose a different file")}
              </button>
            </div>
            {missingRequired.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-[12px] text-danger">
                <AlertTriangle className="size-4 shrink-0 mt-px" />
                <span>{t(locale, "Map the required columns first:")} {missingRequired.map((f) => f.header).join(", ")}</span>
              </div>
            )}
            <div className="max-h-[42vh] overflow-auto rounded-[10px] border border-line">
              <table className="w-full text-[12px]">
                <thead className="bg-canvas sticky top-0">
                  <tr>
                    <th className="text-start p-2">{t(locale, "Elite ERP field")}</th>
                    <th className="text-start p-2 w-[46%]">{t(locale, "Column in your file")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key} className="border-t border-line">
                      <td className="p-2">
                        <div className="font-semibold">
                          {f.header} {f.required && <span className="text-danger">*</span>}
                        </div>
                        <div className="text-[11px] text-ink-faint">{f.scope === "line" ? t(locale, "Line item") : t(locale, "Document")}</div>
                      </td>
                      <td className="p-2">
                        <Select
                          value={(mapping[f.key] ?? -1) >= 0 ? String(mapping[f.key]) : NONE}
                          onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NONE ? -1 : Number(v) }))}
                        >
                          <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t(locale, "— Ignore —")}</SelectItem>
                            {headers.map((h, i) => (<SelectItem key={i} value={String(i)}>{h || `#${i + 1}`}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" style={{ width: "auto" }} onClick={reset}>{t(locale, "Cancel")}</Button>
              <Button style={{ width: "auto" }} disabled={pending || missingRequired.length > 0} onClick={runPreview}>
                {pending ? t(locale, "Validating…") : t(locale, "Validate")}
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 3: validation preview ---------- */}
        {step === "preview" && s && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "Total rows", value: s.totalRows },
                { label: "Documents detected", value: s.documents },
                { label: "Line items detected", value: s.totalLineItems },
                { label: "Will be created", value: s.willCreate, tone: "text-success" },
                { label: "Invalid", value: s.invalidDocuments, tone: s.invalidDocuments ? "text-danger" : "" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-line p-2.5">
                  <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">{t(locale, k.label)}</div>
                  <div className={`text-[17px] font-bold ${k.tone ?? ""}`}>{k.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-muted">
              {t(locale, "Line items to create:")} {s.lineItems}
              {s.duplicateNumbers.length > 0 && (
                <> · <span className="text-danger">{t(locale, "Duplicate document numbers:")} {s.duplicateNumbers.join(", ")}</span></>
              )}
              {s.conflictingDocuments > 0 && (
                <> · <span className="text-danger">{t(locale, "Documents with conflicting values:")} {s.conflictingDocuments}</span></>
              )}
            </p>

            <div className="max-h-[38vh] overflow-auto rounded-[10px] border border-line">
              <table className="w-full text-[12px]">
                <thead className="bg-canvas sticky top-0">
                  <tr>
                    <th className="text-start p-2 w-8" />
                    <th className="text-start p-2">{t(locale, "Number")}</th>
                    <th className="text-start p-2">{t(locale, "Client")}</th>
                    <th className="text-start p-2">{t(locale, "Items")}</th>
                    <th className="text-start p-2">{t(locale, "Rows")}</th>
                    <th className="text-start p-2">{t(locale, "Errors")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.documents.map((d) => (
                    <tr key={d.key} className="border-t border-line align-top">
                      <td className="p-2">{d.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}</td>
                      <td className="p-2 font-mono">{d.number}</td>
                      <td className="p-2">{d.client || "—"}</td>
                      <td className="p-2">{d.lineCount}</td>
                      <td className="p-2 text-ink-faint font-mono">{d.rows.join(", ")}</td>
                      <td className="p-2 text-danger">{d.errors.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <button type="button" className="text-[12px] text-ink-muted hover:text-brand-orange inline-flex items-center gap-1" onClick={() => setStep("mapping")}>
                  <ArrowLeft className="size-3" /> {t(locale, "Back to mapping")}
                </button>
                {s.invalidRows > 0 && (
                  <Button variant="glass" style={{ width: "auto" }} onClick={downloadErrors} disabled={pending}>
                    <Download className="size-3.5" /> {t(locale, "Download invalid rows")}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" style={{ width: "auto" }} onClick={() => { setOpen(false); reset(); }}>{t(locale, "Cancel")}</Button>
                <Button style={{ width: "auto" }} disabled={pending || s.willCreate === 0} onClick={confirmImport}>
                  {pending ? t(locale, "Importing…") : `${t(locale, "Confirm Import")} (${s.willCreate})`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- Step 4: result ---------- */}
        {step === "done" && result && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "Imported", value: result.imported, tone: "text-success" },
                { label: "Updated", value: result.updated },
                { label: "Skipped", value: result.skipped },
                { label: "Failed", value: result.failed, tone: result.failed ? "text-danger" : "" },
                { label: "Total processed", value: result.total },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-line p-2.5">
                  <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">{t(locale, k.label)}</div>
                  <div className={`text-[17px] font-bold ${k.tone ?? ""}`}>{k.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-ink-muted">
              {t(locale, "Line items created:")} {result.lineItems} · {t(locale, "Imported documents are Drafts and were not posted.")}
            </p>
            <div className="flex items-center justify-end gap-2">
              {result.errorCsv && (
                <Button variant="glass" style={{ width: "auto" }} onClick={() => downloadText(`${module}-import-errors.csv`, result.errorCsv!)}>
                  <Download className="size-3.5" /> {t(locale, "Download error file")}
                </Button>
              )}
              <Button style={{ width: "auto" }} onClick={() => { setOpen(false); reset(); }}>{t(locale, "Done")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Download, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ImportColumn, ImportRowResult } from "@/lib/document-list-workspace";
import { previewImportAction, commitImportAction } from "./import-actions";

// Minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function ImportDialog({ locale, module, importColumns }: { locale: Locale; module: string; importColumns: ImportColumn[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setRows([]);
    setFileName("");
    setResults(null);
  }

  function downloadTemplate() {
    const header = importColumns.map((c) => c.header).join(",");
    const sample = importColumns.map((c) => (c.note ? `(${c.note})` : "")).join(",");
    const blob = new Blob(["﻿" + header + "\r\n" + sample + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${module}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result || ""));
      if (grid.length < 2) { toast.error(t(locale, "The file has no data rows.")); reset(); return; }
      const headers = grid[0].map((h) => h.trim().toLowerCase());
      // map each importColumn.key to its column index by matching the header label
      const idx: Record<string, number> = {};
      for (const col of importColumns) {
        const i = headers.indexOf(col.header.toLowerCase());
        idx[col.key] = i;
      }
      const parsed = grid.slice(1).map((cells) => {
        const obj: Record<string, string> = {};
        for (const col of importColumns) obj[col.key] = idx[col.key] >= 0 ? (cells[idx[col.key]] ?? "").trim() : "";
        return obj;
      });
      setRows(parsed);
      setResults(null);
      startTransition(async () => {
        const res = await previewImportAction(module, parsed);
        if (res.error) { toast.error(res.error); return; }
        setResults(res.results ?? []);
      });
    };
    reader.readAsText(file);
  }

  function commit() {
    startTransition(async () => {
      const res = await commitImportAction(module, rows);
      if (res.error) { toast.error(res.error); return; }
      toast.success(t(locale, "Imported {n} record(s).").replace("{n}", String(res.inserted ?? 0)));
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const validCount = results ? results.filter((r) => r.ok).length : 0;
  const invalidCount = results ? results.length - validCount : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-glass">
          <Upload className="size-3.5" /> <span>{t(locale, "Import")}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(locale, "Import")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-muted">
            {t(locale, "Import creates draft records only — nothing is posted to the ledger or stock. Download the template, fill it in, then upload to preview.")}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="glass" style={{ width: "auto" }} onClick={downloadTemplate}>
              <Download className="size-3.5" /> {t(locale, "Download Template")}
            </Button>
            <label className="btn btn-glass cursor-pointer" style={{ width: "auto" }}>
              <Upload className="size-3.5" /> {fileName || t(locale, "Choose CSV File")}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          </div>

          {results && (
            <>
              <div className="flex items-center gap-4 text-[13px]">
                <span className="text-success flex items-center gap-1"><CheckCircle2 className="size-4" /> {validCount} {t(locale, "valid")}</span>
                {invalidCount > 0 && <span className="text-danger flex items-center gap-1"><XCircle className="size-4" /> {invalidCount} {t(locale, "with errors")}</span>}
              </div>
              <div className="max-h-[320px] overflow-auto rounded-[10px] border border-line">
                <table className="w-full text-[12px]">
                  <thead className="bg-canvas sticky top-0">
                    <tr>
                      <th className="text-start p-2 w-12">#</th>
                      <th className="text-start p-2 w-16">{t(locale, "Status")}</th>
                      <th className="text-start p-2">{t(locale, "Errors")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.row} className="border-t border-line">
                        <td className="p-2 font-mono text-ink-muted">{r.row}</td>
                        <td className="p-2">{r.ok ? <span className="text-success">✓</span> : <span className="text-danger">✗</span>}</td>
                        <td className="p-2 text-danger">{r.errors.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" style={{ width: "auto" }} onClick={() => { setOpen(false); reset(); }}>
                  {t(locale, "Cancel")}
                </Button>
                <Button style={{ width: "auto" }} disabled={pending || validCount === 0} onClick={commit}>
                  {t(locale, "Import {n} valid record(s)").replace("{n}", String(validCount))}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n/dict";
import { getDocumentSequenceAction, saveDocumentSequenceAction, type SequenceDTO } from "./creation-popup-actions";

// In-page popup for the document-number gear: edit the numbering rule (prefix / next number /
// padding) for this document type without leaving the creation page. On save the form refreshes
// so the number preview follows the new rule; unsaved form data is preserved.
export function NumberSettingsDialog({ locale, documentType, trigger }: { locale: Locale; documentType: string; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState<SequenceDTO | null>(null);
  const [prefix, setPrefix] = useState("");
  const [next, setNext] = useState("");
  const [padding, setPadding] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();

  // Load the numbering rule when the dialog opens (event handler, not an effect — no cascading
  // renders, and the fetch only fires on the actual open action).
  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) return;
    setLoading(true);
    getDocumentSequenceAction(documentType)
      .then((s) => { if (s) { setSeq(s); setPrefix(s.prefix); setNext(String(s.nextNumber)); setPadding(String(s.padding)); } })
      .finally(() => setLoading(false));
  }

  function save() {
    if (!seq) return;
    start(async () => {
      const res = await saveDocumentSequenceAction(seq.id, prefix, next, padding);
      if (res.error) toast.error(res.error);
      else { toast.success(t(locale, "Saved")); setOpen(false); router.refresh(); }
    });
  }

  const sample = prefix + String(next || "1").padStart(Number(padding) || 1, "0");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(locale, "Document Numbering")}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-[12.5px] text-ink-faint py-3">{t(locale, "Loading…")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ns-prefix">{t(locale, "Prefix")}</Label>
              <Input id="ns-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ns-next">{t(locale, "Next Number")}</Label>
                <Input id="ns-next" type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ns-pad">{t(locale, "Padding")}</Label>
                <Input id="ns-pad" type="number" min={1} max={10} value={padding} onChange={(e) => setPadding(e.target.value)} />
              </div>
            </div>
            <p className="text-[11.5px] text-ink-faint">{t(locale, "Next document")}: <span className="font-mono text-ink">{sample}</span></p>
          </div>
        )}
        <DialogFooter className="flex-row items-center justify-between gap-2">
          <Link href="/settings/presets" className="text-[12px] text-ink-muted hover:text-brand-orange inline-flex items-center gap-1" target="_blank" rel="noreferrer">
            <ExternalLink className="size-3" /> {t(locale, "Open Full Settings")}
          </Link>
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <button type="button" className="btn btn-glass" disabled={pending}>{t(locale, "Cancel")}</button>
            </DialogClose>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending || !seq}>{pending ? t(locale, "Saving…") : t(locale, "Save")}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { uploadSealSignatureAction } from "@/app/(app)/settings/organization/actions";

// In-page popup to upload the org seal/signature from the document creation page — no redirect to
// Business Settings. The file is stored via the existing upload action; on success the form is
// refreshed so the preview appears immediately, preserving the rest of the unsaved form.
export function SealSignatureUploadDialog({ locale, kind, trigger }: { locale: Locale; kind: "seal" | "signature"; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const title = kind === "seal" ? t(locale, "Upload Seal") : t(locale, "Upload Signature");

  function save() {
    const file = inputRef.current?.files?.[0];
    if (!file) { toast.error(t(locale, "Choose a file to upload.")); return; }
    const fd = new FormData();
    fd.set(kind, file);
    start(async () => {
      const res = await uploadSealSignatureAction(fd);
      if (res.error) toast.error(res.error);
      else {
        toast.success(t(locale, "Saved"));
        setOpen(false);
        router.refresh(); // preview appears; unsaved form state preserved
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="text-[13px]" />
          <p className="text-[11.5px] text-ink-faint">{t(locale, "PNG or JPG. Reused on every document.")}</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="btn btn-glass" disabled={pending}>{t(locale, "Cancel")}</button>
          </DialogClose>
          <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>{pending ? t(locale, "Saving…") : t(locale, "Upload")}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

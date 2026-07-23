"use client";

import { useState, useRef, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Image as ImageIcon } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { uploadItemImageAction } from "./creation-popup-actions";

// In-page popup for a line item's image (Line Items → Add Image). Uploads immediately and returns
// the URL, which the caller stores on the line-item draft (persisted with the document on save).
// The thumbnail shows the current image; no redirect, unsaved form preserved.
export function ItemImageDialog({ locale, imageUrl, onUploaded }: { locale: Locale; imageUrl?: string; onUploaded: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function save() {
    const file = inputRef.current?.files?.[0];
    if (!file) { toast.error(t(locale, "Choose a file to upload.")); return; }
    const fd = new FormData();
    fd.set("image", file);
    start(async () => {
      const res = await uploadItemImageAction(fd);
      if (res.error || !res.url) toast.error(res.error ?? t(locale, "Upload failed."));
      else { onUploaded(res.url); toast.success(t(locale, "Saved")); setOpen(false); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="item-thumb" title={t(locale, "Add Image")} aria-label={t(locale, "Add Image")}>
          {imageUrl ? (
            <Image src={imageUrl} alt="" width={34} height={34} className="h-full w-full object-cover rounded-[6px]" unoptimized />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(locale, "Add Image")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="text-[13px]" />
          <p className="text-[11.5px] text-ink-faint">{t(locale, "PNG or JPG, up to 2 MB.")}</p>
          {imageUrl && (
            <div className="mt-1">
              <Image src={imageUrl} alt="" width={120} height={120} className="max-h-[120px] w-auto object-contain rounded-[8px] border border-line" unoptimized />
            </div>
          )}
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

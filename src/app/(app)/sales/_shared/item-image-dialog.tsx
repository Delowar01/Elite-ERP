"use client";

import Image from "next/image";
import { Image as ImageIcon } from "lucide-react";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { CROP_ITEM_IMAGE } from "@/components/upload/crop-configs";
import { t, type Locale } from "@/lib/i18n/dict";
import { uploadItemImageAction } from "./creation-popup-actions";

// In-page line-item image (Line Items → Add Image). The picked image is cropped 1:1 (→ 800×800) in
// the crop modal; only the cropped file is uploaded to Vercel Blob. The returned URL is stored on
// the line-item draft (persisted with the document on save). No redirect, unsaved form preserved.
export function ItemImageDialog({ locale, imageUrl, onUploaded }: { locale: Locale; imageUrl?: string; onUploaded: (url: string) => void }) {
  return (
    <CropImageUpload
      locale={locale}
      config={CROP_ITEM_IMAGE}
      trigger={
        <button type="button" className="item-thumb" title={t(locale, "Add Image")} aria-label={t(locale, "Add Image")}>
          {imageUrl ? (
            <Image src={imageUrl} alt="" width={34} height={34} className="h-full w-full object-cover rounded-[6px]" unoptimized />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </button>
      }
      onUpload={async (file) => {
        const fd = new FormData();
        fd.set("image", file);
        const res = await uploadItemImageAction(fd);
        if (res.error || !res.url) return { error: res.error ?? t(locale, "Upload failed.") };
        onUploaded(res.url);
      }}
    />
  );
}

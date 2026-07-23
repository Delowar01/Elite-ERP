"use client";

import { useRouter } from "next/navigation";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { CROP_SEAL, CROP_SIGNATURE } from "@/components/upload/crop-configs";
import { type Locale } from "@/lib/i18n/dict";
import { uploadSealSignatureAction } from "@/app/(app)/settings/organization/actions";

// In-page seal/signature upload from the document creation page — no redirect. The image is cropped
// to its fixed ratio (seal 1:1 → 600×600, signature 3:1 → 1200×400) in the crop modal, then only the
// cropped file is uploaded to Vercel Blob. On success the form refreshes so the preview appears
// immediately, preserving the rest of the unsaved form.
export function SealSignatureUploadDialog({ locale, kind, trigger }: { locale: Locale; kind: "seal" | "signature"; trigger: React.ReactNode }) {
  const router = useRouter();
  return (
    <CropImageUpload
      locale={locale}
      config={kind === "seal" ? CROP_SEAL : CROP_SIGNATURE}
      trigger={trigger}
      onUpload={async (file) => {
        const fd = new FormData();
        fd.set(kind, file);
        const res = await uploadSealSignatureAction(fd);
        if (res.error) return { error: res.error };
        router.refresh();
      }}
    />
  );
}

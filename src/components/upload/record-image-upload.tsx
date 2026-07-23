"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CropImageUpload, type CropConfig } from "./crop-image-upload";
import { t, type Locale } from "@/lib/i18n/dict";

// Small reusable "current image + upload (cropped)" widget for record edit pages (employee photo,
// client/vendor logo). The bound server action attaches the file to the record; on success the page
// refreshes so the new preview appears immediately. Tenant ownership is enforced server-side.
export function RecordImageUpload({
  locale,
  currentUrl,
  config,
  fieldName,
  label,
  round = false,
  action,
}: {
  locale: Locale;
  currentUrl?: string | null;
  config: CropConfig;
  fieldName: string;
  label: string;
  round?: boolean;
  action: (formData: FormData) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <div className={`size-16 overflow-hidden border border-line bg-canvas flex items-center justify-center ${round ? "rounded-full" : "rounded-[10px]"}`}>
        {currentUrl ? (
          <Image src={currentUrl} alt="" width={64} height={64} className="h-full w-full object-cover" unoptimized />
        ) : (
          <span className="text-[11px] text-ink-faint">{t(locale, "No image")}</span>
        )}
      </div>
      <CropImageUpload
        locale={locale}
        config={config}
        trigger={<Button type="button" size="sm">{t(locale, label)}</Button>}
        onUpload={async (file) => {
          const fd = new FormData();
          fd.set(fieldName, file);
          const r = await action(fd);
          if (r.error) return { error: r.error };
          router.refresh();
        }}
      />
    </div>
  );
}

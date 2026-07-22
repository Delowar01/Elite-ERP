"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, X, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { FavoriteItem } from "@/lib/favorites";
import { toggleFavoriteAction, removeFavoriteAction } from "@/app/(app)/favorites-actions";

// Topbar favorites (was a decorative disabled star). Shows the user's saved favorites and lets
// them add/remove the current page. Per-user; the list is loaded server-side and passed in.
export function FavoritesMenu({ locale, favorites, currentLabel }: { locale: Locale; favorites: FavoriteItem[]; currentLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isFavorited = favorites.some((f) => f.href === pathname);

  function toggleCurrent() {
    startTransition(async () => {
      const res = await toggleFavoriteAction(currentLabel, pathname);
      if (res.error) toast.error(res.error);
      else {
        toast.success(res.favorited ? t(locale, "Added to favorites.") : t(locale, "Removed from favorites."));
        router.refresh();
      }
    });
  }
  function remove(id: number) {
    startTransition(async () => {
      await removeFavoriteAction(id);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-icon-btn outline-none relative" aria-label={t(locale, "Favorites")}>
        <Star className="size-4" fill={isFavorited ? "currentColor" : "none"} style={isFavorited ? { color: "var(--brand-orange)" } : undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px] p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-line">
          <span className="text-[13px] font-semibold">{t(locale, "Favorites")}</span>
          <button type="button" onClick={toggleCurrent} disabled={pending} className="inline-flex items-center gap-1 text-[11.5px] text-brand-orange hover:underline disabled:opacity-50">
            {isFavorited ? (<><X className="size-3.5" /> {t(locale, "Remove this page")}</>) : (<><Plus className="size-3.5" /> {t(locale, "Add this page")}</>)}
          </button>
        </div>
        {favorites.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No favorites yet.")}</div>
        ) : (
          <div className="max-h-[340px] overflow-y-auto py-1">
            {favorites.map((f) => (
              <div key={f.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-canvas">
                <Star className="size-3.5 text-brand-orange shrink-0" fill="currentColor" />
                <Link href={f.href} className="flex-1 min-w-0 truncate text-[13px]">{f.label}</Link>
                <button type="button" onClick={() => remove(f.id)} disabled={pending} className="p-1 text-ink-faint hover:text-danger shrink-0 opacity-0 group-hover:opacity-100" title={t(locale, "Remove")} aria-label={t(locale, "Remove")}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

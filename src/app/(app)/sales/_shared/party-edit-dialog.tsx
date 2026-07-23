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
import { updateOrgContactAction, updatePartyContactAction } from "./creation-popup-actions";

type Contact = { name: string; email: string; phone: string; address: string };

// In-page popup for the party cards' edit pencil. Editing happens in a dialog ON the creation
// page — no redirect. On save the record is updated and the parent form is refreshed
// (router.refresh preserves the unsaved form state), so the From/To card updates immediately.
export function PartyEditDialog({
  locale,
  kind,
  partyId,
  initial,
  trigger,
  fullSettingsHref,
}: {
  locale: Locale;
  kind: "from" | "client" | "vendor";
  partyId?: number;
  initial: Contact;
  trigger: React.ReactNode;
  /** Optional "Open Full Settings" link inside the popup (does not replace the main control). */
  fullSettingsHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<Contact>(initial);
  const [pending, start] = useTransition();

  const title = kind === "from" ? t(locale, "Edit business details") : kind === "vendor" ? t(locale, "Edit vendor") : t(locale, "Edit client");

  function save() {
    start(async () => {
      const res = kind === "from" ? await updateOrgContactAction(c) : await updatePartyContactAction(kind, partyId!, c);
      if (res.error) toast.error(res.error);
      else {
        toast.success(t(locale, "Saved"));
        setOpen(false);
        router.refresh(); // updates the card; preserves the rest of the unsaved form
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setC(initial); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-name">{t(locale, "Name")}</Label>
            <Input id="pe-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-email">{t(locale, "Email")}</Label>
            <Input id="pe-email" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-phone">{t(locale, "Phone")}</Label>
            <Input id="pe-phone" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-address">{t(locale, "Address")}</Label>
            <Input id="pe-address" value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-2">
          {fullSettingsHref ? (
            <Link href={fullSettingsHref} className="text-[12px] text-ink-muted hover:text-brand-orange inline-flex items-center gap-1" target="_blank" rel="noreferrer">
              <ExternalLink className="size-3" /> {t(locale, "Open Full Settings")}
            </Link>
          ) : <span />}
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <button type="button" className="btn btn-glass" disabled={pending}>{t(locale, "Cancel")}</button>
            </DialogClose>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>{pending ? t(locale, "Saving…") : t(locale, "Save")}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { MapPin, Mail, Phone, Pencil } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";

function PartyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px] text-ink-muted py-0.5">
      <span className="mt-0.5 opacity-75 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

export function PartyCardStatic({
  label,
  name,
  address,
  email,
  phone,
}: {
  label: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-elevated p-4 pr-11 relative">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-2">{label}</div>
      <div className="font-display font-bold text-[15px] text-ink mb-2 leading-snug">{name}</div>
      {address && <PartyRow icon={<MapPin className="size-3.5" />} text={address} />}
      {email && <PartyRow icon={<Mail className="size-3.5" />} text={email} />}
      {phone && <PartyRow icon={<Phone className="size-3.5" />} text={phone} />}
    </div>
  );
}

export function PartyCardSelect({
  locale,
  label,
  customers,
  value,
  onChange,
}: {
  locale: Locale;
  label: string;
  customers: { id: number; name: string; address?: string | null; email?: string | null; phone?: string | null }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = customers.find((c) => String(c.id) === value);
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-elevated p-4 pr-11 relative">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-2">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-auto border-none bg-transparent p-0 shadow-none font-display font-bold text-[14px] text-ink mb-2 hover:bg-transparent focus:ring-0">
          <SelectValue placeholder={t(locale, "Select a client")} />
        </SelectTrigger>
        <SelectContent>
          {customers.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.address && <PartyRow icon={<MapPin className="size-3.5" />} text={selected.address} />}
      {selected?.email && <PartyRow icon={<Mail className="size-3.5" />} text={selected.email} />}
      {selected?.phone && <PartyRow icon={<Phone className="size-3.5" />} text={selected.phone} />}
      <div className="absolute top-3.5 right-3.5 rtl:right-auto rtl:left-3.5 size-7 rounded-lg border border-line-strong bg-surface flex items-center justify-center text-ink-muted">
        <Pencil className="size-3.5" />
      </div>
    </div>
  );
}

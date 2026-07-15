import { MapPin, Mail, Phone, Globe, Pencil, ChevronDown } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";

function PcRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="pc-row">
      {icon}
      <span>{text}</span>
    </div>
  );
}

// Matches the mockup's detail-screen party card exactly: <div class="card party-card">
// <div class="k">Bill from</div><div class="name">...</div><div class="meta">...</div>
// (invoice_main / proforma_main / cn_main etc.) — simpler than the rich create-screen
// party-card-v2 (no icon rows, no edit affordance).
export function PartyCardSimple({
  label,
  name,
  metaLines,
}: {
  label: string;
  name: string;
  metaLines: (string | null | undefined)[];
}) {
  return (
    <div className="card party-card">
      <div className="k">{label}</div>
      <div className="name">{name}</div>
      {metaLines.filter(Boolean).map((line, i) => (
        <div className="meta" key={i}>
          {line}
        </div>
      ))}
    </div>
  );
}

// Matches the mockup's party_card(is_select=False) exactly: <div class="card party-card-v2">
// <div class="pc-label">...</div><div class="pc-name">...</div>{pc-row × N}<div class="pc-edit">...</div>
export function PartyCardStatic({
  label,
  name,
  address,
  email,
  phone,
  website,
}: {
  label: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}) {
  return (
    <div className="card party-card-v2">
      <div className="pc-label">{label}</div>
      <div className="pc-name">{name}</div>
      {address && <PcRow icon={<MapPin className="size-3.5" />} text={address} />}
      {email && <PcRow icon={<Mail className="size-3.5" />} text={email} />}
      {phone && <PcRow icon={<Phone className="size-3.5" />} text={phone} />}
      {website && <PcRow icon={<Globe className="size-3.5" />} text={website} />}
      <div className="pc-edit">
        <Pencil className="size-3.5" />
      </div>
    </div>
  );
}

// Matches the mockup's party_card(is_select=True) exactly — same shape as PartyCardStatic
// but the name row is a live <Select> (mockup's ".pc-select" chevron-trigger).
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
    <div className="card party-card-v2">
      <div className="pc-label">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="pc-select h-auto border-none bg-transparent p-0 shadow-none hover:bg-transparent focus:ring-0 [&_svg]:hidden">
          <SelectValue placeholder={t(locale, "Select a client")} />
          <ChevronDown className="size-3.5 text-ink-faint" />
        </SelectTrigger>
        <SelectContent>
          {customers.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.address && <PcRow icon={<MapPin className="size-3.5" />} text={selected.address} />}
      {selected?.email && <PcRow icon={<Mail className="size-3.5" />} text={selected.email} />}
      {selected?.phone && <PcRow icon={<Phone className="size-3.5" />} text={selected.phone} />}
      <div className="pc-edit">
        <Pencil className="size-3.5" />
      </div>
    </div>
  );
}
